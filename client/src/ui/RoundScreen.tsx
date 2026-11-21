import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GAME_CONFIG } from "../config/gameConfig";
import type { HubPlayer } from "../../../shared/hubTypes";
import {
  memorizationLimit, revealMemorizedCards,
  type MemorizedCard, type MemorizeRequest, type MemorizeResponse,
} from "../game/memorization";
import type { CardTarget, GameState } from "../game/gameTypes";
import { useRoundTurn, type UpdateHostRound } from "../game/useRoundTurn";
import type { useHubPeers } from "../network/useHubPeers";
import { useTableEmojis } from "../network/useTableEmojis";
import GameTable from "./GameTable";
import EmojiButtons from "./EmojiButtons";
import { useCardFeedback, type PlayGameSound } from "./useCardFeedback";
import { TurnPanel, TurnPiles } from "./TurnControls";
import RoundResults from "./RoundResults";

type RoundScreenProps = {
  hubId: string;
  hostId: string;
  playerId: string;
  deadline: number;
  members: HubPlayer[];
  gameFinished: boolean;
  hostRound: GameState | null;
  peers: ReturnType<typeof useHubPeers>;
  updateHostRound: UpdateHostRound;
  onLeave: () => void;
  hostManagement: ReactNode;
  settings: ReactNode;
  playSound: PlayGameSound;
  canLeave: boolean;
  clockVersion: number;
  pause: { reason: "host" | "local"; deadline?: number } | null;
};

type Memorization = { roundNumber: number; selected: number[]; revealed: MemorizedCard[] };
const emptySelection: Memorization = { roundNumber: 0, selected: [], revealed: [] };

export default function RoundScreen({
  hubId, hostId, playerId, deadline: firstDeadline, members, gameFinished, hostRound,
  peers, updateHostRound, onLeave, hostManagement, settings, playSound, canLeave, clockVersion, pause,
}: RoundScreenProps) {
  const { hostConnected, send, subscribe } = peers;
  const [now, setNow] = useState(() => performance.now());
  const [memory, setMemory] = useState<Memorization>(emptySelection);
  const requestId = useRef(0);
  const dealtRound = useRef(0);
  const visibleMemory = useRef(0);
  const paused = pause !== null;
  const turn = useRoundTurn({ hubId, hostId, playerId, members, firstDeadline,
    hostRound, peers, updateHostRound, now, paused, clockVersion });
  const { scene, deadline, receive: receiveTurn } = turn;
  const phase = scene?.phase;
  const roundNumber = scene?.roundNumber ?? 0;
  const selected = memory.roundNumber === roundNumber ? memory.selected : emptySelection.selected;
  const revealed = memory.roundNumber === roundNumber ? memory.revealed : emptySelection.revealed;
  const limit = memorizationLimit(scene?.phase === "memorization" && scene.sixCards);
  const memorizing = phase === "memorization" && turn.remaining > 0;
  const connectionReady = playerId === hostId ? !!hostRound : hostConnected;
  const canSelect = !paused && !turn.waitingForClock && memorizing && connectionReady;
  const finished = !paused && (phase === "results" && deadline === null || phase === "waiting" && gameFinished);
  const ticking = !finished || !!turn.finalMotion;
  const emojisEnabled = !paused && !turn.waitingForClock && connectionReady && canLeave &&
    (phase === "memorization" || phase === "playing");
  const feedback = useCardFeedback(
    !paused && !turn.waitingForClock && connectionReady ? turn.view : null, roundNumber, clockVersion, playerId, playSound,
  );
  const soundEmoji = useCallback(() => playSound("emoji"), [playSound]);
  const { choose: chooseEmoji, receive: receiveEmoji, visible: tableEmojis } = useTableEmojis({
    playerId, hostId, roundNumber, clockVersion, enabled: emojisEnabled, now, hostRound, members, send, onShow: soundEmoji,
  });

  useEffect(() => {
    if (paused || !connectionReady || turn.waitingForClock || dealtRound.current === roundNumber ||
        (phase !== "dealing" && phase !== "memorization")) return;
    dealtRound.current = roundNumber;
    playSound("deal");
  }, [connectionReady, paused, phase, playSound, roundNumber, turn.waitingForClock]);

  useEffect(() => {
    const count = canSelect ? revealed.length : 0;
    if (canSelect && visibleMemory.current !== count) playSound("flip");
    visibleMemory.current = count;
  }, [canSelect, playSound, revealed.length]);

  useEffect(() => {
    if (!ticking) return;
    const interval = window.setInterval(() => setNow(performance.now()), 125);
    return () => window.clearInterval(interval);
  }, [ticking]);

  useEffect(() => {
    if (paused || turn.waitingForClock || phase !== "memorization" || deadline === null) return;
    const timer = window.setTimeout(() => setMemory(emptySelection), Math.max(0, Math.ceil(deadline - performance.now())));
    return () => window.clearTimeout(timer);
  }, [deadline, paused, phase, roundNumber, turn.waitingForClock]);

  useEffect(() => subscribe((senderId, data) => {
    if (!data || typeof data !== "object" || !("type" in data)) return;
    if (data.type === "turn-action" || data.type === "round-view" || data.type === "round-sync") {
      receiveTurn(senderId, data);
      return;
    }
    if (data.type === "table-emoji" || data.type === "table-emoji-request") {
      receiveEmoji(senderId, data);
      return;
    }
    const time = performance.now();
    if (paused || turn.waitingForClock || phase !== "memorization" || deadline === null || time >= deadline ||
        !("roundNumber" in data) || data.roundNumber !== roundNumber ||
        !("clockVersion" in data) || data.clockVersion !== clockVersion) return;

    if (hostRound && data.type === "memorize" && hostRound.players.some(({ id, hasLeft }) => id === senderId && !hasLeft) &&
        members.some(({ id, connected }) => id === senderId && connected)) {
      const request = data as Partial<MemorizeRequest>;
      if (typeof request.requestId !== "number" || !Number.isSafeInteger(request.requestId)) return;
      const response: MemorizeResponse = {
        type: "memorized",
        roundNumber,
        clockVersion,
        requestId: request.requestId,
        cards: revealMemorizedCards(hostRound, senderId, request.positions, time, deadline),
      };
      send(senderId, response);
    } else if (!hostRound && senderId === hostId && data.type === "memorized") {
      const response = data as Partial<MemorizeResponse>;
      const cards = response.cards;
      if (response.requestId === requestId.current && Array.isArray(cards)) {
        setMemory((current) => current.roundNumber === roundNumber ? { ...current, revealed: cards } : current);
      }
    }
  }), [clockVersion, deadline, hostId, hostRound, members, paused, phase, receiveEmoji, receiveTurn, roundNumber,
    send, subscribe, turn.waitingForClock]);

  useEffect(() => {
    if (!paused && playerId !== hostId && hostConnected) send(hostId, { type: "round-sync" });
  }, [hostConnected, hostId, paused, playerId, send]);

  function choose(positions: number[]) {
    const time = performance.now();
    if (deadline === null || time >= deadline) return;
    const id = ++requestId.current;

    if (positions.length && !hostRound) {
      const request: MemorizeRequest = { type: "memorize", roundNumber, clockVersion, requestId: id, positions };
      if (!send(hostId, request)) {
        setMemory(emptySelection);
        return;
      }
    }

    setMemory({
      roundNumber,
      selected: positions,
      revealed: hostRound
        ? revealMemorizedCards(hostRound, playerId, positions, time, deadline)
        : revealed.filter(({ position }) => positions.includes(position)),
    });
  }

  function toggle(position: number) {
    if (!canSelect) return;
    if (selected.includes(position)) choose(selected.filter((card) => card !== position));
    else if (selected.length < limit) choose([...selected, position]);
  }

  function gameActions(action?: ReactNode) {
    return <div className="game-actions">{action}{settings}</div>;
  }

  if (pause || !scene || turn.waitingForClock || !connectionReady) {
    const hostPaused = pause?.reason === "host";
    const seconds = pause?.deadline === undefined ? null : Math.min(
      GAME_CONFIG.network.reconnectGracePeriodSeconds,
      Math.ceil(Math.max(0, pause.deadline - now) / 1_000)
    );
    return (
      <main className="game-screen">
        {gameActions(hostManagement)}
        <section className="round-results" aria-labelledby="pause-title">
          <h1 id="pause-title">{hostPaused ? "Partie en pause" : "Reconnexion à la table"}</h1>
          <p role="status">{hostPaused ? "En attente du retour de l’hôte." : "Ta place est conservée."}</p>
          {hostPaused && seconds !== null && <p>Délai de reprise <span role="timer">{seconds} s</span></p>}
          {canLeave && !hostManagement && <button type="button" onClick={onLeave}>Quitter la table</button>}
        </section>
      </main>
    );
  }

  if (scene.phase === "waiting") {
    return (
      <main className="game-screen">
        {gameActions()}
        <section className="round-results" aria-labelledby="waiting-title">
          <h1 id="waiting-title">{gameFinished ? "La partie est terminée" : "En attente de la prochaine manche"}</h1>
          {!gameFinished && (
            <>
              <p role="status">Tu entreras en jeu après la manche {roundNumber}.</p>
              <p>Ton score de départ sera le total le plus élevé à la fin de cette manche.</p>
            </>
          )}
          {canLeave && <button type="button" className="result-primary" onClick={onLeave}>Quitter la table</button>}
        </section>
      </main>
    );
  }

  if (scene.phase === "results") {
    if (turn.finalMotion) {
      return (
        <main className="game-screen">
          {gameActions()}
          <GameTable localPlayerId={playerId} cardMotion={turn.finalMotion} playSound={playSound}
            players={scene.result.players.map(({ id, pseudo, cards, handLayout }) => ({ id, pseudo, cardCount: cards.length, handLayout }))}
            controls={<section className="round-panel"><strong>Manche {roundNumber}</strong></section>} />
        </main>
      );
    }
    return (
      <RoundResults
        key={roundNumber}
        result={scene.result}
        hostManagement={hostManagement}
        settings={settings}
        roundNumber={roundNumber}
        remaining={turn.remaining}
        isHost={playerId === hostId}
        canStartNext={turn.canStartNext}
        waitingPlayers={hostRound ? members.filter(({ id }) => !hostRound.players.some((player) => player.id === id))
          .map(({ pseudo }) => pseudo) : []}
        toggleVariant={turn.toggleVariant}
        startNext={turn.startNext}
        onLeave={onLeave}
      />
    );
  }

  if (scene.phase === "transition") {
    return (
      <main className="game-screen">
        {gameActions(hostManagement)}
        <section className="round-results" aria-label="Transition">
          <h1>Manche {roundNumber}</h1>
          <p>Distribution dans <span role="timer">{Math.ceil(turn.remaining / 1_000)} s</span></p>
        </section>
      </main>
    );
  }

  const memorization = canSelect ? { revealed, selected, limit, toggle } : undefined;
  const turnControls = turn.view ? { view: turn.view, canPlay: turn.canPlay, act: turn.act } : null;
  const power = turnControls?.view.power;
  const localHand = turnControls?.view.players.find(({ id }) => id === playerId);
  const reaction = turnControls && localHand && turn.canReact ? {
    scope: [roundNumber, clockVersion, turnControls.view.number, turnControls.view.reaction.reference,
      localHand.handVersion, turnControls.view.hasDrawn, power?.kind].join(":"),
    play: turn.react,
  } : undefined;
  const powerControls = turnControls?.canPlay && power?.selection
    ? {
        kind: power.kind,
        selection: power.selection,
        chooseCard: (target: CardTarget) => {
          const hand = turnControls.view.players.find(({ id }) => id === target.playerId);
          if (hand) turn.act({ kind: "power-card", target, handVersion: hand.handVersion });
        },
        choosePlayer: (id: string) => turn.act({ kind: "power-player", playerId: id }),
      }
    : undefined;

  return (
    <main className="game-screen">
      {gameActions(hostManagement ?? (canLeave && <button type="button" className="game-leave" onClick={onLeave}>Quitter la table</button>))}
      {emojisEnabled && <div className="table-options">
        <EmojiButtons label="Emojis de la table" onChoose={chooseEmoji} />
      </div>}
      <GameTable
        localPlayerId={playerId}
        playSound={playSound}
        players={scene.phase === "playing" ? scene.turn.players : scene.players}
        memorization={memorization}
        dealing={phase === "dealing"}
        activePlayerId={turnControls?.view.playerId}
        protectedPlayerId={turnControls?.view.dutch?.announcerId}
        power={powerControls}
        exchangeTargets={power?.exchangeTargets}
        tableEmojis={emojisEnabled ? tableEmojis : undefined}
        reaction={reaction}
        cardMotion={turn.view?.cardMotion}
        drawnCard={turnControls?.canPlay ? turnControls.view.drawnCard ?? undefined : undefined}
        onReplace={turnControls?.canPlay && !power && turnControls.view.hasDrawn && localHand
          ? (position) => turn.act({ kind: "replace", position, handVersion: localHand.handVersion })
          : undefined}
        piles={turnControls ? null : undefined}
        controls={
          turnControls ? (
            <TurnPanel
              {...turnControls}
              remaining={turn.remaining}
              piles={<TurnPiles {...turnControls} feedback={feedback} />}
            />
          ) : phase === "dealing" ? (
            <section className="round-panel" aria-label="Distribution">
              <p role="status">Distribution des cartes</p>
            </section>
          ) : (
            <section className="round-panel" aria-label="Mémorisation">
              {memorizing ? (
                <>
                  <div className="round-heading">
                    <strong>{roundNumber > 1 ? `Manche ${roundNumber} · Mémorisation` : "Mémorisation"}</strong>
                    <span role="timer" className="round-timer">{Math.ceil(turn.remaining / 1_000)} s</span>
                  </div>
                  <p>{canSelect ? `Consulte jusqu’à ${limit} de tes cartes.` : "Connexion à l’hôte en cours…"}</p>
                  {canSelect && (
                    <button type="button" onClick={() => choose([])} disabled={selected.length === 0}>
                      Masquer mes cartes
                    </button>
                  )}
                </>
              ) : <p role="status">Mémorisation terminée</p>}
            </section>
          )
        }
      />
    </main>
  );
}
