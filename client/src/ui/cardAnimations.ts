import { GAME_CONFIG } from "../config/gameConfig";
import type { CardTarget, PublicCardMove } from "../game/gameTypes";
import { SWAP_MOTION_MS } from "../game/turn";

type Flight = "reaction" | "reaction-discard" | "bot-discard" | "swap" | "gift" | "penalty" | "discard";
type DiscardFlight = Extract<Flight, "reaction" | "reaction-discard" | "bot-discard" | "discard">;
const flightDuration: Record<Flight, number> = {
  reaction: 360, "reaction-discard": 640, "bot-discard": 640, swap: SWAP_MOTION_MS, gift: 460, penalty: 540, discard: 360,
};
const arrivalOffset = 0.83;
const flightEasing = "ease-in-out";
const dealFlightTime = 310;

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const discardCovers = new WeakMap<Element, HTMLElement>();

function placeAt(element: HTMLElement, { x, y, width, height }: DOMRect) {
  Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  document.body.append(element);
}

export function dealCardSpacing(cardCount: number) {
  return Math.min(140, (GAME_CONFIG.round.dealingMs - dealFlightTime - 120) / Math.max(1, cardCount - 1));
}

export function animateDeal(table: HTMLElement, deadline: number) {
  const deck = table.querySelector(".deal-deck")?.getBoundingClientRect();
  if (!deck || reducedMotion()) return;
  const deckX = deck.x + deck.width / 2;
  const deckY = deck.y + deck.height / 2;
  const cards = Array.from(table.querySelectorAll<HTMLElement>("[data-deal-order]"));
  const dealingTime = GAME_CONFIG.round.dealingMs;
  const spacing = dealCardSpacing(cards.length);
  const elapsed = Math.max(0, performance.now() - (deadline - dealingTime));
  const flights = cards.flatMap((card) => {
    const delay = Number(card.dataset.dealOrder) * spacing;
    if (elapsed >= delay + dealFlightTime) return [];
    const destination = card.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = card;
    const transform = card.parentElement ? getComputedStyle(card.parentElement).transform : "none";
    const rotation = new DOMMatrix(transform === "none" ? undefined : transform);
    const angle = Math.atan2(rotation.b, rotation.a) * 180 / Math.PI;
    const x = destination.x + destination.width / 2 - deckX;
    const y = destination.y + destination.height / 2 - deckY;
    const scale = Math.min(deck.width / width, deck.height / height);
    const flying = document.createElement("div");
    flying.className = "playing-card face-down flying-card";
    flying.dataset.cardAnimation = "deal";
    flying.setAttribute("aria-hidden", "true");
    if (card.firstElementChild) flying.append(card.firstElementChild.cloneNode(true));
    placeAt(flying, new DOMRect(deckX - width / 2, deckY - height / 2, width, height));
    const flight = flying.animate([
      { transform: `rotate(-9deg) scale(${scale})`, opacity: 0 },
      { transform: `translate(${x * 0.5}px, ${y * 0.5}px) rotate(${angle * 0.45 - 8}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x}px, ${y}px) rotate(${angle}deg)`, opacity: 1 },
    ], { delay, duration: dealFlightTime, easing: "ease-out", fill: "both" });
    const reveal = card.animate([{ opacity: 0 }, { opacity: 1 }],
      { delay: delay + dealFlightTime - 1, duration: 1, easing: "steps(1, end)", fill: "backwards" });
    flight.currentTime = reveal.currentTime = elapsed;
    void flight.finished.then(() => flying.remove(), () => flying.remove());
    return [{ flying, flight, reveal }];
  });
  return () => {
    for (const { flying, flight, reveal } of flights) {
      flying.remove();
      flight.cancel();
      reveal.cancel();
    }
  };
}

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
  placeAt(card, from);
  const arrival = `translate(${x}px, ${y}px) scale(${scale})`;
  const animation = card.animate([
    { transform: "translate(0, 0) scale(1)", opacity: 1 },
    { transform: `translate(${x / 2 - y / distance * arc}px, ${y / 2 + x / distance * arc}px) rotate(${rotation}deg)`, opacity: 1, offset: 0.48 },
    { transform: arrival, opacity: 1, offset: arrivalOffset },
    { transform: arrival, opacity: 0 },
  ], { duration: flightDuration[kind], easing: flightEasing, fill: "forwards" });
  void animation.finished.then(() => card.remove(), () => card.remove());
}

export function flyToDiscard(from: DOMRect, target: Element, kind: DiscardFlight, face?: Element | null,
  previous = target.querySelector(":scope > .card-face")) {
  if (reducedMotion()) return;
  const box = target.getBoundingClientRect();
  const table = target.closest(".game-table");
  if (table && target.matches(".discard-slot")) {
    discardCovers.get(table)?.remove();
    const cover = document.createElement("span");
    cover.className = `playing-card discard-cover${previous ? " face-up" : ""}`;
    cover.setAttribute("aria-hidden", "true");
    if (previous) cover.append(previous.cloneNode(true));
    else cover.textContent = "Vide";
    discardCovers.set(table, cover);
    placeAt(cover, box);
    const reveal = cover.animate([{ opacity: 1, easing: "steps(1, end)" },
      { opacity: 0, offset: arrivalOffset }, { opacity: 0 }], {
      duration: flightDuration[kind], easing: flightEasing, fill: "forwards",
    });
    const remove = () => {
      cover.remove();
      if (discardCovers.get(table) === cover) discardCovers.delete(table);
    };
    void reveal.finished.then(remove, remove);
  }
  flyCard(from, box, kind, face);
}

export function animatePublicMove(table: HTMLElement, move: PublicCardMove) {
  if (move?.kind === "reaction" || move?.kind === "bot-discard") {
    const source = table.querySelector(".discard-origin");
    const target = table.querySelector(".discard-slot, .discard-placeholder");
    if (source && target) {
      const kind = move.kind === "reaction" ? "reaction-discard" : "bot-discard";
      flyToDiscard(source.getBoundingClientRect(), target, kind, source.querySelector(".card-face"),
        target.querySelector(".previous-discard .card-face"));
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
