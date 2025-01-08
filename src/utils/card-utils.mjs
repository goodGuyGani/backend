/**
 * @typedef {'hearts' | 'diamonds' | 'clubs' | 'spades'} Suit
 * @typedef {'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'} Rank
 */

/**
 * @typedef {Object} Card
 * @property {Suit} suit - The suit of the card
 * @property {Rank} rank - The rank of the card
 */

/**
 * Creates a new Card object.
 * @param {Suit} suit - The suit of the card
 * @param {Rank} rank - The rank of the card
 * @returns {Card} The card object
 */
export function createCard(suit, rank) {
  return { suit, rank };
}

// Export an example card for default import (optional)
export const Card = createCard("", "");

export function createDeck() {
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const ranks = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }

  return shuffleDeck(deck);
}

export function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(deck, numPlayers, cardsPerPlayer) {
  const hands = Array(numPlayers)
    .fill(null)
    .map(() => []);

  for (let i = 0; i < cardsPerPlayer; i++) {
    for (let j = 0; j < numPlayers; j++) {
      if (deck.length > 0) {
        const card = deck.pop();
        hands[j].push(card);
      }
    }
  }

  return { hands, remainingDeck: deck };
}

export function isThreeOfAKind(cards) {
  return (
    cards.length === 3 &&
    cards.every((card) => card && card.rank === cards[0]?.rank)
  );
}

export function isFourOfAKind(cards) {
  return (
    cards.length === 4 &&
    cards.every((card) => card && card.rank === cards[0]?.rank)
  );
}

export function isStraightFlush(cards) {
  if (
    cards.length < 3 ||
    !cards.every((card) => card && card.suit && card.rank)
  )
    return false;
  const sortedCards = [...cards].sort(
    (a, b) => rankToNumber(a.rank) - rankToNumber(b.rank)
  );
  const sameSuit = sortedCards.every(
    (card) => card && card.suit === sortedCards[0]?.suit
  );
  const consecutive = sortedCards.every(
    (card, index) =>
      index === 0 ||
      (card &&
        sortedCards[index - 1] &&
        rankToNumber(card.rank) - rankToNumber(sortedCards[index - 1].rank) ===
          1)
  );
  return sameSuit && consecutive;
}

export function isValidMeld(cards) {
  return (
    isThreeOfAKind(cards) || isFourOfAKind(cards) || isStraightFlush(cards)
  );
}

export function rankToNumber(rank) {
  const rankOrder = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  return rankOrder.indexOf(rank);
}

export function calculateCardPoints(card) {
  if (card.rank === "A") return 1;
  if (["J", "Q", "K"].includes(card.rank)) return 10;
  return parseInt(card.rank) || 0;
}

export function calculateHandPoints(hand, secretMelds = []) {
  const allCards = [...hand];
  const allMelds = [...secretMelds];

  while (true) {
    const meldFound = findAndRemoveMeld(allCards);
    if (!meldFound) break;
    allMelds.push(meldFound);
  }

  return allCards.reduce((total, card) => total + calculateCardPoints(card), 0);
}

export function findAndRemoveMeld(cards) {
  // Check for sets (three or more of the same rank)
  for (let i = 0; i < cards.length - 2; i++) {
    for (let j = i + 1; j < cards.length - 1; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        if (
          cards[i].rank === cards[j].rank &&
          cards[j].rank === cards[k].rank
        ) {
          const meld = [cards[i], cards[j], cards[k]];
          cards.splice(k, 1);
          cards.splice(j, 1);
          cards.splice(i, 1);
          return meld;
        }
      }
    }
  }

  // Check for runs (three or more consecutive cards of the same suit)
  const sortedCards = [...cards].sort(
    (a, b) => rankToNumber(a.rank) - rankToNumber(b.rank)
  );
  for (let i = 0; i < sortedCards.length - 2; i++) {
    if (
      sortedCards[i].suit === sortedCards[i + 1].suit &&
      sortedCards[i + 1].suit === sortedCards[i + 2].suit &&
      rankToNumber(sortedCards[i + 1].rank) -
        rankToNumber(sortedCards[i].rank) ===
        1 &&
      rankToNumber(sortedCards[i + 2].rank) -
        rankToNumber(sortedCards[i + 1].rank) ===
        1
    ) {
      const meld = [sortedCards[i], sortedCards[i + 1], sortedCards[i + 2]];
      cards.splice(cards.indexOf(sortedCards[i + 2]), 1);
      cards.splice(cards.indexOf(sortedCards[i + 1]), 1);
      cards.splice(cards.indexOf(sortedCards[i]), 1);
      return meld;
    }
  }

  return null;
}

export function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const suitOrder = ["♠", "♥", "♦", "♣"];
    const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return rankToNumber(b.rank) - rankToNumber(a.rank);
  });
}

export const canFormMeldWithCard = (card, playerHand) => {
  // Check for potential three of a kind
  const sameRankCards = playerHand.filter(c => c.rank === card.rank);
  if (sameRankCards.length >= 2) {
    return {
      canMeld: true,
      indices: playerHand.reduce((acc, c, i) => {
        if (c.rank === card.rank) acc.push(i);
        return acc;
      }, []).slice(0, 2)
    };
  }

  // Check for potential straight flush
  const sameSuitCards = playerHand.filter(c => c.suit === card.suit);
  for (let i = 0; i < sameSuitCards.length - 1; i++) {
    for (let j = i + 1; j < sameSuitCards.length; j++) {
      if (isValidMeld([card, sameSuitCards[i], sameSuitCards[j]])) {
        const indices = [
          playerHand.findIndex(c => c === sameSuitCards[i]),
          playerHand.findIndex(c => c === sameSuitCards[j])
        ];
        return { canMeld: true, indices };
      }
    }
  }
  return { canMeld: false, indices: [] };
};
