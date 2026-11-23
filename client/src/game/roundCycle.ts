import { GAME_CONFIG } from "../config/gameConfig.ts";
import { createRound } from "./createRound.ts";
import type { GameState, GamePlayer } from "./gameTypes";
import type { GameVariants } from "./variants";
import type { HubPlayer } from "../../../shared/hubTypes";
import { rankPlayers } from "./hands.ts";
import { logDeal } from "./matchJournal.ts";

type RoundMember = Pick<HubPlayer, "id" | "pseudo" | "connected" | "accountId">;

export function toggleNextVariant(state: GameState, roundNumber: number, key: keyof GameVariants): GameState {
  const { result } = state;
  if (state.phase !== "results" || state.roundNumber !== roundNumber || !result ||
      !Object.hasOwn(result.nextVariants, key)) return state;
  return {
    ...state,
    result: { ...result, nextVariants: { ...result.nextVariants, [key]: !result.nextVariants[key] } },
  };
}

function chooseOpeningPlayer(players: GamePlayer[], winners: string[], random: () => number) {
  const availableWinners = players.filter(({ id }) => winners.includes(id));
  const bestRoundScore = Math.min(...players.map(({ roundScore }) => roundScore));
  const candidates = availableWinners.length
    ? availableWinners
    : players.filter(({ roundScore }) => roundScore === bestRoundScore);
  const highestTotal = Math.max(...candidates.map(({ totalScore }) => totalScore));
  const tied = candidates.filter(({ totalScore }) => totalScore === highestTotal);
  return tied[Math.floor(random() * tied.length)].id;
}

export function startNextRound(
  state: GameState,
  roundNumber: number,
  members: readonly RoundMember[],
  now: number,
  random = Math.random
): GameState {
  const { result } = state;
  if (state.phase !== "results" || state.roundNumber !== roundNumber ||
      !result || result.gameWinnerIds.length > 0) return state;

  const previousRanks = new Map(rankPlayers(state.players).map(({ player, rank }) => [player.id, rank]));
  const players = state.players.filter(({ hasLeft }) => !hasLeft)
    .map((player) => ({ ...player, previousRank: previousRanks.get(player.id) }));
  const previousIds = new Set(state.players.map(({ id }) => id));
  const startingScore = Math.max(...state.players.map(({ totalScore }) => totalScore));
  const arrivals = members.filter(({ id, connected }) => connected && !previousIds.has(id))
    .map(({ id, pseudo, accountId }) => ({ id, pseudo, accountId, totalScore: startingScore, scoreHistory: [startingScore] }));
  const participants = [...players, ...arrivals];
  const onlineIds = new Set(members.filter(({ connected }) => connected).map(({ id }) => id));
  if (participants.filter(({ id }) => onlineIds.has(id)).length < GAME_CONFIG.players.min) return state;
  const next = createRound(participants, result.nextVariants, state.endThreshold, roundNumber + 1);
  return {
    ...(state.journal ? logDeal({ ...next, matchId: state.matchId, journal: state.journal }, now) : next),
    phase: "dealing",
    phaseDeadline: now + GAME_CONFIG.round.dealingMs,
    openingPlayerId: chooseOpeningPlayer(players, result.winnerIds, random),
  };
}

export function advanceRoundSetup(
  state: GameState, roundNumber: number, members: readonly RoundMember[], now: number
): GameState {
  if (state.roundNumber !== roundNumber || state.phaseDeadline === null || now < state.phaseDeadline) return state;
  if (state.phase === "results") return startNextRound(state, roundNumber, members, now);
  if (state.phase === "dealing") {
    return { ...state, phase: "memorization", phaseDeadline: now + GAME_CONFIG.round.memorizationMs };
  }
  return state;
}
