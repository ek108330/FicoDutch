import type { Card, CardRank } from "./cards";
import { takeFromPile } from "./deck.ts";
import type { GameState, ReactionNotice } from "./gameTypes";
import { appendCard, finishRound, recordCardMove, removeCard } from "./hands.ts";
import { isExchangeTargetLocked, updatePowerAfterReaction } from "./powers.ts";

export type ReactionAction = {
  kind: "reaction";
  reference: number;
  position: number;
  handVersion: number;
};

const circularRanks: CardRank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function matchesDiscard(card: CardRank, reference: CardRank, plusMinusOne: boolean) {
  if (card === reference) return true;
  if (!plusMinusOne || card === "JOKER" || reference === "JOKER") return false;
  const distance = Math.abs(circularRanks.indexOf(card) - circularRanks.indexOf(reference));
  return distance === 1 || distance === circularRanks.length - 1;
}

export function presentDiscard(
  state: GameState,
  discardPile: Card[],
  notice: ReactionNotice | null = null
): GameState {
  return {
    ...state,
    discardPile,
    reaction: {
      reference: state.reaction.reference + 1,
      lastPlayerId: notice?.outcome === "played" ? notice.playerId : null,
      notice,
    },
  };
}

export function canReactToDiscard(state: GameState, playerId: string) {
  return state.phase === "playing" && state.discardPile.length > 0 &&
    (state.variants.infinitePose || state.reaction.lastPlayerId !== playerId) &&
    state.players.some(({ id, hasLeft, cards }) => id === playerId && !hasLeft && cards.length > 0);
}

export function reactToDiscard(
  state: GameState,
  playerId: string,
  reference: unknown,
  position: unknown,
  handVersion: unknown,
  now: number
): GameState {
  if (reference !== state.reaction.reference || !canReactToDiscard(state, playerId) ||
      typeof position !== "number" || !Number.isInteger(position) || position < 0) return state;

  const player = state.players.find(({ id }) => id === playerId);
  const card = player?.cards[position];
  const top = state.discardPile.at(-1);
  if (!player || !card || !top || player.handVersion !== handVersion ||
      isExchangeTargetLocked(state.turn?.power ?? null, card.id, state.dutch?.announcerId)) return state;

  if (!matchesDiscard(card.rank, top.rank, state.variants.plusMinusOne)) {
    const drawn = takeFromPile(state.drawPile, state.discardPile);
    const notice: ReactionNotice = { playerId, outcome: drawn ? "penalty" : "empty-pile" };
    const reaction = { ...state.reaction, notice };
    if (!drawn) return { ...state, reaction };

    const { card: penalty, ...piles } = drawn;
    return {
      ...state, ...piles, reaction,
      cardMotion: recordCardMove(state, { kind: "penalty", target: { playerId, position: player.cards.length } }, now),
      players: state.players.map((entry) => entry === player ? appendCard(entry, penalty) : entry),
    };
  }

  const remaining = removeCard(player, position);
  const next = presentDiscard({
    ...state,
    players: state.players.map((entry) => entry === player ? remaining : entry),
    turn: state.turn ? { ...state.turn, power: updatePowerAfterReaction(state.turn.power, card.id) } : null,
  }, [...state.discardPile, card], { playerId, outcome: "played" });

  return remaining.cards.length ? next : finishRound(next, now, playerId);
}
