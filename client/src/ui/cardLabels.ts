import type { CardFace } from "../game/cards";

export const suits = {
  hearts: { symbol: "♥", name: "cœur", red: true },
  diamonds: { symbol: "♦", name: "carreau", red: true },
  clubs: { symbol: "♣", name: "trèfle", red: false },
  spades: { symbol: "♠", name: "pique", red: false },
};

const rankNames: Partial<Record<CardFace["rank"], string>> = {
  A: "As", J: "Valet", Q: "Dame", K: "Roi", JOKER: "Joker",
};

export function describeCardFace(face: CardFace) {
  const rank = rankNames[face.rank] ?? face.rank;
  return face.suit ? `${rank} de ${suits[face.suit].name}` : rank;
}
