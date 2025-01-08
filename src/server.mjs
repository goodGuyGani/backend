import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { createDeck, dealCards, isValidMeld, calculateHandPoints, sortCards, shuffleDeck } from './utils/card-utils.mjs';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const games = new Map();
const PLAYERS_REQUIRED = 3;

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  socket.on('join-game', (playerName) => {
    let game = Array.from(games.values()).find(g => g.players.length < PLAYERS_REQUIRED);
    
    if (!game) {
      game = {
        id: Date.now().toString(),
        players: [],
        deck: [],
        discardPile: [],
        currentPlayerIndex: 0,
        hasDrawnThisTurn: false,
        round: 1,
        entryFee: 500,
        gameEnded: false,
        selectedCardIndices: [],
        gameStarted: false,
        firstPlayerHasPlayed: false
      };
      games.set(game.id, game);
    }

    const playerNumber = game.players.length + 1;
    
    game.players.push({
      id: socket.id,
      name: playerName,
      playerNumber,
      hand: [],
      exposedMelds: [],
      secretMelds: [],
      score: 0,
      consecutiveWins: 0,
      isSapawed: false,
      points: 0,
      turnsPlayed: 0,
      isBot: false
    });

    socket.join(game.id);

    io.to(game.id).emit('player-joined', {
      playerName,
      playerNumber,
      playersCount: game.players.length
    });

    if (game.players.length === PLAYERS_REQUIRED && !game.gameStarted) {
      game.gameStarted = true;
      setTimeout(() => startGame(game), 1000);
    }

    io.to(game.id).emit('game-state', game);
  });

  socket.on('player-action', (action) => {
    const game = Array.from(games.values()).find(g => 
      g.players.some(p => p.id === socket.id)
    );
    
    if (!game) return;

    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== game.currentPlayerIndex) return;

    handlePlayerAction(game, action, playerIndex);
    io.to(game.id).emit('game-state', game);

    // Check if it's a bot's turn after the human player's action
    if (!game.gameEnded && game.players[game.currentPlayerIndex].isBot) {
      setTimeout(() => botTurn(game), 1000);
    }
  });

  socket.on('disconnect', () => {
    console.log(`${socket.id} disconnected`);
    for (const [gameId, game] of games) {
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const player = game.players[playerIndex];
        game.players.splice(playerIndex, 1);
        if (game.players.length === 0) {
          games.delete(gameId);
        } else {
          io.to(gameId).emit('player-disconnected', {
            playerName: player.name,
            playerNumber: player.playerNumber,
            playersCount: game.players.length
          });
          io.to(gameId).emit('game-state', game);
        }
        break;
      }
    }
  });
});

function startGame(game) {
  if (game.players.length !== PLAYERS_REQUIRED) return;

  game.deck = createDeck();
  const { hands, remainingDeck } = dealCards(game.deck, PLAYERS_REQUIRED, 12);
  game.deck = remainingDeck;
  game.discardPile = [];
  game.hasDrawnThisTurn = true; // Set to true for the first player
  game.selectedCardIndices = [];
  game.firstPlayerHasPlayed = false;

  game.players.forEach((player, index) => {
    player.hand = hands[index];
    if (index === 0) {
      // Give the first player an extra card
      player.hand.push(game.deck.pop());
    }
    player.exposedMelds = [];
  });

  io.to(game.id).emit('game-started', game);
  io.to(game.id).emit('game-state', game);

  // If the first player is a bot, start its turn
  if (game.players[0].isBot) {
    setTimeout(() => botTurn(game), 1000);
  }
}

function handlePlayerAction(game, action, playerIndex) {
  // Prevent the first player from drawing on their first turn
  if (playerIndex === 0 && !game.firstPlayerHasPlayed && action.type === 'draw') {
    return;
  }

  switch (action.type) {
    case 'draw':
      handleDraw(game, action.fromDeck, action.meldIndices);
      break;
    case 'discard':
      handleDiscard(game, action.cardIndex);
      if (playerIndex === 0 && !game.firstPlayerHasPlayed) {
        game.firstPlayerHasPlayed = true;
      }
      break;
    case 'meld':
      handleMeld(game, action.cardIndices);
      break;
    case 'sapaw':
      handleSapaw(game, action.target.playerIndex, action.target.meldIndex, action.cardIndices);
      break;
    case 'callDraw':
      handleCallDraw(game);
      break;
    case 'updateSelectedIndices':
      game.selectedCardIndices = action.indices;
      break;
    case 'autoSort':
      handleAutoSort(game, playerIndex);
      break;
    case 'shuffle':
      handleShuffle(game, playerIndex);
      break;
    case 'nextGame':
      handleNextGame(game);
      break;
    case 'resetGame':
      handleResetGame(game);
      break;
  }
}

function handleDraw(game, fromDeck, meldIndices = []) {
  if (game.hasDrawnThisTurn) return;

  const currentPlayer = game.players[game.currentPlayerIndex];
  let drawnCard;

  if (!fromDeck && game.discardPile.length > 0) {
    const topCard = game.discardPile[game.discardPile.length - 1];
    const { canMeld } = canFormMeldWithCard(topCard, currentPlayer.hand);
    
    if (!canMeld) {
      return; // Can't draw from discard if no potential meld
    }

    drawnCard = game.discardPile.pop();
    
    // If meld indices were provided, automatically create the meld
    if (meldIndices.length > 0) {
      const meldCards = [...meldIndices.map(i => currentPlayer.hand[i]), drawnCard];
      if (isValidMeld(meldCards)) {
        // Remove melded cards from hand (in reverse order to maintain indices)
        meldIndices.sort((a, b) => b - a).forEach(index => {
          currentPlayer.hand.splice(index, 1);
        });
        currentPlayer.exposedMelds.push(meldCards);
        game.selectedCardIndices = [];
        game.hasDrawnThisTurn = true;
        return;
      }
    }
  } else if (game.deck.length > 0) {
    drawnCard = game.deck.pop();
  }

  if (drawnCard) {
    currentPlayer.hand.push(drawnCard);
    game.hasDrawnThisTurn = true;
  }
}

function handleDiscard(game, cardIndex) {
  if (!game.hasDrawnThisTurn && game.currentPlayerIndex !== 0) return;

  const currentPlayer = game.players[game.currentPlayerIndex];
  const discardedCard = currentPlayer.hand.splice(cardIndex, 1)[0];
  game.discardPile.push(discardedCard);
  currentPlayer.turnsPlayed++;

  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
  game.hasDrawnThisTurn = false;
  game.selectedCardIndices = [];
}

function handleMeld(game, cardIndices) {
  const currentPlayer = game.players[game.currentPlayerIndex];
  const meldedCards = cardIndices.map(index => currentPlayer.hand[index]);

  if (!isValidMeld(meldedCards)) return;

  currentPlayer.exposedMelds.push(meldedCards);
  cardIndices.sort((a, b) => b - a).forEach(index => {
    currentPlayer.hand.splice(index, 1);
  });
  game.selectedCardIndices = [];

  // Check for Tongits (empty hand)
  if (currentPlayer.hand.length === 0) {
    handleTongits(game);
  }
}

function handleSapaw(game, targetPlayerIndex, targetMeldIndex, cardIndices) {
  const currentPlayer = game.players[game.currentPlayerIndex];
  const targetPlayer = game.players[targetPlayerIndex];
  const sapawCards = cardIndices.map(index => currentPlayer.hand[index]);
  const targetMeld = [...targetPlayer.exposedMelds[targetMeldIndex], ...sapawCards];

  if (!isValidMeld(targetMeld)) return;

  targetPlayer.exposedMelds[targetMeldIndex] = targetMeld;
  cardIndices.sort((a, b) => b - a).forEach(index => {
    currentPlayer.hand.splice(index, 1);
  });
  targetPlayer.isSapawed = true;
  game.selectedCardIndices = [];
}

function handleCallDraw(game) {
  const scores = game.players.map(player => ({
    id: player.id,
    score: calculateHandPoints(player.hand)
  }));

  const winner = scores.reduce((min, player) => 
    player.score < min.score ? player : min
  );

  game.players.forEach(player => {
    player.score = scores.find(s => s.id === player.id).score;
    if (player.id === winner.id) {
      player.consecutiveWins++;
    } else {
      player.consecutiveWins = 0;
    }
  });

  game.winner = game.players.find(p => p.id === winner.id);
  game.gameEnded = true;
}

function handleTongits(game) {
  const currentPlayer = game.players[game.currentPlayerIndex];
  currentPlayer.score = 0;
  currentPlayer.consecutiveWins++;

  game.players.forEach(player => {
    if (player.id !== currentPlayer.id) {
      player.score = calculateHandPoints(player.hand);
      player.consecutiveWins = 0;
    }
  });

  game.winner = currentPlayer;
  game.gameEnded = true;
}

function handleAutoSort(game, playerIndex) {
  const player = game.players[playerIndex];
  player.hand.sort((a, b) => {
    if (a.suit !== b.suit) {
      return a.suit.localeCompare(b.suit);
    }
    return a.rank.localeCompare(b.rank);
  });
}

function handleShuffle(game, playerIndex) {
  const player = game.players[playerIndex];
  for (let i = player.hand.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [player.hand[i], player.hand[j]] = [player.hand[j], player.hand[i]];
  }
}

function handleNextGame(game) {
  game.round++;
  game.deck = createDeck();
  const { hands, remainingDeck } = dealCards(game.deck, PLAYERS_REQUIRED, 12);
  game.deck = remainingDeck;
  game.discardPile = [];
  game.currentPlayerIndex = 0;
  game.hasDrawnThisTurn = true; // Set to true for the first player
  game.gameEnded = false;
  game.selectedCardIndices = [];
  game.firstPlayerHasPlayed = false;

  game.players.forEach((player, index) => {
    player.hand = hands[index];
    if (index === 0) {
      // Give the first player an extra card
      player.hand.push(game.deck.pop());
    }
    player.exposedMelds = [];
    player.secretMelds = [];
    player.score = 0;
    player.isSapawed = false;
    player.points = 0;
    player.turnsPlayed = 0;
  });

  io.to(game.id).emit('game-state', game);

  // If the first player is a bot, start its turn
  if (game.players[0].isBot) {
    setTimeout(() => botTurn(game), 1000);
  }
}

function handleResetGame(game) {
  game.round = 1;
  game.players.forEach(player => {
    player.consecutiveWins = 0;
  });
  handleNextGame(game);
}

// function botTurn(game) {
//   const bot = game.players[game.currentPlayerIndex];
//   if (!bot.isBot) return;

//   // Bot logic here
//   // For now, let's implement a simple strategy: draw a card and discard a random card

//   // Draw a card
//   handleDraw(game, true);

//   // Discard a random card
//   const randomCardIndex = Math.floor(Math.random() * bot.hand.length);
//   handleDiscard(game, randomCardIndex);

//   io.to(game.id).emit('game-state', game);

//   // Check if it's another bot's turn
//   if (!game.gameEnded && game.players[game.currentPlayerIndex].isBot) {
//     setTimeout(() => botTurn(game), 1000);
//   }
// }

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

