import { useLayoutEffect, useRef, type RefObject } from "react";
import type { CardFace } from "../game/cards";
import { LOOK_DURATION_MS } from "../game/powers";
import { describeCardFace, suits } from "./cardLabels";
import { useCardGestures, type CardReaction } from "./useCardGestures";
import { reducedMotion } from "./cardAnimations";
import PerimeterClock from "./PerimeterClock";

type PlayingCardProps = {
  index: number;
  slot?: number;
  face?: CardFace;
  onToggle?: () => void;
  disabled?: boolean;
  actionLabel?: string;
  selected?: boolean;
  exchangeSelected?: boolean;
  dealOrder?: number;
  reaction?: CardReaction;
  powerReveal?: boolean;
  lookRemaining?: number;
};

export function CardFaceMark({ face }: { face: CardFace }) {
  const suit = face.suit ? suits[face.suit] : undefined;
  const joker = face.rank === "JOKER";
  return (
    <span className={`card-face${suit?.red ? " red-suit" : ""}${joker ? " joker-face" : ""}`} aria-hidden="true">
      <b>{joker ? "Joker" : face.rank}</b>
      {suit && <span>{suit.symbol}</span>}
    </span>
  );
}

export function CardBackMark({ backRef }: { backRef?: RefObject<HTMLSpanElement | null> } = {}) {
  return <span ref={backRef} className="card-back-pattern" aria-hidden="true"><span>F</span></span>;
}

export default function PlayingCard({ index, slot, face, onToggle, disabled, actionLabel, selected, exchangeSelected, dealOrder, reaction,
  powerReveal = false, lookRemaining }: PlayingCardProps) {
  const card = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLSpanElement>(null);
  const previouslyRevealed = useRef(false);
  const gestures = useCardGestures(card, reaction, onToggle, actionLabel);
  useLayoutEffect(() => {
    if (previouslyRevealed.current && !powerReveal && !reducedMotion()) {
      back.current?.animate([{ transform: "rotateY(90deg)" }, { transform: "rotateY(0deg)" }], { duration: 200 });
    }
    previouslyRevealed.current = powerReveal;
  }, [powerReveal]);
  const shared = {
    className: `playing-card ${face ? "face-up" : "face-down"}`,
    "aria-label": actionLabel ?? `Carte ${index + 1} ${face ? describeCardFace(face) : "face cachée"}`,
    "data-selected": selected || undefined,
    "data-exchange-selected": exchangeSelected || undefined,
    "data-card-position": index,
    "data-hand-slot": slot,
    "data-power-reveal": powerReveal || undefined,
    "data-look-card": lookRemaining !== undefined || undefined,
    style: {
      animationDelay: dealOrder === undefined ? undefined : `${dealOrder * 45}ms`,
      gridColumn: slot === undefined ? undefined : Math.floor(slot / 2) + 1,
      gridRow: slot === undefined ? undefined : slot % 2 + 1,
    },
  };
  const content = face && powerReveal ? (
    <span className="power-card-turn" aria-hidden="true">
      <span className="drawn-card-front"><CardFaceMark face={face} /></span>
      <span className="drawn-card-back"><CardBackMark /></span>
    </span>
  ) : face ? <CardFaceMark face={face} /> : <CardBackMark backRef={back} />;
  const clock = lookRemaining !== undefined && (
    <PerimeterClock remaining={lookRemaining} duration={LOOK_DURATION_MS} label="Temps de consultation de la carte" />
  );

  if (reaction) {
    return (
      <button {...shared} ref={card} type="button" data-reactable="true" data-react-only={onToggle ? undefined : "true"} aria-keyshortcuts="R"
        aria-description="Au clavier, appuyez sur R pour réagir."
        onPointerDown={gestures.pointerDown} onPointerMove={gestures.pointerMove} onPointerUp={gestures.pointerUp}
        onPointerCancel={gestures.cancelPointer} onLostPointerCapture={gestures.cancelPointer}
        onClick={(event) => {
          if (event.detail === 0) {
            if (onToggle) onToggle();
            else gestures.playReaction(event.currentTarget);
          }
        }}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() !== "r" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          gestures.playReaction(event.currentTarget);
        }}>
        {content}
        {clock}
      </button>
    );
  }

  if (onToggle) {
    return (
      <button {...shared} type="button" disabled={disabled}
        aria-pressed={actionLabel ? undefined : !!face} onClick={onToggle}>
        {content}
        {clock}
      </button>
    );
  }
  return <div {...shared}>{content}{clock}</div>;
}
