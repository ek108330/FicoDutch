import { dealCards } from "./deal.ts";
import type { GameState, GamePlayer } from "./gameTypes";
import type { GameVariants } from "./variants";

type RoundPlayer = {
  id: string;
  pseudo: string;
  isBot?: true;
  totalScore: number;
  previousRank?: number;
  scoreHistory?: number[];
};

export function createRound(
  players: RoundPlayer[],
  variants: GameVariants,
  endThreshold: number | null,
  roundNumber = 1
): GameState {
  if (players.length < 2 || players.length > 6) {
    throw new Error("Une manche nécessite entre 2 et 6 joueurs.");
  }

  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new Error("Chaque joueur doit avoir un identifiant unique.");
  }

  const { hands, drawPile } = dealCards(
    players.map((player) => player.id),
    variants
  );

  const gamePlayers: GamePlayer[] = players.map((player) => ({
    id: player.id,
    pseudo: player.pseudo,
    ...(player.isBot && { isBot: player.isBot }),
    cards: hands[player.id],
    handVersion: 0,
    roundScore: 0,
    totalScore: player.totalScore,
    ...(player.previousRank !== undefined && { previousRank: player.previousRank }),
    scoreHistory: player.scoreHistory ?? [],
    hasLeft: false,
  }));

  return {
    roundNumber,
    phase: "memorization",
    phaseDeadline: null,
    openingPlayerId: null,
    players: gamePlayers,
    drawPile,
    discardPile: [],
    currentPlayerId: null,
    turn: null,
    reaction: { reference: 0, presentedAt: null, notice: null },
    dutch: null,
    result: null,
    variants: { ...variants },
    endThreshold,
  };
}
