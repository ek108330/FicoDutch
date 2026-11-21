
export type Suit = "hearts" | "diamonds" | "clubs" | "spades";

export type CardRank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "JOKER";

export type Card = {
  id: string;
  rank: CardRank;
  suit?: Suit;
};

export type CardFace = Pick<Card, "rank" | "suit">;

export function getCardFace({ rank, suit }: Card): CardFace {
  return { rank, suit };
}

export const CARD_VALUES: Record<CardRank, number> = {
  A: 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  JOKER: 14,
};

export function getCardValue(card: Card): number {
  if (card.rank === "K") {
    return card.suit === "hearts" || card.suit === "diamonds"
      ? 13
      : 0;
  }

  return CARD_VALUES[card.rank];
}
