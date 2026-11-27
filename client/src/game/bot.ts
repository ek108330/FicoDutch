import { getCardValue } from "./cards.ts";
import type { BotObservation, GamePlayer, GameState, Power, PowerKind } from "./gameTypes";
import { getHandLayout } from "./handLayout.ts";
import { observeCard } from "./memorization.ts";
import { canTargetCard, getPowerView, isPowerTargetLocked } from "./powers.ts";
import { canReactToDiscard, matchesDiscard } from "./reactions.ts";
import { playTurn, type TurnAction } from "./turn.ts";

const unknownPoints = 7;
const MIN_REACTION_MS = 500;
const MAX_REACTION_MS = 4_000;
type BotStep = { playerId: string; action: TurnAction; delay: number };

export function getBotReactionDelay(random = Math.random) {
  return MIN_REACTION_MS + Math.floor(random() * (MAX_REACTION_MS - MIN_REACTION_MS + 1));
}

function knownFace(bot: GamePlayer, player: GamePlayer, position: number) {
  if (!bot.botMemory?.length) return undefined;
  const slot = getHandLayout(player.cards.length, player.handLayout).slots[position];
  return bot.botMemory.find((card) => card.playerId === player.id && card.slot === slot &&
    card.cardId === player.cards[position].id)?.face;
}

function knownPoints(bot: GamePlayer, player: GamePlayer, position: number) {
  const face = knownFace(bot, player, position);
  return face && getCardValue(face);
}

function estimatedScore(bot: GamePlayer, player: GamePlayer) {
  return player.cards.reduce((score, _, position) => score + (knownPoints(bot, player, position) ?? unknownPoints), 0);
}

function worstPosition(player: GamePlayer) {
  return player.cards.reduce((worst, _, position) =>
    (knownPoints(player, player, position) ?? unknownPoints) > (knownPoints(player, player, worst) ?? unknownPoints)
      ? position : worst, 0);
}

function chooseCard(player: GamePlayer, position: number): TurnAction {
  return { kind: "power-card", target: { playerId: player.id, position }, handVersion: player.handVersion };
}

function pickOpponentCard(bot: GamePlayer, opponents: GamePlayer[], kind: PowerKind, protectedId?: string) {
  const targets = opponents.filter((player) => canTargetCard(kind, bot.id, player.id, protectedId) &&
    (kind !== "look-and-swap" || player.id !== protectedId))
    .flatMap((player) => player.cards.map((_, position) => ({ player, position, points: knownPoints(bot, player, position) })));
  const unknown = targets.find(({ points }) => points === undefined);
  if (kind === "look-other") return unknown ?? targets[0];
  const knownGood = targets.filter(({ points }) => points !== undefined && points < unknownPoints)
    .sort((a, b) => a.points! - b.points!)[0];
  return knownGood ?? unknown ?? targets.sort((a, b) => a.points! - b.points!)[0];
}

function playPower(state: GameState, bot: GamePlayer, opponents: GamePlayer[], worst: number, power: Power): TurnAction {
  const { kind, selected } = power;
  const pass: TurnAction = { kind: "power-pass" };
  if (kind === "give-card") {
    const recipient = opponents.find(({ id }) => canTargetCard(kind, bot.id, id, state.dutch?.announcerId));
    return recipient ? { kind: "power-player", playerId: recipient.id } : pass;
  }
  if (kind === "look-own") {
    if (selected.length) return { kind: "power-hide" };
    const unknown = bot.cards.findIndex((_, position) => !knownFace(bot, bot, position));
    return bot.cards.length ? chooseCard(bot, unknown >= 0 ? unknown : worst) : pass;
  }
  if (kind === "look-other" && selected.length) return { kind: "power-hide" };
  if (kind === "look-and-swap" && selected.length === 2) {
    const view = getPowerView(state, power, true).selection;
    const [own, other] = view?.revealed ?? [];
    return view?.canSwap && own && other && getCardValue(other.face) < getCardValue(own.face)
      ? { kind: "power-swap" } : pass;
  }

  const target = pickOpponentCard(bot, opponents, kind, state.dutch?.announcerId);
  if (!target || ((kind === "blind-swap" || kind === "look-and-swap") && !bot.cards.length)) return pass;
  if (kind === "look-other") return chooseCard(target.player, target.position);
  const ownPosition = selected.length ? bot.cards.findIndex(({ id }) => id === selected[0].cardId) : worst;
  if (!bot.cards[ownPosition] || (kind === "blind-swap" &&
    (knownPoints(bot, bot, ownPosition) ?? unknownPoints) <= (target.points ?? unknownPoints))) return pass;
  return selected.length ? chooseCard(target.player, target.position) : chooseCard(bot, worst);
}

export function getBotStep(state: GameState, now: number, reactionDelay: (playerId: string) => number = () => getBotReactionDelay(),
  extraDiscardDelay = false): BotStep | null {
  const { turn } = state;
  if (state.phase !== "playing" || !turn) return null;

  const bots = state.players.filter(({ isBot, hasLeft }) => isBot && !hasLeft);
  const discard = state.discardPile.at(-1);
  const { reference, presentedAt } = state.reaction;
  if (discard && presentedAt !== null && now <= presentedAt + MAX_REACTION_MS) {
    let nextReaction: BotStep | undefined;
    let nextReactionAt = Infinity;
    for (const bot of bots) {
      if (!canReactToDiscard(state, bot.id)) continue;
      const position = bot.cards.findIndex((card, index) => {
        const face = knownFace(bot, bot, index);
        return face && matchesDiscard(face.rank, discard.rank, state.variants.plusMinusOne) &&
          !isPowerTargetLocked(turn.power, card.id, state.dutch?.announcerId);
      });
      if (position < 0) continue;
      const at = presentedAt + reactionDelay(bot.id);
      const delay = Math.max(0, at - now);
      if (at >= nextReactionAt || (turn.finalReaction && now + delay >= turn.deadline)) continue;
      nextReactionAt = at;
      nextReaction = { playerId: bot.id, delay, action: { kind: "reaction", reference, position, handVersion: bot.handVersion } };
    }
    if (nextReaction) return nextReaction;
  }

  const bot = turn.finalReaction || turn.completed || turn.power?.pendingSwap ? undefined : bots.find(({ id }) => id === state.currentPlayerId);
  if (!bot) return null;
  const playerId = bot.id;
  const opponents = state.players.filter(({ id, hasLeft }) => id !== playerId && !hasLeft)
    .sort((a, b) => a.cards.length - b.cards.length || estimatedScore(bot, a) - estimatedScore(bot, b) || a.totalScore - b.totalScore);
  const worst = worstPosition(bot);
  if (turn.power) return { playerId, action: playPower(state, bot, opponents, worst, turn.power), delay: 720 };
  if (!turn.drawnCard) return {
    playerId, delay: 650,
    action: state.drawPile.length || state.discardPile.length >= 2 ? { kind: "draw", source: "deck" } : { kind: "skip-empty" },
  };

  const drawnPoints = getCardValue(turn.drawnCard);
  const take = bot.cards.length > 0 && bot.cards.every((_, position) => drawnPoints < (knownPoints(bot, bot, position) ?? unknownPoints));
  const handPoints = estimatedScore(bot, bot);
  const expectedScore = take ? handPoints - (knownPoints(bot, bot, worst) ?? unknownPoints) + drawnPoints : handPoints;
  if (!state.dutch && !turn.dutchArmed && opponents.length && expectedScore <= (bot.cards.length <= 2 ? 10 : 6) &&
      opponents.every((opponent) => estimatedScore(bot, opponent) >= expectedScore + 5)) {
    return { playerId, action: { kind: "dutch-intent", enabled: true }, delay: 630 };
  }

  return {
    playerId, delay: 820 + (extraDiscardDelay ? 1_000 : 0),
    action: take ? { kind: "replace", position: worst, handVersion: bot.handVersion } : { kind: "discard" },
  };
}

export function playBotStep(state: GameState, step: BotStep, now: number) {
  const next = playTurn(state, step.playerId, state.turn?.number, step.action, now);
  if (next === state) return next;
  const observed: BotObservation[] = [];
  if (step.action.kind === "power-card" && next.turn?.power) {
    for (const { target, face } of getPowerView(next, next.turn.power, true).selection?.revealed ?? []) {
      const player = next.players.find(({ id }) => id === target.playerId);
      if (player?.cards[target.position]) observed.push(observeCard(player, target.position, face));
    }
  }
  if (step.action.kind === "replace" && state.turn?.drawnCard) {
    const player = next.players.find(({ id }) => id === step.playerId);
    const position = player?.cards.findIndex(({ id }) => id === state.turn?.drawnCard?.id) ?? -1;
    if (player && position >= 0) observed.push(observeCard(player, position));
  }
  if (!observed.length) return next;
  return {
    ...next,
    players: next.players.map((player) => player.id === step.playerId ? {
      ...player,
      botMemory: [...(player.botMemory ?? []).filter((card) =>
        !observed.some((other) => other.playerId === card.playerId && other.slot === card.slot)), ...observed],
    } : player),
  };
}
