import { useCallback, useEffect, useRef, useState } from "react";
import type { HubPlayer } from "../../../shared/hubTypes";
import { GAME_CONFIG } from "../config/gameConfig";
import type { useHubPeers } from "../network/useHubPeers";
import type { GameState } from "./gameTypes";
import { getRoundLeaders, getRoundResultView, type RoundResultView } from "./hands";
import { getBotReactionDelay, getBotStep, playBotStep } from "./bot";
import { allPlayersMemorized, getMemorizedCards, memorizeCard, setMemorizationReady, type MemorizedCard, type MemorizeRequest } from "./memorization";
import { advanceRoundSetup, startNextRound, toggleNextVariant } from "./roundCycle";
import {
  beginPlay, dutchAnnouncementRemaining, expireTurn, getCardMotionView, getTurnView, playTurn, TURN_DURATION_MS,
  type CardMotionView, type TurnAction, type TurnRequest, type TurnView,
} from "./turn";
import type { GameVariants } from "./variants";

type SetupPlayers = Array<{ id: string; pseudo: string; cardCount: number }>;
type RoundView = { roundNumber: number; clockVersion: number; remainingMs: number | null; leaderIds?: string[] } & (
  | { phase: "waiting" }
  | { phase: "dealing"; players: SetupPlayers; sixCards: boolean }
  | { phase: "memorization"; players: SetupPlayers; sixCards: boolean; memorized: MemorizedCard[] }
  | { phase: "playing"; turn: TurnView }
  | { phase: "results"; result: RoundResultView; cardMotion: CardMotionView | null; waitingForNextRound?: true }
);
type ReceivedView = { view: RoundView; deadline: number | null; receivedAt: number };
export type UpdateHostRound = (hubId: string, update: (state: GameState, members: HubPlayer[]) => GameState) => void;

type Options = {
  hubId: string;
  hostId: string;
  playerId: string;
  members: HubPlayer[];
  firstDeadline: number;
  paused: boolean;
  clockVersion: number;
  hostRound: GameState | null;
  updateHostRound: UpdateHostRound;
  peers: ReturnType<typeof useHubPeers>;
  now: number;
};

const phaseRank: Record<RoundView["phase"], number> = {
  waiting: -1, dealing: 0, memorization: 1, playing: 2, results: 3,
};
const phaseLength: Record<RoundView["phase"], number> = {
  waiting: 0,
  dealing: GAME_CONFIG.round.dealingMs,
  memorization: GAME_CONFIG.round.memorizationMs,
  playing: TURN_DURATION_MS,
  results: GAME_CONFIG.round.resultsMs,
};

function getDeadline(state: GameState, firstDeadline: number) {
  if (state.phase === "playing") return state.turn?.deadline ?? null;
  return state.phase === "memorization" ? state.phaseDeadline ?? firstDeadline : state.phaseDeadline;
}

function projectRound(
  state: GameState, viewer: string, now: number, firstDeadline: number, clockVersion: number
): RoundView | null {
  const isPlayingRound = state.players.some(({ id, hasLeft }) => id === viewer && !hasLeft);
  if (!isPlayingRound && state.phase !== "results") {
    return { phase: "waiting", roundNumber: state.roundNumber, clockVersion, remainingMs: null };
  }
  const deadline = getDeadline(state, firstDeadline);
  const base = {
    roundNumber: state.roundNumber,
    clockVersion,
    remainingMs: deadline === null ? null
      : Math.max(0, Math.min(phaseLength[state.phase] + dutchAnnouncementRemaining(state, now), deadline - now)),
    leaderIds: getRoundLeaders(state),
  };
  if (state.phase === "playing") {
    const turn = getTurnView(state, viewer, now);
    return turn && { ...base, phase: "playing", turn };
  }
  if (state.phase === "results") {
    const result = getRoundResultView(state, isPlayingRound);
    return result && { ...base, phase: "results", result,
      cardMotion: isPlayingRound ? getCardMotionView(state, now) : null,
      ...(!isPlayingRound && { waitingForNextRound: true as const }) };
  }
  const setup = {
    ...base,
    sixCards: state.variants.sixCards,
    players: state.players.map(({ id, pseudo, cards }) => ({ id, pseudo, cardCount: cards.length })),
  };
  return state.phase === "memorization"
    ? { ...setup, phase: state.phase, memorized: getMemorizedCards(state, viewer) }
    : { ...setup, phase: state.phase };
}

function readRoundView(value: unknown): RoundView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as RoundView;
  if (!Number.isSafeInteger(view.roundNumber) || view.roundNumber < 1 || !Number.isSafeInteger(view.clockVersion) ||
      !Object.hasOwn(phaseRank, view.phase) || (view.remainingMs !== null && !Number.isFinite(view.remainingMs))) return null;
  if (view.phase === "waiting") return view.remainingMs === null ? view : null;
  if (view.phase === "playing") return Number.isSafeInteger(view.turn?.number) ? view : null;
  if (view.phase === "results") {
    return Array.isArray(view.result?.players) && Array.isArray(view.result.gameWinnerIds) ? view : null;
  }
  return Array.isArray(view.players) && typeof view.sixCards === "boolean" &&
    (view.phase !== "memorization" || Array.isArray(view.memorized)) ? view : null;
}

function acceptRoundView(current: ReceivedView | null, view: RoundView, receivedAt: number): ReceivedView {
  if (current && view.clockVersion < current.view.clockVersion) return current;
  const deadline = view.remainingMs === null
    ? null
    : receivedAt + Math.max(0, Math.min(phaseLength[view.phase] +
      (view.phase === "playing" ? view.turn.dutch?.announcementMs ?? 0 : 0), view.remainingMs));
  if (current?.view.roundNumber === view.roundNumber) {
    const previous = current.view;
    if (phaseRank[previous.phase] > phaseRank[view.phase]) return current;
    let sameStage = previous.phase === view.phase;
    if (previous.phase === "playing" && view.phase === "playing") {
      if (view.turn.number < previous.turn.number) return current;
      sameStage = view.turn.number === previous.turn.number && view.turn.power?.kind === previous.turn.power?.kind &&
        view.turn.power?.pendingSwap === previous.turn.power?.pendingSwap &&
        view.turn.finalReaction === previous.turn.finalReaction;
    }
    if (sameStage && previous.clockVersion === view.clockVersion && current.deadline !== null && deadline !== null) {
      return { view, deadline: Math.min(current.deadline, deadline), receivedAt };
    }
  } else if (current && view.roundNumber < current.view.roundNumber) return current;
  return { view, deadline, receivedAt };
}

export function useRoundTurn({
  hubId, hostId, playerId, members, firstDeadline, paused, clockVersion, hostRound, updateHostRound, peers, now,
}: Options) {
  const { connectedPeers, hostConnected, send } = peers;
  const [received, setReceived] = useState<ReceivedView | null>(null);
  const botReactions = useRef({ round: 0, reference: 0, delays: new Map<string, number>() });
  const isHost = playerId === hostId;
  const hostDeadline = hostRound ? getDeadline(hostRound, firstDeadline) : null;
  const hostRoundNumber = hostRound?.roundNumber;
  const hostPhase = hostRound?.phase;
  const hostTurnNumber = hostRound?.turn?.number;

  const sendView = useCallback((id: string) => {
    if (!hostRound || paused) return;
    const view = projectRound(hostRound, id, performance.now(), firstDeadline, clockVersion);
    if (view) send(id, { type: "round-view", view });
  }, [clockVersion, firstDeadline, hostRound, paused, send]);

  useEffect(() => {
    for (const { id } of members) {
      if (connectedPeers.includes(id)) sendView(id);
    }
  }, [connectedPeers, members, sendView]);

  useEffect(() => {
    if (!isHost || paused || !hostRound) return;
    const reactions = botReactions.current;
    if (reactions.round !== hostRound.roundNumber || reactions.reference !== hostRound.reaction.reference) {
      reactions.round = hostRound.roundNumber;
      reactions.reference = hostRound.reaction.reference;
      reactions.delays.clear();
    }
    const time = performance.now();
    const announcementPause = dutchAnnouncementRemaining(hostRound, time);
    const step = getBotStep(hostRound, time + announcementPause, (id) => {
      const existing = reactions.delays.get(id);
      if (existing !== undefined) return existing;
      const delay = getBotReactionDelay();
      reactions.delays.set(id, delay);
      return delay;
    });
    if (!step) return;
    const motionEnd = step.action.kind !== "reaction" && hostRound.cardMotion?.move.kind === "swap"
      ? hostRound.cardMotion.at + 1_100 : 0;
    const delay = Math.ceil(Math.max(announcementPause + step.delay, motionEnd - time));
    const timer = window.setTimeout(() => updateHostRound(hubId, (state) =>
      state === hostRound ? playBotStep(state, step, performance.now()) : state
    ), delay);
    return () => window.clearTimeout(timer);
  }, [hostRound, hubId, isHost, paused, updateHostRound]);

  useEffect(() => {
    if (isHost && !paused && hostRound && allPlayersMemorized(hostRound)) {
      updateHostRound(hubId, (state) => allPlayersMemorized(state) ? beginPlay(state, performance.now()) : state);
    }
  }, [hostRound, hubId, isHost, paused, updateHostRound]);

  useEffect(() => {
    if (paused || hostDeadline === null || hostRoundNumber === undefined || !hostPhase) return;
    const roundNumber = hostRoundNumber;
    const phase = hostPhase;
    const deadline = hostDeadline;
    let timer: number;
    function tick() {
      const time = performance.now();
      if (time < deadline) {
        timer = window.setTimeout(tick, Math.ceil(deadline - time));
        return;
      }
      updateHostRound(hubId, (state, currentMembers) => {
        if (state.roundNumber !== roundNumber || state.phase !== phase ||
            getDeadline(state, firstDeadline) !== deadline) return state;
        if (phase === "playing" && hostTurnNumber !== undefined) return expireTurn(state, hostTurnNumber, time);
        if (phase === "memorization") return beginPlay(state, time);
        return advanceRoundSetup(state, roundNumber, currentMembers, time);
      });
    }
    tick();
    return () => window.clearTimeout(timer);
  }, [firstDeadline, hostDeadline, hostPhase, hostRoundNumber, hostTurnNumber, hubId, members, paused, updateHostRound]);

  const receive = useCallback((senderId: string, message: { type: unknown }) => {
    if (isHost && message.type === "round-sync") {
      if (members.some(({ id, connected }) => id === senderId && connected)) sendView(senderId);
    } else if (!paused && isHost && message.type === "memorize") {
      const request = message as Partial<MemorizeRequest>;
      if (request.clockVersion !== clockVersion) return;
      updateHostRound(hubId, (state, currentMembers) => state.roundNumber === request.roundNumber &&
        currentMembers.some(({ id, connected }) => id === senderId && connected)
        ? memorizeCard(state, senderId, request.position, performance.now(), state.phaseDeadline ?? firstDeadline) : state
      );
    } else if (!paused && isHost && message.type === "memorization-ready") {
      const request = message as { clockVersion?: unknown; roundNumber?: unknown; ready?: unknown };
      if (request.clockVersion !== clockVersion) return;
      updateHostRound(hubId, (state, currentMembers) => state.roundNumber === request.roundNumber &&
        currentMembers.some(({ id, connected }) => id === senderId && connected)
        ? setMemorizationReady(state, senderId, request.ready, performance.now(), state.phaseDeadline ?? firstDeadline) : state);
    } else if (!paused && isHost && message.type === "turn-action") {
      const request = message as Partial<TurnRequest>;
      if (request.clockVersion !== clockVersion) return;
      updateHostRound(hubId, (state, currentMembers) => state.roundNumber === request.roundNumber &&
        currentMembers.some(({ id, connected }) => id === senderId && connected)
        ? playTurn(state, senderId, request.turnNumber, request.action, performance.now()) : state
      );
    } else if (!isHost && senderId === hostId && message.type === "round-view" && "view" in message) {
      const view = readRoundView(message.view);
      if (!view || view.clockVersion < clockVersion) return;
      const receivedAt = performance.now();
      setReceived((current) => acceptRoundView(current, view, receivedAt));
    }
  }, [clockVersion, firstDeadline, hostId, hubId, isHost, members, paused, sendView, updateHostRound]);

  const scene = isHost
    ? hostRound && projectRound(hostRound, playerId, now, firstDeadline, clockVersion)
    : received?.view ?? null;
  const deadline = isHost ? hostDeadline : received?.deadline ?? null;
  const view = scene?.phase === "playing" ? scene.turn : null;
  const dutch = view?.dutch;
  const announcementMs = Math.max(0, (dutch?.announcementMs ?? 0) - (isHost ? 0 : Math.max(0, now - (received?.receivedAt ?? now))));
  const remaining = scene ? Math.max(0, Math.min(phaseLength[scene.phase], (deadline ?? now) - now - announcementMs)) : 0;
  const announcement = announcementMs > 0 ? view?.players.find(({ id }) => id === dutch?.announcerId) : undefined;
  const waitingForClock = !isHost && (!received || clockVersion > received.view.clockVersion);
  const canPlay = !paused && announcementMs === 0 && !waitingForClock && view?.playerId === playerId && !view.finalReaction && remaining > 0 && (isHost || hostConnected);
  const canReact = !paused && announcementMs === 0 && !waitingForClock && !!view?.reaction.canAttempt &&
    (!view.finalReaction || remaining > 0) && (isHost || hostConnected);
  const canStartNext = !paused && isHost && members.filter(({ connected }) => connected).length >= GAME_CONFIG.players.min &&
    scene?.phase === "results" && !scene.result.gameWinnerIds.length;
  const roundNumber = scene?.roundNumber ?? 0;
  const finalMotion = scene?.phase === "results" && scene.cardMotion &&
    (isHost || (received?.receivedAt ?? 0) + scene.cardMotion.remainingMs > now) ? scene.cardMotion : null;

  function memorize(position: number) {
    const time = performance.now();
    if (paused || waitingForClock || scene?.phase !== "memorization" || deadline === null || time >= deadline) return false;
    if (!isHost) {
      const request: MemorizeRequest = { type: "memorize", roundNumber, clockVersion, position };
      return send(hostId, request);
    }
    updateHostRound(hubId, (state) => state.roundNumber === roundNumber
      ? memorizeCard(state, playerId, position, time, state.phaseDeadline ?? firstDeadline) : state
    );
    return true;
  }

  function confirmMemorization(ready: boolean) {
    const time = performance.now();
    if (paused || waitingForClock || scene?.phase !== "memorization" || deadline === null || time >= deadline) return false;
    if (!isHost) return send(hostId, { type: "memorization-ready", roundNumber, clockVersion, ready });
    updateHostRound(hubId, (state) => state.roundNumber === roundNumber
      ? setMemorizationReady(state, playerId, ready, time, state.phaseDeadline ?? firstDeadline) : state);
    return true;
  }

  function dispatch(action: TurnAction) {
    if (!view) return;
    if (isHost) {
      updateHostRound(hubId, (state) => state.roundNumber === roundNumber
        ? playTurn(state, playerId, view.number, action, performance.now()) : state
      );
    } else {
      const request: TurnRequest = { type: "turn-action", roundNumber, clockVersion, turnNumber: view.number, action };
      send(hostId, request);
    }
  }

  function act(action: TurnAction) {
    if (!canPlay || deadline === null || performance.now() >= deadline) return;
    dispatch(action);
  }

  function react(position: number) {
    if (!canReact || !view) return;
    const player = view.players.find(({ id }) => id === playerId);
    if (player) dispatch({ kind: "reaction", position, reference: view.reaction.reference, handVersion: player.handVersion });
  }

  function toggleVariant(key: keyof GameVariants) {
    if (!paused && isHost) updateHostRound(hubId, (state) => toggleNextVariant(state, roundNumber, key));
  }

  function startNext() {
    if (canStartNext) updateHostRound(hubId, (state, currentMembers) =>
      startNextRound(state, roundNumber, currentMembers, performance.now()));
  }

  return { scene, deadline, view, finalMotion, announcement, remaining, canPlay, canReact, receive, memorize, confirmMemorization, act, react,
    canStartNext, toggleVariant, startNext, waitingForClock };
}
