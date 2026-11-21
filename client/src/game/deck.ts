
import type { Card, Suit } from "./cards";
import type { GameVariants } from "./variants";

const SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];

const RANKS = [
  "A", "2", "3", "4", "5", "6", "7",
  "8", "9", "10", "J", "Q", "K",
] as const;

function createStandardDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${suit}-${rank}`,
      rank,
      suit,
    }))
  );
}

export function createDeck(variants: GameVariants): Card[] {
  const deck = createStandardDeck();

  if (variants.jokerPlus) {
    deck.push(
      { id: "joker-1", rank: "JOKER" },
      { id: "joker-2", rank: "JOKER" }
    );
  }

  return shuffleDeck(deck);
}

export function shuffleDeck<T>(cards: T[]): T[] {
  const shuffled = [...cards];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

export function takeFromPile(
  drawPile: Card[],
  discardPile: Card[]
) {
  if (!drawPile.length && discardPile.length > 1) {
    drawPile = shuffleDeck(discardPile.slice(0, -1));
    discardPile = discardPile.slice(-1);
  }

  const card = drawPile.at(-1);
  if (!card) return null;

  return {
    card,
    drawPile: drawPile.slice(0, -1),
    discardPile,
  };
}
