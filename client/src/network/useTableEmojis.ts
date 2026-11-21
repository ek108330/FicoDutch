import { useCallback, useRef, useState } from "react";
import { emojis } from "../../../shared/hubSocial.json";
import type { HubEmoji, HubPlayer } from "../../../shared/hubTypes";
import type { GameState } from "../game/gameTypes";
import type { useHubPeers } from "./useHubPeers";

const EMOJI_DURATION_MS = 3_000;
const EMOJI_INTERVAL_MS = 800;

type VisibleEmoji = { emoji: HubEmoji; roundNumber: number; clockVersion: number; until: number };
type EmojiMessage = { type: unknown; emoji?: unknown; playerId?: unknown; roundNumber?: unknown; clockVersion?: unknown };
type Options = {
  playerId: string;
  hostId: string;
  roundNumber: number;
  clockVersion: number;
  enabled: boolean;
  now: number;
  hostRound: GameState | null;
  members: HubPlayer[];
  send: ReturnType<typeof useHubPeers>["send"];
  onShow: () => void;
};

export function useTableEmojis({
  playerId, hostId, roundNumber, clockVersion, enabled, now, hostRound, members, send, onShow,
}: Options) {
  const [recent, setRecent] = useState<Map<string, VisibleEmoji>>(() => new Map());
  const lastSentAt = useRef(new Map<string, number>());

  const show = useCallback((senderId: string, emoji: HubEmoji) => {
    const receivedAt = performance.now();
    onShow();
    setRecent((current) => {
      const next = new Map(Array.from(current).filter(([, entry]) => entry.until > receivedAt));
      next.set(senderId, { emoji, roundNumber, clockVersion, until: receivedAt + EMOJI_DURATION_MS });
      return next;
    });
  }, [clockVersion, onShow, roundNumber]);

  const broadcast = useCallback((senderId: string, emoji: HubEmoji) => {
    if (!enabled || !hostRound?.players.some(({ id, hasLeft }) => id === senderId && !hasLeft) ||
        !members.some(({ id, connected }) => id === senderId && connected)) return;
    const sentAt = performance.now();
    const last = lastSentAt.current;
    if (sentAt - (last.get(senderId) ?? -Infinity) < EMOJI_INTERVAL_MS) return;
    for (const [id, time] of last) {
      if (sentAt - time >= EMOJI_INTERVAL_MS) last.delete(id);
    }
    last.set(senderId, sentAt);
    show(senderId, emoji);
    for (const { id, hasLeft } of hostRound.players) {
      if (id !== playerId && !hasLeft && members.some((member) => member.id === id && member.connected)) {
        send(id, { type: "table-emoji", playerId: senderId, emoji, roundNumber, clockVersion });
      }
    }
  }, [clockVersion, enabled, hostRound, members, playerId, roundNumber, send, show]);

  const receive = useCallback((senderId: string, message: EmojiMessage) => {
    const { emoji } = message;
    if (!enabled || message.roundNumber !== roundNumber || message.clockVersion !== clockVersion ||
        typeof emoji !== "string" || !Object.hasOwn(emojis, emoji)) return;
    if (playerId === hostId && message.type === "table-emoji-request") {
      broadcast(senderId, emoji as HubEmoji);
    } else if (playerId !== hostId && senderId === hostId && message.type === "table-emoji" &&
        typeof message.playerId === "string" && members.some(({ id }) => id === message.playerId)) {
      show(message.playerId, emoji as HubEmoji);
    }
  }, [broadcast, clockVersion, enabled, hostId, members, playerId, roundNumber, show]);

  function choose(emoji: HubEmoji) {
    if (!enabled) return;
    if (playerId === hostId) broadcast(playerId, emoji);
    else send(hostId, { type: "table-emoji-request", emoji, roundNumber, clockVersion });
  }

  const visible = new Map<string, HubEmoji>();
  for (const [id, entry] of recent) {
    if (entry.roundNumber === roundNumber && entry.clockVersion === clockVersion && entry.until > now) {
      visible.set(id, entry.emoji);
    }
  }

  return { choose, receive, visible };
}
