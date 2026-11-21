import { getCardFace, type CardFace } from "./cards.ts";
import type { GameState } from "./gameTypes";

export type MemorizedCard = {
  position: number;
  face: CardFace;
};

export type MemorizeRequest = {
  type: "memorize";
  roundNumber: number;
  clockVersion: number;
  position: number;
};

export function memorizationLimit(sixCards: boolean) {
  return sixCards ? 3 : 2;
}

export function memorizeCard(
  round: GameState,
  playerId: string,
  position: unknown,
  now: number,
  deadline: number
): GameState {
  if (round.phase !== "memorization" || now >= deadline ||
      typeof position !== "number" || !Number.isInteger(position)) return round;

  const player = round.players.find(({ id, hasLeft }) => id === playerId && !hasLeft);
  if (!player?.cards[position]) return round;
  const chosen = player.memorizedPositions ?? [];
  if (chosen.includes(position) || chosen.length >= memorizationLimit(round.variants.sixCards)) return round;

  return {
    ...round,
    players: round.players.map((entry) => entry === player
      ? { ...player, memorizedPositions: [...chosen, position] } : entry),
  };
}

export function getMemorizedCards(round: GameState, playerId: string): MemorizedCard[] {
  if (round.phase !== "memorization") return [];
  const player = round.players.find(({ id, hasLeft }) => id === playerId && !hasLeft);
  return player?.memorizedPositions?.map((position) => ({
    position, face: getCardFace(player.cards[position]),
  })) ?? [];
}
