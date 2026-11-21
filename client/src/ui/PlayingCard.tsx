import { useRef } from "react";
import type { CardFace } from "../game/cards";
import { describeCardFace, suits } from "./cardLabels";
import { useCardGestures, type CardReaction } from "./useCardGestures";

type PlayingCardProps = {
  index: number;
  face?: CardFace;
  onToggle?: () => void;
  disabled?: boolean;
  actionLabel?: string;
  selected?: boolean;
  dealOrder?: number;
  reaction?: CardReaction;
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

export function CardBackMark() {
  return <span className="card-back-pattern" aria-hidden="true"><span>F</span></span>;
}

export default function PlayingCard({ index, face, onToggle, disabled, actionLabel, selected, dealOrder, reaction }: PlayingCardProps) {
  const card = useRef<HTMLButtonElement>(null);
  const gestures = useCardGestures(card, reaction, onToggle, actionLabel);
  const shared = {
    className: `playing-card ${face ? "face-up" : "face-down"}`,
    "aria-label": actionLabel ?? `Carte ${index + 1} ${face ? describeCardFace(face) : "face cachée"}`,
    "data-selected": selected || undefined,
    style: dealOrder === undefined ? undefined : { animationDelay: `${dealOrder * 45}ms` },
  };
  const content = face ? <CardFaceMark face={face} /> : <CardBackMark />;

  if (reaction) {
    return (
      <button {...shared} ref={card} type="button" data-reactable="true" data-react-only={onToggle ? undefined : "true"} aria-keyshortcuts="R"
        aria-description="Touchez trois fois ou glissez vers le centre pour réagir. Au clavier, appuyez sur R."
        onPointerDown={gestures.pointerDown} onPointerMove={gestures.pointerMove} onPointerUp={gestures.pointerUp}
        onPointerCancel={gestures.cancelPointer} onLostPointerCapture={gestures.cancelPointer}
        onClick={(event) => { if (event.detail === 0) (onToggle ?? reaction.play)(); }}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() !== "r" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          reaction.play();
        }}>
        {content}
      </button>
    );
  }

  if (onToggle) {
    return (
      <button {...shared} type="button" disabled={disabled}
        aria-pressed={actionLabel ? undefined : !!face} onClick={onToggle}>
        {content}
      </button>
    );
  }
  return <div {...shared}>{content}</div>;
}
