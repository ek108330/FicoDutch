import type { Card } from "./cards";
import type { GameVariants } from "./variants";

export type GamePhase =
  | "memorization"
  | "playing"
  | "results";

export type GamePlayer = {
  id: string;
  pseudo: string;
  cards: Card[];
  roundScore: number;
  totalScore: number;
  hasLeft: boolean;
};

export type GameState = {
  roundNumber: number;
  phase: GamePhase;
  players: GamePlayer[];
  drawPile: Card[];
  discardPile: Card[];
  currentPlayerId: string | null;
  variants: GameVariants;
  endThreshold: number | null;
};