import { getCardFace, type Card, type CardFace } from "./cards.ts";
import { takeFromPile, type DrawSource } from "./deck.ts";
import type { GameState, GamePlayer, ReactionNotice, Turn } from "./gameTypes";
import { changeHand, finishRound } from "./hands.ts";
import { applyPowerAction, getPowerView, POWER_DURATION_MS, startPower, type PowerAction, type PowerView } from "./powers.ts";
import { canReactToDiscard, presentDiscard, reactToDiscard, type ReactionAction } from "./reactions.ts";

export const TURN_DURATION_MS = 60_000;

export type TurnAction =
  | { kind: "draw"; source: "deck" }
  | { kind: "draw"; source: "discard"; reference: number }
  | { kind: "replace"; position: number; handVersion: number }
  | { kind: "discard" }
  | { kind: "dutch-intent"; enabled: boolean }
  | PowerAction
  | ReactionAction;

export type TurnView = {
  number: number;
  playerId: string;
  playerName: string;
  remainingMs: number;
  hasDrawn: boolean;
  drawnCard: CardFace | null;
  deckCount: number;
  discardCount: number;
  topDiscard: CardFace | null;
  power: PowerView | null;
  players: Array<{ id: string; pseudo: string; cardCount: number; handVersion: number }>;
  reaction: { reference: number; canAttempt: boolean; notice: ReactionNotice | null };
  dutch: { announcerId: string; lastTurns: number } | null;
  canAnnounceDutch: boolean;
  dutchArmed: boolean;
};

export type TurnRequest = {
  type: "turn-action";
  roundNumber: number;
  clockVersion: number;
  turnNumber: number;
  action: TurnAction;
};

function nextTurn(number: number, now: number): Turn {
  return { number, deadline: now + TURN_DURATION_MS, drawnCard: null, power: null, dutchArmed: false };
}

export function beginPlay(state: GameState, now: number, random = Math.random) {
  if (state.phase !== "memorization") return state;
  const activePlayers = state.players.filter(({ hasLeft }) => !hasLeft);
  const first = activePlayers.find(({ id }) => id === state.openingPlayerId) ??
    activePlayers[Math.floor(random() * activePlayers.length)];
  if (!first) return state;

  return {
    ...state,
    phase: "playing",
    phaseDeadline: null,
    currentPlayerId: first.id,
    turn: nextTurn(1, now),
  } satisfies GameState;
}

function moveToNextPlayer(state: GameState, turn: Turn, now: number): GameState {
  const currentId = state.currentPlayerId;
  const current = state.players.findIndex(({ id }) => id === currentId);
  const activeOrder = [...state.players.slice(current + 1), ...state.players.slice(0, current + 1)]
    .filter(({ hasLeft }) => !hasLeft)
    .map(({ id }) => id);
  const dutch = state.dutch ?? (turn.dutchArmed && currentId
    ? { announcerId: currentId, remainingPlayerIds: activeOrder }
    : null);
  if (dutch) {
    const remainingPlayerIds = dutch.remainingPlayerIds.filter((id) => id !== currentId && activeOrder.includes(id));
    const nextState = { ...state, dutch: { ...dutch, remainingPlayerIds } };
    if (!remainingPlayerIds.length) return finishRound(nextState, now);
    return {
      ...nextState,
      currentPlayerId: remainingPlayerIds[0],
      turn: nextTurn(turn.number + 1, now),
    };
  }
  const nextId = activeOrder[0];
  return {
    ...state,
    currentPlayerId: nextId ?? null,
    turn: nextId ? nextTurn(turn.number + 1, now) : null,
  };
}

function draw(state: GameState, turn: Turn, source: DrawSource): GameState {
  if (turn.drawnCard) return state;
  const drawn = takeFromPile(state.drawPile, state.discardPile, source);
  if (!drawn) return state;

  const { card, ...piles } = drawn;
  const next = {
    ...state,
    ...piles,
    turn: { ...turn, drawnCard: card },
  };
  return source === "discard" ? presentDiscard(next, next.discardPile) : next;
}

function finishDiscard(state: GameState, actorId: string, turn: Turn, discarded: Card, now: number): GameState {
  const next = presentDiscard(state, [...state.discardPile, discarded]);
  const power = startPower(next, actorId, discarded);
  if (!power) return moveToNextPlayer(next, turn, now);

  return {
    ...next,
    turn: { ...turn, drawnCard: null, power, deadline: now + POWER_DURATION_MS },
  };
}

function replaceCard(state: GameState, player: GamePlayer, turn: Turn, position: unknown, now: number) {
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0 || !turn.drawnCard) return state;
  const discarded = player.cards[position];
  if (!discarded) return state;

  const cards = player.cards.slice();
  cards[position] = turn.drawnCard;
  return finishDiscard({
    ...state,
    players: state.players.map((entry) => entry === player ? changeHand(entry, cards) : entry),
  }, player.id, turn, discarded, now);
}

export function playTurn(
  state: GameState,
  actorId: string,
  turnNumber: unknown,
  action: unknown,
  now: number
): GameState {
  if (!action || typeof action !== "object" || !("kind" in action)) return state;
  if (action.kind === "reaction") {
    return "reference" in action && "position" in action && "handVersion" in action
      ? reactToDiscard(state, actorId, action.reference, action.position, action.handVersion, now)
      : state;
  }
  const { turn } = state;
  if (state.phase !== "playing" || actorId !== state.currentPlayerId ||
      !turn || turn.number !== turnNumber || now >= turn.deadline) return state;

  const player = state.players.find(({ id, hasLeft }) => id === actorId && !hasLeft);
  if (!player) return state;

  if (action.kind === "dutch-intent") {
    if (state.dutch || !("enabled" in action) ||
        typeof action.enabled !== "boolean" || action.enabled === turn.dutchArmed) return state;
    return { ...state, turn: { ...turn, dutchArmed: action.enabled } };
  }

  if (turn.power) {
    const result = applyPowerAction(state, turn, actorId, action);
    if (!result) return state;
    return result.complete ? moveToNextPlayer(result.state, turn, now) : result.state;
  }

  switch (action.kind) {
    case "draw":
      if (!("source" in action)) return state;
      if (action.source === "deck") return draw(state, turn, "deck");
      return action.source === "discard" && "reference" in action && action.reference === state.reaction.reference
        ? draw(state, turn, "discard") : state;
    case "replace":
      return "position" in action && "handVersion" in action && action.handVersion === player.handVersion
        ? replaceCard(state, player, turn, action.position, now)
        : state;
    case "discard":
      return turn.drawnCard
        ? finishDiscard(state, actorId, turn, turn.drawnCard, now)
        : state;
    default:
      return state;
  }
}

export function expireTurn(state: GameState, turnNumber: number, now: number): GameState {
  const { turn } = state;
  if (state.phase !== "playing" || !turn || turn.number !== turnNumber || now < turn.deadline) {
    return state;
  }
  return skipTurn(state, turn, now);
}

function skipTurn(state: GameState, turn: Turn, now: number): GameState {
  const next = turn.drawnCard
    ? presentDiscard(state, [...state.discardPile, turn.drawnCard])
    : state;
  return moveToNextPlayer(next, turn, now);
}

export function applyDepartures(state: GameState, presentIds: ReadonlySet<string>, now: number): GameState {
  const departed = new Set(state.players.filter(({ id, hasLeft }) => !hasLeft && !presentIds.has(id)).map(({ id }) => id));
  if (!departed.size) return state;

  const next = {
    ...state,
    players: state.players.map((player) => departed.has(player.id) ? { ...player, hasLeft: true } : player),
    dutch: state.dutch && {
      ...state.dutch,
      remainingPlayerIds: state.dutch.remainingPlayerIds.filter((id) => !departed.has(id)),
    },
  };
  if (state.phase === "playing" && state.turn && state.currentPlayerId && departed.has(state.currentPlayerId)) {
    return skipTurn(next, { ...state.turn, dutchArmed: false }, now);
  }
  return next;
}

export function getTurnView(state: GameState, viewerId: string, now: number): TurnView | null {
  const { turn } = state;
  const player = state.players.find(({ id }) => id === state.currentPlayerId);
  if (state.phase !== "playing" || !turn || !player) return null;

  const topDiscard = state.discardPile.at(-1);
  const canSeePrivateCards = player.id === viewerId && now < turn.deadline;
  return {
    number: turn.number,
    playerId: player.id,
    playerName: player.pseudo,
    remainingMs: Math.max(0, turn.deadline - now),
    hasDrawn: !!turn.drawnCard,
    drawnCard: turn.drawnCard && canSeePrivateCards ? getCardFace(turn.drawnCard) : null,
    deckCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    topDiscard: topDiscard ? getCardFace(topDiscard) : null,
    power: turn.power ? getPowerView(state, turn.power, canSeePrivateCards) : null,
    players: state.players.map(({ id, pseudo, cards, handVersion }) => ({ id, pseudo, cardCount: cards.length, handVersion })),
    reaction: {
      reference: state.reaction.reference,
      canAttempt: canReactToDiscard(state, viewerId),
      notice: state.reaction.notice,
    },
    dutch: state.dutch ? { announcerId: state.dutch.announcerId, lastTurns: state.dutch.remainingPlayerIds.length } : null,
    canAnnounceDutch: !state.dutch && canSeePrivateCards,
    dutchArmed: canSeePrivateCards && turn.dutchArmed,
  };
}
