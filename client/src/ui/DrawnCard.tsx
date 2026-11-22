import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from "react";
import type { CardFace } from "../game/cards";
import { describeCardFace } from "./cardLabels";
import { CardBackMark, CardFaceMark } from "./PlayingCard";
import { flyCard, flyToDiscard, reducedMotion } from "./cardAnimations";

type Drag = { pointer: number; x: number; y: number; moving: boolean; target?: HTMLElement };

export default function DrawnCard({ face, center, botName, onDrop, onSlide }: {
  face?: CardFace;
  center: RefObject<HTMLDivElement | null>;
  botName?: string;
  onDrop?: (position: number | null) => void;
  onSlide?: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  useLayoutEffect(() => {
    const origin = center.current?.querySelector(".deck-slot")?.getBoundingClientRect();
    const element = card.current;
    const target = element?.getBoundingClientRect();
    if (!element || !origin || !target) return;
    element.style.setProperty("--draw-from-x", `${origin.x + (origin.width - target.width) / 2 - target.x}px`);
    element.style.setProperty("--draw-from-y", `${origin.y + (origin.height - target.height) / 2 - target.y}px`);
    element.dataset.animated = "true";
    return () => { if (drag.current?.target) delete drag.current.target.dataset.dropTarget; };
  }, [center]);

  function targetAt(element: HTMLElement, x: number, y: number) {
    const discard = center.current?.querySelector<HTMLElement>(".discard-slot");
    const hand = element.parentElement?.querySelectorAll<HTMLElement>("[data-card-position]") ?? [];
    return [...(discard ? [discard] : []), ...hand].find((target) => {
      const { left, right, top, bottom } = target.getBoundingClientRect();
      return x >= left && x <= right && y >= top && y <= bottom;
    });
  }

  function reset(element: HTMLElement, returnCard: boolean) {
    if (drag.current?.target) delete drag.current.target.dataset.dropTarget;
    drag.current = null;
    const from = element.style.translate;
    element.style.translate = "";
    delete element.dataset.dragging;
    if (from && returnCard && !reducedMotion()) {
      element.animate([{ translate: from }, { translate: "0px 0px" }], { duration: 160, easing: "ease-out" });
    }
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!onDrop || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.getAnimations().forEach((animation) => animation.cancel());
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moving: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const x = event.clientX - current.x;
    const y = event.clientY - current.y;
    if (!current.moving && Math.hypot(x, y) < 5) return;
    if (!current.moving) onSlide?.();
    current.moving = true;
    const element = event.currentTarget;
    element.dataset.dragging = "true";
    element.style.translate = `${x}px ${y}px`;
    const target = targetAt(element, event.clientX, event.clientY);
    if (target === current.target) return;
    if (current.target) delete current.target.dataset.dropTarget;
    current.target = target;
    if (target) target.dataset.dropTarget = "true";
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const element = event.currentTarget;
    const target = current.moving ? targetAt(element, event.clientX, event.clientY) : undefined;
    if (target && onDrop) {
      const position = target.dataset.cardPosition;
      const from = element.getBoundingClientRect();
      if (position === undefined) flyToDiscard(from, target, "discard", element.querySelector(".card-face"));
      else flyCard(from, target.getBoundingClientRect(), "discard");
      reset(element, false);
      onDrop(position === undefined ? null : Number(position));
    } else reset(element, true);
  }

  function cancelPointer(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer === event.pointerId) reset(event.currentTarget, true);
  }

  return (
    <div ref={card} className={`drawn-card${botName ? " bot-drawn-card" : ""}`} role="img"
      data-draggable={onDrop ? true : undefined} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}
      aria-description={onDrop ? "Glisse la carte sur ta main ou sur la défausse." : undefined}
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
