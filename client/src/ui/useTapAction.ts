import { useRef, type MouseEvent, type PointerEvent } from "react";

export function useTapAction(action?: () => void) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);

  return {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (event.isPrimary && event.button === 0) {
        start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }
    },
    onPointerUp(event: PointerEvent<HTMLButtonElement>) {
      const point = start.current;
      start.current = null;
      if (point?.id === event.pointerId && Math.hypot(event.clientX - point.x, event.clientY - point.y) <= 12) action?.();
    },
    onPointerCancel() { start.current = null; },
    onClick(event: MouseEvent<HTMLButtonElement>) {
      if (event.detail === 0) action?.();
    },
  };
}
