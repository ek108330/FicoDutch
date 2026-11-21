import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CardBackMark } from "./PlayingCard";

type GiftDrag = {
  pointerId: number;
  x: number;
  y: number;
  source: DOMRect;
  moving: boolean;
  target?: HTMLElement;
};

export default function GiftDeckCard({ children, onGift, onSlide }: {
  children: ReactNode;
  onGift: (playerId: string) => void;
  onSlide: () => void;
}) {
  const drag = useRef<GiftDrag | null>(null);
  const [ghost, setGhost] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => () => {
    if (drag.current?.target) delete drag.current.target.dataset.dropTarget;
  }, []);

  function targetAt({ currentTarget, clientX, clientY }: PointerEvent<HTMLButtonElement>) {
    const seats = currentTarget.closest(".game-table")?.querySelectorAll<HTMLElement>("[data-gift-recipient]");
    return Array.from(seats ?? []).find((seat) => {
      const { left, right, top, bottom } = seat.getBoundingClientRect();
      return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
    });
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const card = event.currentTarget.querySelector(".deck-slot");
    if (!card?.contains(event.target as Node)) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      source: card.getBoundingClientRect(), moving: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const x = event.clientX - current.x;
    const y = event.clientY - current.y;
    if (!current.moving && Math.hypot(x, y) < 5) return;
    if (!current.moving) onSlide();
    current.moving = true;
    const { left, top, width, height } = current.source;
    setGhost({ left: left + x, top: top + y, width, height });
    const target = targetAt(event);
    if (target === current.target) return;
    if (current.target) delete current.target.dataset.dropTarget;
    current.target = target;
    if (target) target.dataset.dropTarget = "true";
  }

  function finish(event: PointerEvent<HTMLButtonElement>, drop = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const recipient = drop && current.moving ? targetAt(event)?.dataset.giftRecipient : undefined;
    if (current.target) delete current.target.dataset.dropTarget;
    drag.current = null;
    setGhost(null);
    if (recipient) onGift(recipient);
  }

  return (
    <>
      <button className="pile-slot gift-deck" type="button" aria-label="Carte de la pioche à donner"
        aria-description="Glisse la carte vers un joueur ou choisis son nom au clavier."
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => finish(event, true)}
        onPointerCancel={finish} onLostPointerCapture={finish}
        onClick={(event) => {
          if (event.detail === 0) event.currentTarget.closest(".game-table")
            ?.querySelector<HTMLButtonElement>(".gift-recipient-name")?.focus();
        }}>
        {children}
      </button>
      {ghost && createPortal(<span className="playing-card gift-drag-card" style={ghost} aria-hidden="true">
        <CardBackMark />
      </span>, document.body)}
    </>
  );
}
