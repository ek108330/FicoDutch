import type { Card, CardFace } from "./cards";
import type { HandLayout } from "./handLayout";
import type { GameVariants } from "./variants";
import type { MatchJournal } from "./matchJournal";

export type GamePhase =
  | "dealing"
  | "memorization"
  | "playing"
  | "results";

export type GamePlayer = {
  id: string;
  accountId?: string;
  pseudo: string;
  isBot?: true;
  botMemory?: BotObservation[];
  cards: Card[];
  handVersion: number;
  handLayout?: HandLayout;
  memorizedPositions?: number[];
  memorizationReady?: boolean;
  roundScore: number;
  totalScore: number;
  previousRank?: number;
  scoreHistory: number[];
  hasLeft: boolean;
};

export type CardTarget = { playerId: string; position: number };
export type BotObservation = { playerId: string; slot: number; cardId: string; face: CardFace };
export type PublicCardMove = { kind: "swap"; targets: [CardTarget, CardTarget] } |
  { kind: "gift" | "penalty"; target: CardTarget } |
  { kind: "reaction"; playerId: string; slot: number; face: CardFace } |
  { kind: "bot-discard"; playerId: string; slot?: number; face: CardFace };
export type PowerKind = "look-own" | "look-other" | "blind-swap" | "look-and-swap" | "give-card";
export type SelectedCard = { playerId: string; cardId: string };
export type Power = { kind: PowerKind; selected: SelectedCard[]; pendingSwap?: true };
export type ReactionNotice = { playerId: string; outcome: "played" | "penalty" | "empty-pile" };
export type ReactionState = { reference: number; presentedAt: number | null; notice: ReactionNotice | null };
export type Dutch = { announcerId: string; remainingPlayerIds: string[]; announcedAt?: number };
export type RoundResult = {
  emptyHandPlayerId: string | null;
  dutchAnnouncerId: string | null;
  dutchPenalty: boolean;
  winnerIds: string[];
  gameWinnerIds: string[];
  nextVariants: GameVariants;
};

export type Turn = {
  number: number;
  deadline: number;
  drawnCard: Card | null;
  power: Power | null;
  dutchArmed: boolean;
  finalReaction?: true;
};

export type GameState = {
  matchId?: string;
  journal?: MatchJournal;
  roundNumber: number;
  phase: GamePhase;
  phaseDeadline: number | null;
  openingPlayerId: string | null;
  players: GamePlayer[];
  drawPile: Card[];
  discardPile: Card[];
  currentPlayerId: string | null;
  turn: Turn | null;
  cardMotion?: { id: number; at: number; move: PublicCardMove };
  reaction: ReactionState;
  dutch: Dutch | null;
  result: RoundResult | null;
  variants: GameVariants;
  endThreshold: number | null;
};
