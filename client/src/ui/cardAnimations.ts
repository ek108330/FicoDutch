import type { CardTarget, PublicCardMove } from "../game/gameTypes";

type Flight = "reaction" | "reaction-discard" | "swap" | "gift" | "penalty" | "discard";
const flightDuration: Record<Flight, number> = { reaction: 360, "reaction-discard": 640, swap: 1_060, gift: 460, penalty: 540, discard: 360 };

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function flyCard(from: DOMRect, to: DOMRect, kind: Flight, face?: Element | null) {
  if (reducedMotion()) return;
  const x = to.x + (to.width - from.width) / 2 - from.x;
  const y = to.y + (to.height - from.height) / 2 - from.y;
  const distance = Math.max(1, Math.hypot(x, y));
  const arc = kind === "swap" ? 27 : 11;
  const rotation = kind === "swap" ? 12 : 7;
  const scale = to.width / from.width;
  const card = document.createElement("div");
  card.className = `playing-card ${face ? "face-up" : "face-down"} flying-card`;
  card.dataset.cardAnimation = kind;
  card.setAttribute("aria-hidden", "true");
  if (face) card.append(face.cloneNode(true));
  else {
    const back = document.createElement("span");
    back.className = "card-back-pattern";
    const mark = document.createElement("span");
    mark.textContent = "F";
    back.append(mark);
    card.append(back);
  }
  Object.assign(card.style, { left: `${from.x}px`, top: `${from.y}px`, width: `${from.width}px`, height: `${from.height}px` });
  document.body.append(card);
  const arrival = `translate(${x}px, ${y}px) scale(${scale})`;
  const animation = card.animate([
    { transform: "translate(0, 0) scale(1)", opacity: 1 },
    { transform: `translate(${x / 2 - y / distance * arc}px, ${y / 2 + x / distance * arc}px) rotate(${rotation}deg)`, opacity: 1, offset: 0.48 },
    { transform: arrival, opacity: 1, offset: 0.83 },
    { transform: arrival, opacity: 0 },
  ], { duration: flightDuration[kind], easing: "ease-in-out", fill: "forwards" });
  void animation.finished.then(() => card.remove(), () => card.remove());
}

export function animatePublicMove(table: HTMLElement, move: PublicCardMove) {
  if (move?.kind === "reaction") {
    const source = table.querySelector(".reaction-origin");
    const target = table.querySelector(".discard-slot, .discard-placeholder");
    if (source && target) {
      const kind = "reaction-discard";
      flyCard(source.getBoundingClientRect(), target.getBoundingClientRect(), kind, source.querySelector(".card-face"));
      if (!reducedMotion()) {
        target.querySelector(".card-face")?.animate(
          [{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], { duration: flightDuration[kind] },
        );
      }
    }
    return;
  }
  if (!move || (move.kind !== "swap" && move.kind !== "gift" && move.kind !== "penalty")) return;
  function getCard(target: CardTarget | undefined) {
    if (!target || typeof target.playerId !== "string" || !Number.isSafeInteger(target.position)) return null;
    return table.querySelector<HTMLElement>(`[data-hand-player="${CSS.escape(target.playerId)}"] [data-card-position="${target.position}"]`);
  }
  const from = move.kind === "swap" ? getCard(move.targets?.[0]) : table.querySelector<HTMLElement>(".deck-slot, .deck-placeholder");
  const to = getCard(move.kind === "swap" ? move.targets?.[1] : move.target);
  if (!from || !to) return;

  const fromBox = from.getBoundingClientRect();
  const toBox = to.getBoundingClientRect();
  flyCard(fromBox, toBox, move.kind);
  if (move.kind === "swap") flyCard(toBox, fromBox, "swap");

  const cards = move.kind === "swap" ? [from, to] : [to];
  for (const card of cards) {
    const highlight = "0 0 0 2px #f3de9a";
    const opacity = reducedMotion() ? 1 : 0.45;
    card.animate([{ boxShadow: highlight, opacity }, { boxShadow: highlight, opacity, offset: 0.75 },
      { boxShadow: "0 0 0 0 transparent", opacity: 1 }], { duration: flightDuration[move.kind] });
  }
}
