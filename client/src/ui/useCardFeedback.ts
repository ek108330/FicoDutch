import { useCallback, useEffect, useRef, useState } from "react";
import type { TurnView } from "../game/turn";

type FeedbackKind = "draw" | "discard" | "power" | "reaction";
export type GameSound = FeedbackKind | "tap" | "slide" | "flip" | "select" | "swap" | "gift" | "penalty" | "deal" | "emoji";
export type PlayGameSound = (sound: GameSound) => void;
export type CardFeedback = { kind: FeedbackKind; pile: "deck" | "discard"; id: number };
const soundKey = "ficodutch-game-sound";
const tones: Record<GameSound, readonly [start: number, end: number, seconds: number, peak: number]> = {
  draw: [360, 490, 0.17, 0.16],
  discard: [295, 180, 0.16, 0.17],
  power: [480, 720, 0.21, 0.16],
  reaction: [540, 360, 0.19, 0.18],
  tap: [670, 540, 0.07, 0.12],
  slide: [280, 510, 0.14, 0.15],
  flip: [610, 420, 0.16, 0.16],
  select: [560, 680, 0.11, 0.12],
  swap: [335, 670, 0.44, 0.17],
  gift: [430, 580, 0.25, 0.17],
  penalty: [260, 115, 0.32, 0.21],
  deal: [220, 400, 0.25, 0.17],
  emoji: [720, 900, 0.12, 0.12],
};

export function useGameAudio() {
  const [sound, setSound] = useState(() => localStorage.getItem(soundKey) === "on");
  const audio = useRef<AudioContext | null>(null);

  function unlockSound() {
    if (!window.AudioContext) return;
    audio.current ??= new AudioContext();
    if (audio.current.state === "suspended") void audio.current.resume().catch(() => {});
  }

  function toggleSound() {
    if (!sound) unlockSound();
    localStorage.setItem(soundKey, sound ? "off" : "on");
    setSound(!sound);
  }

  useEffect(() => {
    if (!sound) return;
    window.addEventListener("pointerdown", unlockSound, { once: true });
    window.addEventListener("keydown", unlockSound, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockSound);
      window.removeEventListener("keydown", unlockSound);
    };
  }, [sound]);

  useEffect(() => () => {
    if (audio.current) void audio.current.close().catch(() => {});
    audio.current = null;
  }, []);

  const playSound = useCallback<PlayGameSound>((kind) => {
    const context = audio.current;
    const tone = tones[kind];
    if (!sound || !context || context.state !== "running" || !Array.isArray(tone)) return;
    const start = context.currentTime;
    const [from, to, seconds, peak] = tone;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + seconds * 0.72);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(start + seconds + 0.01);
  }, [sound]);

  return { sound, toggleSound, playSound };
}

export function useCardFeedback(view: TurnView | null, roundNumber: number, clockVersion: number,
  playSound: PlayGameSound) {
  const [feedback, setFeedback] = useState<CardFeedback | null>(null);
  const previous = useRef<{ view: TurnView; roundNumber: number; clockVersion: number } | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    const prior = previous.current;
    previous.current = view && { view, roundNumber, clockVersion };
    if (!view || !prior || prior.roundNumber !== roundNumber || prior.clockVersion !== clockVersion) {
      setFeedback(null);
      return;
    }
    const before = prior.view;
    const faces = view.power?.selection?.revealed.length ?? 0;
    const previousFaces = before.power?.selection?.revealed.length ?? 0;
    const newMove = view.cardMotion && view.cardMotion.id !== before.cardMotion?.id;
    if (faces !== previousFaces && !newMove) playSound("flip");
    else if ((view.power?.exchangeTargets?.length ?? 0) > (before.power?.exchangeTargets?.length ?? 0)) playSound("select");

    let kind: FeedbackKind;
    let pile: CardFeedback["pile"] = "discard";
    if (view.reaction.notice && view.reaction.notice !== before.reaction.notice &&
        (view.reaction.reference !== before.reaction.reference ||
          view.players.some((player, index) => player.handVersion !== before.players[index]?.handVersion))) kind = "reaction";
    else if (view.power && !before.power) kind = "power";
    else if (view.hasDrawn && !before.hasDrawn) {
      kind = "draw";
      pile = "deck";
    } else if (view.discardCount > before.discardCount || view.reaction.reference > before.reaction.reference) kind = "discard";
    else return;

    setFeedback({ kind, pile, id: ++nextId.current });
    if (kind !== "reaction") playSound(kind);
    else if (view.reaction.notice?.outcome === "empty-pile") playSound("penalty");
  }, [clockVersion, playSound, roundNumber, view]);

  return feedback;
}
