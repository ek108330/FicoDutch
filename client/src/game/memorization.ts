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
  requestId: number;
  positions: number[];
};

export type MemorizeResponse = {
  type: "memorized";
  roundNumber: number;
  clockVersion: number;
  requestId: number;
  cards: MemorizedCard[];
};

export function memorizationLimit(sixCards: boolean) {
  return sixCards ? 3 : 2;
}

export function revealMemorizedCards(
  round: GameState,
  playerId: string,
  positions: unknown,
  now: number,
  deadline: number
): MemorizedCard[] {
  if (round.phase !== "memorization" || now >= deadline) return [];

  const player = round.players.find(({ id, hasLeft }) => id === playerId && !hasLeft);
  if (!player || !Array.isArray(positions) || positions.length > memorizationLimit(round.variants.sixCards)) {
    return [];
  }
  if (new Set(positions).size !== positions.length ||
      positions.some((position) => !Number.isInteger(position) || position < 0 || position >= player.cards.length)) {
    return [];
  }

  return positions.map((position: number) => ({
    position,
    face: getCardFace(player.cards[position]),
  }));
}
