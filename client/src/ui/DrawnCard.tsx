import { useLayoutEffect, useRef, type RefObject } from "react";
import type { CardFace } from "../game/cards";
import { describeCardFace } from "./cardLabels";
import { CardBackMark, CardFaceMark } from "./PlayingCard";

export default function DrawnCard({ face, center, botName }: {
  face?: CardFace;
  center: RefObject<HTMLDivElement | null>;
  botName?: string;
}) {
  const card = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const origin = center.current?.querySelector(".deck-slot")?.getBoundingClientRect();
    const element = card.current;
    const target = element?.getBoundingClientRect();
    if (!element || !origin || !target) return;
    element.style.setProperty("--draw-from-x", `${origin.x + (origin.width - target.width) / 2 - target.x}px`);
    element.style.setProperty("--draw-from-y", `${origin.y + (origin.height - target.height) / 2 - target.y}px`);
    element.dataset.animated = "true";
  }, [center]);

  return (
    <div ref={card} className={`drawn-card${botName ? " bot-drawn-card" : ""}`} role="img"
      aria-label={face ? `Carte tirée, ${describeCardFace(face)}` : `Carte tirée par ${botName}, face cachée`}>
      {face ? (
        <span className="drawn-card-turn" aria-hidden="true">
          <span className="drawn-card-front"><CardFaceMark face={face} /></span>
          <span className="drawn-card-back"><CardBackMark /></span>
        </span>
      ) : <span className="bot-drawn-back"><CardBackMark /></span>}
    </div>
  );
}
