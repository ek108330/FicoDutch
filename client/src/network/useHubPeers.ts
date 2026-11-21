import { useCallback, useEffect, useRef, useState } from "react";
import { connectHubPeers } from "./hubPeers";
import type { Hub } from "../../../shared/hubTypes";

type MessageListener = (senderId: string, message: unknown) => void;
const noPeers: string[] = [];

export function useHubPeers(hub: Hub | null, playerId: string | undefined, ready: boolean) {
  const transport = useRef<ReturnType<typeof connectHubPeers> | null>(null);
  const listener = useRef<MessageListener | null>(null);
  const [connected, setConnected] = useState<{ generation: string; ids: string[]; relays: string[] } | null>(null);
  const hubId = hub?.id;
  const hostId = hub?.hostId;
  const players = hub?.players;
  const local = players?.find(({ id }) => id === playerId && ready);
  const ownVersion = local?.connected ? local.connectionVersion : undefined;
  const host = players?.find(({ id }) => id === hostId && id !== playerId);
  const hostVersion = host?.connected ? host.connectionVersion : undefined;
  const generation = `${hubId}/${playerId}/${ownVersion}/${hostVersion}`;
  const connectedPeers = connected?.generation === generation ? connected.ids : noPeers;
  const relayedPeers = connected?.generation === generation ? connected.relays : noPeers;

  useEffect(() => {
    if (!hubId || !hostId || !playerId || ownVersion === undefined ||
        (playerId !== hostId && hostVersion === undefined)) return;
    const peers = connectHubPeers(
      hubId,
      hostId,
      playerId,
      ownVersion,
      hostVersion,
      (senderId, message) => listener.current?.(senderId, message),
      (peerId, isConnected, route) => setConnected((current) => {
        const ids = current?.generation === generation ? current.ids : noPeers;
        const relays = current?.generation === generation ? current.relays : noPeers;
        if (ids.includes(peerId) === isConnected) return current;
        return {
          generation,
          ids: isConnected ? [...ids, peerId] : ids.filter((id) => id !== peerId),
          relays: isConnected && route === "relay" ? [...relays, peerId] : relays.filter((id) => id !== peerId),
        };
      })
    );
    transport.current = peers;
    return () => {
      peers.close();
      transport.current = null;
      setConnected(null);
    };
  }, [generation, hubId, hostId, hostVersion, ownVersion, playerId]);

  useEffect(() => {
    if (players) transport.current?.syncGuests(players.filter(({ isBot }) => !isBot));
  }, [generation, players]);

  const send = useCallback((peerId: string, message: unknown) => {
    return transport.current?.send(peerId, message) ?? false;
  }, []);
  const subscribe = useCallback((onMessage: MessageListener) => {
    listener.current = onMessage;
    return () => { listener.current = null; };
  }, []);

  return {
    hostConnected: !!hostId && connectedPeers.includes(hostId),
    connectedPeers,
    relayedPeers,
    send,
    subscribe,
  };
}
