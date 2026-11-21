import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from "react";
import { flyCard, reducedMotion } from "./cardAnimations";
import type { PlayGameSound } from "./useCardFeedback";

type Point = { x: number; y: number };
type Drag = { pointerId: number; origin: Point; target: Point; distance: number; moved: boolean };

export type CardReaction = {
  scope: string;
  center: RefObject<HTMLDivElement | null>;
  play: () => void;
  playSound: PlayGameSound;
};

const tapWindow = 280;
const dragThreshold = 9;
const translate = ({ x, y }: Point) => `${x}px ${y}px`;

export function useCardGestures(card: RefObject<HTMLButtonElement | null>, reaction: CardReaction | undefined,
  action: (() => void) | undefined, actionLabel: string | undefined) {
  const drag = useRef<Drag | null>(null);
  const returning = useRef<Animation | null>(null);
  const tapFeedback = useRef<Animation | null>(null);
  const taps = useRef({ count: 0, last: 0, timer: 0 });

  function resetTaps() {
    window.clearTimeout(taps.current.timer);
    taps.current = { count: 0, last: 0, timer: 0 };
  }

  function resetDrag(element: HTMLButtonElement, animateReturn = false) {
    const previous = element.style.translate;
    element.style.translate = "";
    element.classList.remove("is-dragging");
    drag.current = null;
    if (animateReturn && previous && !reducedMotion()) {
      returning.current = element.animate([{ translate: previous }, { translate: "0px 0px" }], { duration: 130, easing: "ease-out" });
    }
  }

  useLayoutEffect(() => {
    const element = card.current;
    return () => {
      resetTaps();
      if (element && drag.current) resetDrag(element);
      returning.current?.cancel();
      tapFeedback.current?.cancel();
    };
  }, [card, reaction?.scope, actionLabel]);

  function playReaction(element: HTMLButtonElement) {
    if (!reaction) return;
    const target = reaction.center.current?.querySelector(".discard-slot");
    if (target) flyCard(element.getBoundingClientRect(), target.getBoundingClientRect(), "reaction");
    reaction.playSound("reaction");
    reaction.play();
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    const center = reaction?.center.current?.querySelector(".discard-slot");
    if (!event.isPrimary || event.button !== 0 || !center) return;
    window.clearTimeout(taps.current.timer);
    returning.current?.cancel();
    tapFeedback.current?.cancel();
    const element = event.currentTarget;
    const from = element.getBoundingClientRect();
    const to = center.getBoundingClientRect();
    const target = { x: to.x + to.width / 2 - from.x - from.width / 2, y: to.y + to.height / 2 - from.y - from.height / 2 };
    drag.current = { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY },
      target, distance: Math.hypot(target.x, target.y), moved: false };
    element.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const offset = { x: event.clientX - current.origin.x, y: event.clientY - current.origin.y };
    if (!current.moved && Math.hypot(offset.x, offset.y) < dragThreshold) return;
    if (!current.moved) {
      resetTaps();
      reaction?.playSound("slide");
    }
    current.moved = true;
    event.currentTarget.classList.add("is-dragging");
    event.currentTarget.style.translate = translate(offset);
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId || !reaction) return;
    const element = event.currentTarget;
    const offset = { x: event.clientX - current.origin.x, y: event.clientY - current.origin.y };
    const movement = Math.hypot(offset.x, offset.y);
    if (current.moved || movement >= dragThreshold) {
      const progress = (offset.x * current.target.x + offset.y * current.target.y) / Math.max(1, current.distance);
      const releaseTowardCenter = progress >= Math.min(52, current.distance * 0.55) && progress >= movement * 0.7;
      if (releaseTowardCenter) {
        element.style.translate = translate(offset);
        playReaction(element);
      }
      resetDrag(element, !releaseTowardCenter);
      resetTaps();
      return;
    }

    resetDrag(element);
    const now = performance.now();
    const count = now - taps.current.last <= tapWindow ? taps.current.count + 1 : 1;
    resetTaps();
    if (count === 3) {
      playReaction(element);
      return;
    }
    reaction.playSound("tap");
    if (!reducedMotion()) {
      tapFeedback.current = element.animate([
        { scale: 1 }, { scale: count === 1 ? 1.045 : 1.08, boxShadow: "0 0 0 2px #f3de9a" }, { scale: 1 },
      ], { duration: 140, easing: "ease-out" });
    }
    taps.current = { count, last: now, timer: window.setTimeout(() => {
      resetTaps();
      if (count === 1) action?.();
    }, tapWindow) };
  }

  function cancelPointer(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      resetDrag(event.currentTarget, true);
      resetTaps();
    }
  }

  return { pointerDown, pointerMove, pointerUp, cancelPointer, playReaction };
}
