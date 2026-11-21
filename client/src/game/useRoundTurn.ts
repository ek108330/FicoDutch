import { useCallback, useEffect, useState } from "react";
import type { HubPlayer } from "../../../shared/hubTypes";
import { GAME_CONFIG } from "../config/gameConfig";
import type { useHubPeers } from "../network/useHubPeers";
import type { GameState } from "./gameTypes";
import { getRoundResultView, type RoundResultView } from "./hands";
import { advanceRoundSetup, startNextRound, toggleNextVariant } from "./roundCycle";
import {
  beginPlay, expireTurn, getTurnView, playTurn, TURN_DURATION_MS,
  type TurnAction, type TurnRequest, type TurnView,
} from "./turn";
import type { GameVariants } from "./variants";

type SetupPlayers = Array<{ id: string; pseudo: string; cardCount: number }>;
type RoundView = { roundNumber: number; clockVersion: number; remainingMs: number | null } & (
  | { phase: "waiting" }
  | { phase: "transition" | "dealing" | "memorization"; players: SetupPlayers; sixCards: boolean }
  | { phase: "playing"; turn: TurnView }
  | { phase: "results"; result: RoundResultView }
);
type ReceivedView = { view: RoundView; deadline: number | null };
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
  waiting: -1, transition: 0, dealing: 1, memorization: 2, playing: 3, results: 4,
};
const phaseLength: Record<RoundView["phase"], number> = {
  waiting: 0,
  transition: GAME_CONFIG.round.transitionMs,
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
  if (!state.players.some(({ id, hasLeft }) => id === viewer && !hasLeft)) {
    return { phase: "waiting", roundNumber: state.roundNumber, clockVersion, remainingMs: null };
  }
  const deadline = getDeadline(state, firstDeadline);
  const base = {
    roundNumber: state.roundNumber,
    clockVersion,
    remainingMs: deadline === null ? null : Math.max(0, Math.min(phaseLength[state.phase], deadline - now)),
  };
  if (state.phase === "playing") {
    const turn = getTurnView(state, viewer, now);
    return turn && { ...base, phase: "playing", turn };
  }
  if (state.phase === "results") {
    const result = getRoundResultView(state);
    return result && { ...base, phase: "results", result };
  }
  return {
    ...base,
    phase: state.phase,
    sixCards: state.variants.sixCards,
    players: state.players.map(({ id, pseudo, cards }) => ({ id, pseudo, cardCount: cards.length })),
  };
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
  return Array.isArray(view.players) && typeof view.sixCards === "boolean" ? view : null;
}

function acceptRoundView(current: ReceivedView | null, view: RoundView, receivedAt: number): ReceivedView {
  if (current && view.clockVersion < current.view.clockVersion) return current;
  const deadline = view.remainingMs === null
    ? null
    : receivedAt + Math.max(0, Math.min(phaseLength[view.phase], view.remainingMs));
  if (current?.view.roundNumber === view.roundNumber) {
    const previous = current.view;
    if (phaseRank[previous.phase] > phaseRank[view.phase]) return current;
    let sameStage = previous.phase === view.phase;
    if (previous.phase === "playing" && view.phase === "playing") {
      if (view.turn.number < previous.turn.number) return current;
      sameStage = view.turn.number === previous.turn.number && view.turn.power?.kind === previous.turn.power?.kind;
    }
    if (sameStage && previous.clockVersion === view.clockVersion && current.deadline !== null && deadline !== null) {
      return { view, deadline: Math.min(current.deadline, deadline) };
    }
  } else if (current && view.roundNumber < current.view.roundNumber) return current;
  return { view, deadline };
}

export function useRoundTurn({
  hubId, hostId, playerId, members, firstDeadline, paused, clockVersion, hostRound, updateHostRound, peers, now,
}: Options) {
  const { connectedPeers, hostConnected, send } = peers;
  const [received, setReceived] = useState<ReceivedView | null>(null);
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
    } else if (!paused && isHost && message.type === "turn-action") {
      const request = message as Partial<TurnRequest>;
      if (request.clockVersion !== clockVersion) return;
      updateHostRound(hubId, (state, currentMembers) => state.roundNumber === request.roundNumber &&
        currentMembers.some(({ id, connected }) => id === senderId && connected)
        ? playTurn(state, senderId, request.turnNumber, request.action, performance.now()) : state
      );
    } else if (!isHost && senderId === hostId && message.type === "round-view" && "view" in message) {
      const view = readRoundView(message.view);
      if (!view) return;
      const receivedAt = performance.now();
      setReceived((current) => acceptRoundView(current, view, receivedAt));
    }
  }, [clockVersion, hostId, hubId, isHost, members, paused, sendView, updateHostRound]);

  const scene = isHost
    ? hostRound && projectRound(hostRound, playerId, now, firstDeadline, clockVersion)
    : received?.view ?? null;
  const deadline = isHost ? hostDeadline : received?.deadline ?? null;
  const remaining = scene ? Math.max(0, Math.min(phaseLength[scene.phase], (deadline ?? now) - now)) : 0;
  const view = scene?.phase === "playing" ? scene.turn : null;
  const waitingForClock = !isHost && (!received || clockVersion > received.view.clockVersion);
  const canPlay = !paused && !waitingForClock && view?.playerId === playerId && remaining > 0 && (isHost || hostConnected);
  const canReact = !paused && !waitingForClock && !!view?.reaction.canAttempt && (isHost || hostConnected);
  const canStartNext = !paused && isHost && members.filter(({ connected }) => connected).length >= GAME_CONFIG.players.min &&
    scene?.phase === "results" && !scene.result.gameWinnerIds.length;
  const roundNumber = scene?.roundNumber ?? 0;

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
    if (!paused && isHost) updateHostRound(hubId, (state) => toggleNextVariant(state, roundNumber, key, performance.now()));
  }

  function startNext() {
    if (canStartNext) updateHostRound(hubId, (state, currentMembers) =>
      startNextRound(state, roundNumber, currentMembers, performance.now()));
  }

  return { scene, deadline, view, remaining, canPlay, canReact, receive, act, react,
    canStartNext, toggleVariant, startNext, waitingForClock };
}
