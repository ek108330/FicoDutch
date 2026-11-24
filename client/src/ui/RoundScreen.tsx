import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GAME_CONFIG } from "../config/gameConfig";
import type { HubPlayer } from "../../../shared/hubTypes";
import { memorizationLimit } from "../game/memorization";
import type { CardTarget, GameState } from "../game/gameTypes";
import { useRoundTurn, type UpdateHostRound } from "../game/useRoundTurn";
import type { useHubPeers } from "../network/useHubPeers";
import { useTableEmojis } from "../network/useTableEmojis";
import GameTable from "./GameTable";
import EmojiButtons from "./EmojiButtons";
import { useCardFeedback, type PlayGameSound } from "./useCardFeedback";
import { TurnPanel, TurnPiles } from "./TurnControls";
import RoundResults from "./RoundResults";
import PerimeterClock from "./PerimeterClock";
import { CardBackMark } from "./PlayingCard";
import { tablePlayerName } from "./playerAvatarConfig";

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
  onRestart: () => void;
  onInterrupt?: () => void;
  restarting: boolean;
  settings: ReactNode;
  playSound: PlayGameSound;
  canLeave: boolean;
  clockVersion: number;
  pause: { reason: "host" | "local"; deadline?: number } | null;
};

type Memorization = { roundNumber: number; chosen: number[]; visible: number[] };
const emptySelection: Memorization = { roundNumber: 0, chosen: [], visible: [] };

export default function RoundScreen({
  hubId, hostId, playerId, deadline: firstDeadline, members, gameFinished, hostRound,
  peers, updateHostRound, onLeave, onRestart, onInterrupt, restarting, settings, playSound, canLeave, clockVersion, pause,
}: RoundScreenProps) {
  const { hostConnected, send, subscribe } = peers;
  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const [now, setNow] = useState(() => performance.now());
  const [memory, setMemory] = useState<Memorization>(emptySelection);
  const visibleMemory = useRef(0);
  const heardDutch = useRef<string>(null);
  const heardTurn = useRef<string>(null);
  const paused = pause !== null;
  const turn = useRoundTurn({ hubId, hostId, playerId, members, firstDeadline,
    hostRound, peers, updateHostRound, now, paused, clockVersion });
  const { scene, deadline, receive: receiveTurn } = turn;
  const phase = scene?.phase;
  const roundNumber = scene?.roundNumber ?? 0;
  const localMemory = memory.roundNumber === roundNumber ? memory : emptySelection;
  const memorized = scene?.phase === "memorization" ? scene.memorized : [];
  const chosen = [...new Set([...memorized.map(({ position }) => position), ...localMemory.chosen])];
  const revealed = memorized.filter(({ position }) => localMemory.visible.includes(position));
  const limit = memorizationLimit(scene?.phase === "memorization" && scene.sixCards);
  const memorizing = phase === "memorization" && turn.remaining > 0;
  const connectionReady = playerId === hostId ? !!hostRound : hostConnected;
  const canSelect = !paused && !turn.waitingForClock && memorizing && connectionReady;
  const finished = !paused && (phase === "results" && deadline === null || phase === "waiting" && gameFinished);
  const ticking = !finished || !!turn.finalMotion;
  const emojisEnabled = !paused && !turn.waitingForClock && connectionReady && canLeave &&
    (phase === "memorization" || phase === "playing");
  const feedback = useCardFeedback(
    !paused && !turn.waitingForClock && connectionReady ? turn.view : null, roundNumber, clockVersion, playSound,
  );
  const announcement = !paused && !turn.waitingForClock && connectionReady ? turn.announcement : undefined;
  const announcementId = announcement ? `${roundNumber}:${announcement.id}` : null;
  const localTurn = turn.canPlay && turn.view ? `${roundNumber}:${turn.view.number}` : null;
  useEffect(() => {
    if (!localTurn || heardTurn.current === localTurn) return;
    heardTurn.current = localTurn;
    playSound("turn");
  }, [localTurn, playSound]);
  useEffect(() => {
    if (!announcementId || heardDutch.current === announcementId) return;
    heardDutch.current = announcementId;
    playSound("dutch");
  }, [announcementId, playSound]);
  const soundEmoji = useCallback(() => playSound("emoji"), [playSound]);
  const { choose: chooseEmoji, receive: receiveEmoji, visible: tableEmojis } = useTableEmojis({
    playerId, hostId, roundNumber, clockVersion, enabled: emojisEnabled, now, hostRound, members, send, onShow: soundEmoji,
  });

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

  useEffect(() => subscribe((senderId, data) => {
    if (!data || typeof data !== "object" || !("type" in data)) return;
    if (data.type === "table-emoji" || data.type === "table-emoji-request") {
      receiveEmoji(senderId, data);
    } else {
      receiveTurn(senderId, data);
    }
  }), [receiveEmoji, receiveTurn, subscribe]);

  useEffect(() => {
    if (!paused && playerId !== hostId && hostConnected) send(hostId, { type: "round-sync" });
  }, [hostConnected, hostId, paused, playerId, send]);

  function toggle(position: number) {
    if (!canSelect || deadline === null || performance.now() >= deadline) return;
    const { visible } = localMemory;
    if (visible.includes(position)) {
      setMemory({ roundNumber, chosen, visible: visible.filter((card) => card !== position) });
      return;
    }
    if (!chosen.includes(position) && chosen.length >= limit) return;
    if (!memorized.some((card) => card.position === position) && !turn.memorize(position)) return;
    setMemory({ roundNumber, chosen: chosen.includes(position) ? chosen : [...chosen, position], visible: [...visible, position] });
  }

  function gameActions(action?: ReactNode) {
    return <div className="game-actions">{action}{settings}</div>;
  }

  if (pause || !scene || turn.waitingForClock || !connectionReady) {
    const hostPaused = pause?.reason === "host";
    return (
      <main className="game-screen">
        {gameActions()}
        <section className="round-results" aria-labelledby="pause-title">
          {hostPaused && pause.deadline !== undefined && <PerimeterClock remaining={pause.deadline - now}
            duration={GAME_CONFIG.network.reconnectGracePeriodSeconds * 1_000} label="Délai de reprise" radius={15} />}
          <h1 id="pause-title">{hostPaused ? "Partie en pause" : "Reconnexion à la table"}</h1>
          <p role="status">{hostPaused ? "En attente du retour de l’hôte." : "Ta place est conservée."}</p>
          {canLeave && playerId !== hostId && <button type="button" onClick={onLeave}>Quitter la table</button>}
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
        <main className="game-screen table-screen">
          {gameActions()}
          <GameTable localPlayerId={playerId} members={membersById} cardMotion={turn.finalMotion} playSound={playSound} leaderIds={scene.leaderIds}
            players={scene.result.players.map(({ id, pseudo, cards, handLayout }) => ({ id, pseudo, cardCount: cards.length, handLayout }))}
            controls={<section className="round-panel"><strong>Manche {roundNumber}</strong></section>} />
        </main>
      );
    }
    return (
      <RoundResults
        key={roundNumber}
        result={scene.result}
        settings={settings}
        roundNumber={roundNumber}
        remaining={turn.remaining}
        isHost={playerId === hostId}
        canEditVariants={playerId === hostId && !restarting}
        canStartNext={turn.canStartNext}
        waitingPlayers={hostRound ? members.filter(({ id }) => !hostRound.players.some((player) => player.id === id))
          .map(({ pseudo }) => pseudo) : []}
        toggleVariant={turn.toggleVariant}
        startNext={turn.startNext}
        onLeave={onLeave}
        onRestart={onRestart}
        onInterrupt={onInterrupt}
        gameFinished={gameFinished}
        canRestart={gameFinished && !restarting && members.filter(({ connected }) => connected).length >= GAME_CONFIG.players.min}
      />
    );
  }

  const memorization = canSelect ? { revealed, chosen, limit, toggle } : undefined;
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
        hideCard: () => turn.act({ kind: "power-hide" }),
      }
    : undefined;

  return (
    <main className="game-screen table-screen">
      {gameActions(canLeave && playerId !== hostId && <button type="button" className="game-leave" onClick={onLeave}>Quitter la table</button>)}
      <GameTable
        localPlayerId={playerId}
        members={membersById}
        playSound={playSound}
        players={scene.phase === "playing" ? scene.turn.players : scene.players}
        memorization={memorization}
        dealingUntil={phase === "dealing" ? deadline ?? undefined : undefined}
        leaderIds={scene.leaderIds}
        activePlayerId={turnControls?.view.playerId}
        opponentClock={turnControls && turnControls.view.playerId !== playerId &&
          !turnControls.view.finalReaction && !power?.lookTarget && !power?.pendingSwap
          ? { turn: turnControls.view.number, remaining: turn.remaining } : undefined}
        protectedPlayerId={turnControls?.view.dutch?.announcerId}
        dutchAnnouncement={announcement && tablePlayerName(announcement.pseudo, membersById.get(announcement.id)?.accountId)}
        dutchControl={turnControls?.canPlay && turnControls.view.canAnnounceDutch ? {
          armed: turnControls.view.dutchArmed,
          toggle: () => turn.act({ kind: "dutch-intent", enabled: !turnControls.view.dutchArmed }),
        } : undefined}
        look={power?.lookTarget && turn.remaining > 0 ? { target: power.lookTarget, remaining: turn.remaining } : undefined}
        power={powerControls}
        exchangeTargets={power?.exchangeTargets}
        tableEmojis={emojisEnabled ? tableEmojis : undefined}
        reaction={reaction}
        cardMotion={turn.view?.cardMotion}
        drawnCard={turnControls?.canPlay ? turnControls.view.drawnCard ?? undefined : undefined}
        onDiscardDrawn={turnControls?.canPlay && turnControls.view.hasDrawn ? () => turn.act({ kind: "discard" }) : undefined}
        botDrawingId={turn.view?.hasDrawn && turn.view.players.some(({ id, isBot }) => id === turn.view?.playerId && isBot)
          ? turn.view.playerId : undefined}
        onReplace={turnControls?.canPlay && !power && turnControls.view.hasDrawn && localHand
          ? (position) => turn.act({ kind: "replace", position, handVersion: localHand.handVersion })
          : undefined}
        piles={turnControls ? null : phase === "dealing" ? (
          <section className="table-piles" aria-label="Distribution des cartes">
            <span className="pile-card deck-slot pile-backed deal-deck" data-stacked="true" aria-hidden="true"><CardBackMark /></span>
          </section>
        ) : undefined}
        controls={
          turnControls ? (
            <TurnPanel
              {...turnControls}
              displayName={(id, name) => tablePlayerName(name, membersById.get(id)?.accountId)}
              remaining={turn.remaining}
              piles={<TurnPiles {...turnControls} feedback={feedback} onGiftSlide={() => playSound("slide")} />}
            />
          ) : phase === "dealing" ? null : (
            <section className="round-panel memorization-panel" aria-label="Mémorisation">
              <PerimeterClock remaining={turn.remaining} duration={GAME_CONFIG.round.memorizationMs}
                label="Temps de mémorisation" />
              <strong>Mémorisation</strong>
            </section>
          )
        }
      />
      {emojisEnabled && <div className="table-options">
        <EmojiButtons label="Emojis de la table" table onChoose={chooseEmoji} />
      </div>}
    </main>
  );
}
