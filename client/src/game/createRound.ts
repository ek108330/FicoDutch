import { dealCards } from "./deal";
import type { GameState, GamePlayer } from "./gameTypes";
import type { GameVariants } from "./variants";

type RoundPlayer = {
  id: string;
  pseudo: string;
  totalScore: number;
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
    cards: hands[player.id],
    roundScore: 0,
    totalScore: player.totalScore,
    hasLeft: false,
  }));

  return {
    roundNumber,
    phase: "memorization",
    players: gamePlayers,
    drawPile,
    discardPile: [],
    currentPlayerId: null,
    variants: { ...variants },
    endThreshold,
  };
}