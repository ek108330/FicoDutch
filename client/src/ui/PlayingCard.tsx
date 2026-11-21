import type { CardFace } from "../game/cards";
import { describeCardFace, suits } from "./cardLabels";

type PlayingCardProps = {
  index: number;
  face?: CardFace;
  onToggle?: () => void;
  disabled?: boolean;
  actionLabel?: string;
  selected?: boolean;
  dealOrder?: number;
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

export default function PlayingCard({ index, face, onToggle, disabled, actionLabel, selected, dealOrder }: PlayingCardProps) {
  const shared = {
    className: `playing-card ${face ? "face-up" : "face-down"}`,
    "aria-label": actionLabel ?? `Carte ${index + 1} ${face ? describeCardFace(face) : "face cachée"}`,
    "data-selected": selected || undefined,
    style: dealOrder === undefined ? undefined : { animationDelay: `${dealOrder * 45}ms` },
  };
  const content = face ? (
    <CardFaceMark face={face} />
  ) : (
    <span className="card-back-pattern" aria-hidden="true">
      <span>F</span>
    </span>
  );

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
