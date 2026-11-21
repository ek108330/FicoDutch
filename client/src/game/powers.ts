import { getCardFace, type Card, type CardFace, type CardRank } from "./cards.ts";
import { takeFromPile } from "./deck.ts";
import { appendCard, changeHand, recordCardMove } from "./hands.ts";
import type { CardTarget, GameState, Power, PowerKind, SelectedCard, Turn } from "./gameTypes";

export const POWER_DURATION_MS = 60_000;

export type PowerAction =
  | { kind: "power-card"; target: CardTarget; handVersion: number }
  | { kind: "power-player"; playerId: string }
  | { kind: "power-swap" }
  | { kind: "power-pass" };

export type PowerView = {
  kind: PowerKind;
  exchangeTargets?: CardTarget[];
  selection: {
    targets: CardTarget[];
    remaining: number;
    revealed: Array<{ target: CardTarget; face: CardFace }>;
    canSwap: boolean;
  } | null;
};

const powersByRank: Partial<Record<CardRank, PowerKind>> = {
  "8": "look-own",
  "9": "look-other",
  "10": "blind-swap",
  J: "look-and-swap",
  JOKER: "give-card",
};

export function powerCardCount(kind: PowerKind) {
  switch (kind) {
    case "blind-swap":
    case "look-and-swap":
      return 2;
    case "look-own":
    case "look-other":
      return 1;
    default:
      return 0;
  }
}

export function canTargetCard(kind: PowerKind, actorId: string, targetId: string, protectedId?: string) {
  if (kind === "look-own") return actorId === targetId;
  if (kind === "look-other") return actorId !== targetId;
  if (kind === "blind-swap") return targetId !== protectedId || targetId === actorId;
  return kind === "look-and-swap";
}

export function sameTarget(first: CardTarget, second: CardTarget) {
  return first.playerId === second.playerId && first.position === second.position;
}

export function startPower(state: GameState, actorId: string, discarded: Card): Power | null {
  const kind = powersByRank[discarded.rank];
  if (!kind) return null;

  if (kind === "give-card") {
    if (!state.variants.jokerPlus || (!state.drawPile.length && state.discardPile.length < 2) ||
        !state.players.some(({ id }) => id !== actorId)) return null;
  } else {
    const count = state.players
      .filter(({ id }) => canTargetCard(kind, actorId, id, state.dutch?.announcerId))
      .reduce((total, player) => total + player.cards.length, 0);
    if (count < powerCardCount(kind)) return null;
  }

  return { kind, selected: [] };
}

function readTarget(value: unknown): CardTarget | null {
  if (!value || typeof value !== "object" ||
      !("playerId" in value) || typeof value.playerId !== "string" ||
      !("position" in value) || typeof value.position !== "number" ||
      !Number.isInteger(value.position) || value.position < 0) return null;
  return { playerId: value.playerId, position: value.position };
}

function resolveCard(state: GameState, selected: SelectedCard) {
  const player = state.players.find(({ id }) => id === selected.playerId);
  const position = player?.cards.findIndex(({ id }) => id === selected.cardId) ?? -1;
  return player && position >= 0
    ? { target: { playerId: player.id, position }, card: player.cards[position] }
    : null;
}

function swapCards(state: GameState, first: SelectedCard, second: SelectedCard, now: number): GameState | null {
  const a = resolveCard(state, first);
  const b = resolveCard(state, second);
  if (!a || !b) return null;

  return {
    ...state,
    cardMotion: recordCardMove(state, { kind: "swap", targets: [a.target, b.target] }, now),
    players: state.players.map((player) => {
      if (player.id !== first.playerId && player.id !== second.playerId) return player;
      const cards = player.cards.slice();
      if (player.id === first.playerId) cards[a.target.position] = b.card;
      if (player.id === second.playerId) cards[b.target.position] = a.card;
      return changeHand(player, cards);
    }),
  };
}

function giveCard(state: GameState, actorId: string, recipient: unknown, now: number): GameState | null {
  const target = state.players.find(({ id }) => id === recipient);
  if (!target || target.id === actorId) return null;
  const drawn = takeFromPile(state.drawPile, state.discardPile);
  if (!drawn) return null;

  const { card, ...piles } = drawn;
  return {
    ...state,
    ...piles,
    cardMotion: recordCardMove(state, { kind: "gift", target: { playerId: target.id, position: target.cards.length } }, now),
    players: state.players.map((player) => player.id === target.id
      ? appendCard(player, card)
      : player),
  };
}

export function applyPowerAction(
  state: GameState,
  turn: Turn,
  actorId: string,
  action: { kind: unknown },
  now: number
): { state: GameState; complete: boolean } | null {
  const { power } = turn;
  if (!power) return null;

  if (action.kind === "power-pass") return { state, complete: true };

  if (action.kind === "power-player" && power.kind === "give-card" && "playerId" in action) {
    const next = giveCard(state, actorId, action.playerId, now);
    return next && { state: next, complete: true };
  }
  if (action.kind === "power-swap" && power.kind === "look-and-swap" && power.selected.length === 2) {
    if (power.selected.some(({ playerId }) => playerId === state.dutch?.announcerId && playerId !== actorId)) {
      return null;
    }
    const next = swapCards(state, power.selected[0], power.selected[1], now);
    return next && { state: next, complete: true };
  }

  if (action.kind !== "power-card" || !("target" in action) || !("handVersion" in action) ||
      power.selected.length >= powerCardCount(power.kind)) return null;
  const target = readTarget(action.target);
  if (!target || !canTargetCard(power.kind, actorId, target.playerId, state.dutch?.announcerId)) return null;
  const player = state.players.find(({ id }) => id === target.playerId);
  const card = player?.cards[target.position];
  if (!player || player.handVersion !== action.handVersion || !card ||
      power.selected.some(({ cardId }) => cardId === card.id)) return null;

  const selected = [...power.selected, { playerId: player.id, cardId: card.id }];
  if (power.kind === "blind-swap" && selected.length === 2) {
    const next = swapCards(state, selected[0], selected[1], now);
    return next && { state: next, complete: true };
  }
  return { state: { ...state, turn: { ...turn, power: { ...power, selected } } }, complete: false };
}

export function isExchangeTargetLocked(power: Power | null, cardId: string, protectedId?: string) {
  return power?.kind === "look-and-swap" && power.selected.length === 2 &&
    power.selected.every(({ playerId }) => playerId !== protectedId) &&
    power.selected.some((selected) => selected.cardId === cardId);
}

export function updatePowerAfterReaction(power: Power | null, cardId: string) {
  if (power?.kind !== "blind-swap" && power?.kind !== "look-and-swap") return power;
  if (power.kind === "look-and-swap" && power.selected.length === 2) return power;
  return { ...power, selected: power.selected.filter((selected) => selected.cardId !== cardId) };
}

export function getPowerView(state: GameState, power: Power, canSee: boolean): PowerView {
  const available = power.selected.flatMap((selected) => {
    const resolved = resolveCard(state, selected);
    return resolved ? [resolved] : [];
  });
  const targets = available.map(({ target }) => target);
  const exchangeTargets = power.kind === "blind-swap" || power.kind === "look-and-swap" ? targets : undefined;
  if (!canSee) return { kind: power.kind, exchangeTargets, selection: null };

  const remaining = powerCardCount(power.kind) - power.selected.length;
  const revealed = power.kind !== "blind-swap" && remaining === 0
    ? available.map(({ target, card }) => ({ target, face: getCardFace(card) }))
    : [];
  return {
    kind: power.kind,
    exchangeTargets,
    selection: {
      targets,
      remaining,
      revealed,
      canSwap: power.kind === "look-and-swap" && available.length === 2 &&
        available.every(({ target }) => target.playerId !== state.dutch?.announcerId),
    },
  };
}
