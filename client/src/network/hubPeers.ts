import type { HubPlayer, PeerDescription, PeerSignal } from "../../../shared/hubTypes";
import { createEncryptedPeerRelay } from "./encryptedPeerRelay";
import { socket } from "./socket";

async function describePeer(
  connection: RTCPeerConnection,
  description: RTCSessionDescriptionInit
): Promise<PeerDescription | null> {
  await connection.setLocalDescription(description);
  if (connection.iceGatheringState !== "complete") {
    await new Promise<void>((resolve) => {
      function finish() {
        window.clearTimeout(timeout);
        connection.removeEventListener("icegatheringstatechange", onGatheringChange);
        resolve();
      }
      function onGatheringChange() {
        if (connection.iceGatheringState === "complete") finish();
      }
      const timeout = window.setTimeout(finish, 5_000);
      connection.addEventListener("icegatheringstatechange", onGatheringChange);
    });
  }

  const local = connection.localDescription;
  return local && (local.type === "offer" || local.type === "answer")
    ? { type: local.type, sdp: local.sdp }
    : null;
}

type Peer = {
  connection: RTCPeerConnection;
  version: number;
  negotiationId: string;
  channel?: RTCDataChannel;
  answer?: PeerDescription;
};

export function connectHubPeers(
  hubId: string,
  hostId: string,
  playerId: string,
  localVersion: number,
  hostVersion: number | undefined,
  onMessage: (senderId: string, message: unknown) => void,
  onConnection: (peerId: string, connected: boolean, route?: "relay") => void
) {
  const isHost = playerId === hostId;
  const peers = new Map<string, Peer>();
  const stunUrl = import.meta.env.VITE_STUN_URL;
  let closed = false;
  let retry: number | undefined;
  let directTimeout: number | undefined;
  const relay = createEncryptedPeerRelay(hubId, hostId, playerId, localVersion, hostVersion,
    (id) => dropPeer(id), (id, ready) => onConnection(id, ready, "relay"), onMessage);

  function startRelayFallback() {
    window.clearTimeout(directTimeout);
    window.clearInterval(retry);
    relay.start();
  }

  function createPeer(peerId: string, version: number, negotiationId: string) {
    const peer = {
      connection: new RTCPeerConnection({ iceServers: stunUrl ? [{ urls: stunUrl }] : [] }),
      version,
      negotiationId,
    };
    peers.set(peerId, peer);
    return peer;
  }

  function isCurrent(peerId: string, peer: Peer) {
    return !closed && peers.get(peerId) === peer;
  }

  function watchChannel(peerId: string, peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel;
    const opened = () => {
      if (!isCurrent(peerId, peer)) return;
      window.clearInterval(retry);
      if (!isHost) window.clearTimeout(directTimeout);
      onConnection(peerId, true);
    };
    channel.onopen = opened;
    channel.onclose = () => {
      if (!isCurrent(peerId, peer)) return;
      onConnection(peerId, false);
      if (!isHost) startRelayFallback();
    };
    if (channel.readyState === "open") opened();
    channel.onmessage = ({ data }) => {
      if (!isCurrent(peerId, peer) || typeof data !== "string" || data.length > 8_192) return;
      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      onMessage(peerId, message);
    };
  }

  function signalPeer(peerId: string, peer: Peer, description: PeerDescription) {
    if (!isCurrent(peerId, peer) || !socket.connected) return;
    socket.emit("hub:peer-signal", {
      hubId, recipientId: peerId, senderVersion: localVersion, recipientVersion: peer.version,
      negotiationId: peer.negotiationId, description,
    });
  }

  function dropPeer(peerId: string) {
    const peer = peers.get(peerId);
    if (!peer) return;
    peers.delete(peerId);
    peer.channel?.close();
    peer.connection.close();
    if (!closed) onConnection(peerId, false);
  }

  async function onSignal({ hubId: signalHub, senderId, senderVersion, recipientVersion, negotiationId, description }: PeerSignal) {
    if (signalHub !== hubId || recipientVersion !== localVersion || closed || relay.has(senderId)) return;

    let peer = peers.get(senderId);
    try {
      if (isHost && description.type === "offer") {
        if (peer?.version === senderVersion && peer.negotiationId === negotiationId) {
          if (peer.answer) signalPeer(senderId, peer, peer.answer);
          return;
        }
        if (peer && peer.version > senderVersion) return;
        dropPeer(senderId);
        const incoming: Peer = createPeer(senderId, senderVersion, negotiationId);
        peer = incoming;
        const { connection } = incoming;
        connection.ondatachannel = ({ channel }) => {
          if (!isCurrent(senderId, incoming) || channel.label !== "round" || incoming.channel) {
            channel.close();
            return;
          }
          watchChannel(senderId, incoming, channel);
        };
        await connection.setRemoteDescription(description);
        const answer = await describePeer(connection, await connection.createAnswer());
        if (answer && isCurrent(senderId, incoming)) {
          incoming.answer = answer;
          signalPeer(senderId, incoming, answer);
        }
      } else if (!isHost && senderId === hostId && description.type === "answer" &&
          peer?.version === senderVersion && peer.negotiationId === negotiationId &&
          peer.connection.signalingState === "have-local-offer") {
        await peer.connection.setRemoteDescription(description);
      }
    } catch {
      if (peer && isCurrent(senderId, peer)) {
        dropPeer(senderId);
        if (!isHost) startRelayFallback();
      }
    }
  }

  socket.on("hub:peer-signal", onSignal);
  if (!isHost && hostVersion !== undefined) {
    directTimeout = window.setTimeout(startRelayFallback, 7_000);
    try {
      const peer = createPeer(hostId, hostVersion, crypto.randomUUID());
      const { connection } = peer;
      watchChannel(hostId, peer, connection.createDataChannel("round"));
      connection.oniceconnectionstatechange = () => {
        if (isCurrent(hostId, peer) && connection.iceConnectionState === "failed") startRelayFallback();
      };
      void connection.createOffer()
        .then((offer) => describePeer(connection, offer))
        .then((offer) => {
          if (!offer || !isCurrent(hostId, peer)) return;
          signalPeer(hostId, peer, offer);
          retry = window.setInterval(() => signalPeer(hostId, peer, offer), 1_000);
        })
        .catch(() => { if (isCurrent(hostId, peer)) startRelayFallback(); });
    } catch {
      startRelayFallback();
    }
  }

  return {
    syncGuests(players: HubPlayer[]) {
      relay.syncGuests(players);
      if (!isHost) return;
      for (const [id, peer] of peers) {
        if (!players.some((player) => player.id === id && player.connected && player.connectionVersion === peer.version)) {
          dropPeer(id);
        }
      }
    },
    send(peerId: string, message: unknown) {
      if (relay.has(peerId)) return relay.send(peerId, message);
      const channel = peers.get(peerId)?.channel;
      if (channel?.readyState !== "open") return false;
      try {
        channel.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      closed = true;
      window.clearInterval(retry);
      window.clearTimeout(directTimeout);
      relay.close();
      socket.off("hub:peer-signal", onSignal);
      for (const id of peers.keys()) dropPeer(id);
    },
  };
}
