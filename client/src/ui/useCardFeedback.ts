import { useEffect, useRef, useState } from "react";
import type { TurnView } from "../game/turn";

type FeedbackKind = "draw" | "discard" | "power" | "reaction";
export type CardFeedback = { kind: FeedbackKind; pile: "deck" | "discard"; id: number };
const soundKey = "ficodutch-game-sound";
const tones: Record<FeedbackKind, [number, number]> = {
  draw: [360, 460],
  discard: [295, 210],
  power: [480, 690],
  reaction: [510, 410],
};

export function useCardFeedback(view: TurnView | null, roundNumber: number, clockVersion: number) {
  const [sound, setSound] = useState(() => localStorage.getItem(soundKey) === "on");
  const [feedback, setFeedback] = useState<CardFeedback | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<{ view: TurnView; roundNumber: number; clockVersion: number } | null>(null);
  const nextId = useRef(0);

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

  useEffect(() => {
    const prior = previous.current;
    previous.current = view && { view, roundNumber, clockVersion };
    if (!view || !prior || prior.roundNumber !== roundNumber || prior.clockVersion !== clockVersion) {
      setFeedback(null);
      return;
    }
    const before = prior.view;
    let kind: FeedbackKind;
    let pile: CardFeedback["pile"] = "discard";
    if (view.reaction.notice && view.reaction.notice !== before.reaction.notice &&
        (view.reaction.reference !== before.reaction.reference ||
          view.players.some((player, index) => player.handVersion !== before.players[index]?.handVersion))) kind = "reaction";
    else if (view.power && !before.power) kind = "power";
    else if (view.hasDrawn && !before.hasDrawn) {
      kind = "draw";
      pile = view.discardCount < before.discardCount ? "discard" : "deck";
    } else if (view.discardCount > before.discardCount || view.reaction.reference > before.reaction.reference) kind = "discard";
    else return;

    setFeedback({ kind, pile, id: ++nextId.current });
    const context = audio.current;
    if (!sound || !context || context.state !== "running") return;
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(tones[kind][0], start);
    oscillator.frequency.exponentialRampToValueAtTime(tones[kind][1], start + 0.09);
    gain.gain.setValueAtTime(0.035, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.13);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(start + 0.14);
  }, [clockVersion, roundNumber, sound, view]);

  return { feedback, sound, toggleSound };
}
