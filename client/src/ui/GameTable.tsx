import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Crown, Megaphone, WifiOff } from "lucide-react";
import { emojis } from "../../../shared/hubSocial.json";
import type { HubPlayer } from "../../../shared/hubTypes";
import { GAME_CONFIG } from "../config/gameConfig";
import type { CardFace } from "../game/cards";
import type { CardTarget, PowerKind } from "../game/gameTypes";
import { getHandLayout, type HandLayout } from "../game/handLayout";
import type { MemorizedCard } from "../game/memorization";
import { canTargetCard, sameTarget, type PowerView } from "../game/powers";
import { TURN_DURATION_MS, type TurnView } from "../game/turn";
import PlayingCard, { CardFaceMark } from "./PlayingCard";
import DrawnCard from "./DrawnCard";
import { animateDeal, animatePublicMove, dealCardSpacing, flyToDiscard } from "./cardAnimations";
import type { TableEmoji } from "../network/useTableEmojis";
import type { PlayGameSound } from "./useCardFeedback";
import { describeCardFace } from "./cardLabels";
import { useTapAction } from "./useTapAction";
import PerimeterClock from "./PerimeterClock";
import PlayerAvatar from "./PlayerAvatar";
import { tablePlayerName } from "./playerAvatarConfig";

export type TablePlayer = {
  id: string;
  pseudo: string;
  cardCount: number;
  handLayout?: HandLayout;
};

type GameTableProps = {
  localPlayerId: string;
  players: TablePlayer[];
  members?: ReadonlyMap<string, HubPlayer>;
  controls: ReactNode;
  piles?: ReactNode;
  activePlayerId?: string;
  opponentClock?: { turn: number; remaining: number };
  dealingUntil?: number;
  leaderIds?: readonly string[];
  protectedPlayerId?: string;
  tableEmojis?: ReadonlyMap<string, TableEmoji>;
  onReplace?: (position: number) => void;
  onDiscardDrawn?: () => void;
  dutchControl?: { armed: boolean; toggle: () => void };
  look?: { target: CardTarget; remaining: number };
  reaction?: { scope: string; play: (position: number) => void };
  drawnCard?: CardFace;
  botDrawingId?: string;
  cardMotion?: TurnView["cardMotion"];
  exchangeTargets?: CardTarget[];
  playSound: PlayGameSound;
  power?: {
    kind: PowerKind;
    selection: NonNullable<PowerView["selection"]>;
    chooseCard: (target: CardTarget) => void;
    choosePlayer: (playerId: string) => void;
    hideCard: () => void;
  };
  memorization?: {
    revealed: MemorizedCard[];
    chosen: number[];
    limit: number;
    toggle: (position: number) => void;
  };
};

const positionLayouts: Record<number, string[]> = {
  2: ["top"],
  3: ["left", "right"],
  4: ["left", "top", "right"],
  5: ["left-bottom", "left-top", "right-top", "right-bottom"],
  6: ["left-bottom", "left-top", "top", "right-top", "right-bottom"],
};

function DutchButton({ armed, toggle }: NonNullable<GameTableProps["dutchControl"]>) {
  const tap = useTapAction(toggle);
  return (
    <button type="button" className="dutch-icon" aria-label="Annoncer Dutch en fin de tour"
      title="Annoncer Dutch en fin de tour" aria-pressed={armed} {...tap}>
      <Megaphone size={15} aria-hidden="true" />
    </button>
  );
}

export default function GameTable({
  localPlayerId,
  players,
  members,
  controls,
  piles,
  activePlayerId,
  opponentClock,
  dealingUntil,
  leaderIds,
  protectedPlayerId,
  tableEmojis,
  onReplace,
  onDiscardDrawn,
  dutchControl,
  look,
  reaction,
  drawnCard,
  botDrawingId,
  cardMotion,
  exchangeTargets,
  playSound,
  memorization,
  power,
}: GameTableProps) {
  const center = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const lastMotion = useRef(0);
  const lastDealSound = useRef(-1);
  const dealing = dealingUntil !== undefined;
  const dealCardCount = dealing ? players.reduce((count, player) => count + player.cardCount, 0) : 0;
  const publicMove = cardMotion?.move.kind === "reaction" && cardMotion.move.playerId === localPlayerId ? undefined : cardMotion;
  const move = publicMove?.move;
  useLayoutEffect(() => {
    const board = table.current;
    if (dealingUntil === undefined || !board) return;
    let stop = animateDeal(board, dealingUntil);
    const resize = () => {
      stop?.();
      stop = animateDeal(board, dealingUntil);
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      stop?.();
    };
  }, [dealingUntil]);

  useEffect(() => {
    if (dealingUntil === undefined) {
      lastDealSound.current = -1;
      return;
    }
    const start = dealingUntil - GAME_CONFIG.round.dealingMs;
    const spacing = dealCardSpacing(dealCardCount);
    const lateBy = Math.min(spacing, 125);
    const now = performance.now();
    const timers: number[] = [];
    for (let index = lastDealSound.current + 1; index < dealCardCount; index++) {
      const at = start + index * spacing;
      if (at < now - lateBy) continue;
      timers.push(window.setTimeout(() => {
        if (index <= lastDealSound.current || performance.now() > at + lateBy) return;
        lastDealSound.current = index;
        playSound("deal");
      }, at - now));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dealingUntil, dealCardCount, playSound]);

  useLayoutEffect(() => {
    if (!publicMove || !table.current || publicMove.id <= lastMotion.current) return;
    lastMotion.current = publicMove.id;
    animatePublicMove(table.current, publicMove.move);
    playSound(publicMove.move.kind === "bot-discard" ? "discard" : publicMove.move.kind);
  }, [publicMove, playSound]);

  function replaceCard(position: number) {
    const target = center.current?.querySelector(".discard-slot");
    const source = table.current?.querySelector(`.position-bottom [data-card-position="${position}"]`);
    if (source && target) flyToDiscard(source.getBoundingClientRect(), target, "discard");
    onReplace?.(position);
  }
  const localIndex = players.findIndex((player) => player.id === localPlayerId);
  const opponents = localIndex < 0 ? players : [...players.slice(localIndex + 1), ...players.slice(0, localIndex)];
  const positions = positionLayouts[players.length] || [];
  const positionedPlayers = opponents.map((player, index) => ({
    player,
    position: positions[index] || "top",
  }));
  if (localIndex >= 0) positionedPlayers.push({ player: players[localIndex], position: "bottom" });

  return (
    <div className={`game-table${dealing ? " is-dealing" : ""}${players.length >= 4 ? " is-large-table" : ""}`}
      ref={table} data-player-count={players.length}>
      <div className="table-center" ref={center}>
        {controls}
        {piles === undefined ? (
          <div className="table-piles">
            <div className="deck-placeholder">Pioche</div>
            <div className="discard-placeholder">Défausse</div>
          </div>
        ) : piles}
      </div>

      {positionedPlayers.map(({ player, position }) => {
        const dealSeat = dealing ? players.indexOf(player) : undefined;
        const ownSelection = position === "bottom" ? memorization : undefined;
        const replace = position === "bottom" ? onReplace : undefined;
        const react = position === "bottom" ? reaction : undefined;
        const active = player.id === activePlayerId;
        const clock = active && opponentClock;
        const giveToPlayer = power?.kind === "give-card" && canTargetCard(power.kind, localPlayerId, player.id, protectedPlayerId);
        const canChooseFromHand = power && power.selection.remaining > 0 &&
          canTargetCard(power.kind, localPlayerId, player.id, protectedPlayerId);
        const member = members?.get(player.id);
        const disconnected = members !== undefined && !member?.connected;
        const name = tablePlayerName(player.pseudo, member?.accountId);
        const announce = position === "bottom" ? dutchControl : undefined;
        const emoji = tableEmojis?.get(player.id);
        const layout = getHandLayout(player.cardCount, player.handLayout);
        const handStyle = { "--hand-columns": layout.columns } as CSSProperties;
        const played = (move?.kind === "reaction" || move?.kind === "bot-discard") && move.playerId === player.id ? move : undefined;
        const slot = played?.slot;
        return (
          <div className={`table-player position-${position}${active ? " is-active-player" : ""}`} key={player.id} data-hand-player={player.id}
            data-gift-recipient={giveToPlayer ? player.id : undefined}>
            <div className="player-name">
              <span className="player-identity">
                {disconnected ? <span className="table-disconnected" role="img" aria-label="Déconnecté" title="Déconnecté">
                  <WifiOff size={15} aria-hidden="true" />
                </span> : (member?.accountId || member?.isBot) && <span className="player-credentials">
                  <PlayerAvatar id={member.accountId ?? player.id} name={player.pseudo} style={member.avatarStyle}
                    photoId={member.avatarPhotoId} isBot={member.isBot} mini />
                  {member.rating !== undefined && <small className="table-rn" aria-label={`Indice RN ${Math.round(member.rating)}`}
                    title={`Indice RN ${Math.round(member.rating)}`}>{Math.round(member.rating)}</small>}
                </span>}
                <span className="player-name-label" title={player.pseudo !== name ? player.pseudo : undefined}>
                  <span className="player-name-text">
                    {name}
                    {leaderIds?.includes(player.id) && (
                      <span className="leader-crown" role="img" aria-label="En tête du classement" title="En tête du classement">
                        <Crown size={13} aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  {giveToPlayer && (
                    <button type="button" className="gift-recipient-name" aria-label={`Donner une carte à ${player.pseudo}`}
                      onClick={(event) => { if (event.detail === 0) power.choosePlayer(player.id); }} />
                  )}
                  {clock && <PerimeterClock key={clock.turn} remaining={clock.remaining} duration={TURN_DURATION_MS} label="Temps restant" />}
                </span>
              </span>
              {announce && <DutchButton {...announce} />}
              {player.id === protectedPlayerId && (
                <span className="dutch-icon dutch-announced" role="img" aria-label={`${player.pseudo} a annoncé Dutch`}
                  title={`${player.pseudo} a annoncé Dutch`}>
                  <Megaphone size={15} aria-hidden="true" />
                </span>
              )}
              {emoji && <span key={emoji.until} className="table-emoji" role="status"
                aria-label={`${player.pseudo} · ${emojis[emoji.emoji].label}`}>{emojis[emoji.emoji].symbol}</span>}
            </div>
            <div className="hand-line">
              <div className="player-cards" style={handStyle}>
                {Array.from({ length: player.cardCount }, (_, index) => {
                  const target = { playerId: player.id, position: index };
                  const viewed = look && sameTarget(look.target, target);
                  const selected = power?.selection.targets.some((card) => sameTarget(card, target));
                  const exchangeSelected = exchangeTargets?.some((card) => sameTarget(card, target));
                  const canChoose = canChooseFromHand && !selected;
                  const powerFace = power?.selection.revealed.find(({ target: card }) => sameTarget(card, target))?.face;
                  const revealed = powerFace ?? ownSelection?.revealed.find(({ position }) => position === index)?.face;
                  const cardAction = viewed && powerFace && power ? power.hideCard
                    : canChoose ? () => power.chooseCard(target)
                    : ownSelection ? () => ownSelection.toggle(index)
                    : replace && (() => replaceCard(index));
                  const actionLabel = viewed && powerFace ? `Retourner la carte ${index + 1} de ${player.pseudo}, ${describeCardFace(powerFace)}`
                    : canChoose ? `Choisir la carte ${index + 1} de ${player.pseudo}`
                    : replace ? `Remplacer la carte ${index + 1}` : undefined;
                  return (
                    <PlayingCard
                      key={layout.slots[index]}
                      index={index}
                      slot={layout.slots[index]}
                      dealOrder={dealSeat === undefined ? undefined : index * players.length + dealSeat}
                      face={revealed}
                      powerReveal={!!powerFace}
                      onToggle={cardAction}
                      reaction={react && !viewed ? { scope: react.scope, center, play: () => react.play(index), playSound } : undefined}
                      actionLabel={actionLabel}
                      selected={selected || !!(ownSelection && revealed)}
                      exchangeSelected={exchangeSelected}
                      lookRemaining={viewed ? look.remaining : undefined}
                      disabled={ownSelection && ownSelection.chosen.length >= ownSelection.limit
                        && !ownSelection.chosen.includes(index)}
                    />
                  );
                })}
                {played && slot !== undefined && (
                  <span className="discard-origin" aria-hidden="true"
                    style={{ gridColumn: Math.floor(slot / 2) + 1, gridRow: slot % 2 + 1 }}>
                    <CardFaceMark face={played.face} />
                  </span>
                )}
              </div>
              {position === "bottom" && drawnCard && (
                <DrawnCard face={drawnCard} center={center} onSlide={() => playSound("slide")}
                  onDrop={onDiscardDrawn && ((target) => target === null ? onDiscardDrawn() : replaceCard(target))} />
              )}
              {botDrawingId === player.id && <DrawnCard center={center} botName={player.pseudo} />}
              {played && slot === undefined && (
                <span className="drawn-card bot-drawn-card discard-origin" aria-hidden="true">
                  <CardFaceMark face={played.face} />
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
