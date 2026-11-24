import { useCallback, useEffect, useRef } from "react";
import type { Hub } from "../../../shared/hubTypes";
import { decodeRoundBackup, encodeRoundBackup, importRoundKey, newRoundKey, type HostRound } from "../game/roundBackup";
import type { useHubPeers } from "./useHubPeers";
import { socket } from "./socket";

type StoredKey = { hubId: string; raw: string; key: Promise<CryptoKey> };
type Promotion = { hubId: string; gameNumber: number; age: number; bytes: ArrayBuffer };

export function useHostTransfer(
  hub: Hub | null, playerId: string | undefined, round: HostRound | null, ready: boolean,
  peers: ReturnType<typeof useHubPeers>, restore: (round: HostRound) => void, frozenClock?: number,
) {
  const stored = useRef<StoredKey | null>(null);
  const seq = useRef(0);
  const hubId = hub?.id;
  const hostId = hub?.hostId;
  const gameNumber = hub?.gameNumber;
  const isHost = !!playerId && playerId === hostId;
  const active = !!hub?.gameStarted && !hub.gameFinished && !hub.hostPause;
  const { subscribe, send, connectedPeers } = peers;

  useEffect(() => {
    if (!hubId || isHost) return;
    return subscribe((sender, value) => {
      if (sender !== hostId || !value || typeof value !== "object") return;
      const message = value as { type?: string; key?: string };
      if (message.type !== "host-transfer-key" || !message.key || !/^[A-Za-z0-9+/]{43}=$/.test(message.key)) return;
      if (stored.current?.hubId === hubId && stored.current.raw === message.key) {
        socket.emit("hub:backup-ready", { hubId, hostId });
        return;
      }
      const candidate = { hubId, raw: message.key, key: importRoundKey(message.key) };
      void candidate.key.then(() => {
        stored.current = candidate;
        if (socket.connected) socket.emit("hub:backup-ready", { hubId, hostId });
      }, () => {});
    });
  }, [hubId, hostId, isHost, subscribe]);

  const keyFor = useCallback((id: string) => {
    if (stored.current?.hubId !== id) {
      const raw = newRoundKey();
      stored.current = { hubId: id, raw, key: importRoundKey(raw) };
    }
    return stored.current;
  }, []);

  useEffect(() => {
    if (!hubId || !isHost || !ready || !connectedPeers.length) return;
    const { raw } = keyFor(hubId);
    const distribute = () => {
      for (const id of connectedPeers) send(id, { type: "host-transfer-key", key: raw });
    };
    distribute();
    const timer = window.setInterval(distribute, 2_500);
    return () => window.clearInterval(timer);
  }, [connectedPeers, hubId, isHost, keyFor, ready, send]);

  const backup = useCallback(async (current: HostRound, clock = performance.now()) => {
    const sequence = ++seq.current;
    const bytes = await encodeRoundBackup(current, await keyFor(current.hubId).key, clock);
    if (bytes.length > 700_000) throw new Error("La sauvegarde dépasse la taille prise en charge par le relais.");
    return { hubId: current.hubId, gameNumber: current.gameNumber, sequence, bytes };
  }, [keyFor]);

  useEffect(() => {
    if (!active || !isHost || !ready || !connectedPeers.length || !round ||
        round.hubId !== hubId || round.gameNumber !== gameNumber) return;
    let obsolete = false;
    const save = () => {
      void backup(round, frozenClock).then((checkpoint) => {
        if (!obsolete && socket.connected) socket.emit("hub:backup-round", checkpoint);
      }, () => {});
    };
    save();
    const timer = window.setInterval(save, 8_000);
    return () => { obsolete = true; window.clearInterval(timer); };
  }, [active, backup, connectedPeers, frozenClock, gameNumber, hubId, isHost, ready, round]);

  useEffect(() => {
    function promote(message: Promotion) {
      const available = stored.current;
      if (!available || available.hubId !== message.hubId) return;
      void available.key.then((key) => decodeRoundBackup(message.hubId, message.gameNumber, message.bytes, key,
        () => performance.now() - message.age)).then(restore, () => {
        console.warn("La sauvegarde de la table n’a pas pu être ouverte.");
      });
    }
    socket.on("hub:promotion", promote);
    return () => { socket.off("hub:promotion", promote); };
  }, [restore]);

  return backup;
}
