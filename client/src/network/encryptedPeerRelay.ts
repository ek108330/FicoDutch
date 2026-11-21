import type { HubPlayer, PeerRelayBody, PeerRelaySignal } from "../../../shared/hubTypes";
import { socket } from "./socket";

type RelayPeer = {
  version: number;
  negotiationId: string;
  pair?: CryptoKeyPair;
  publicKey?: string;
  key?: CryptoKey;
  ready: boolean;
  outgoingSequence: number;
  incomingSequence: number;
  outgoing: Promise<void>;
  incoming: Promise<void>;
};

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function ivFor(sequence: number, fromHost: boolean) {
  const iv = new ArrayBuffer(12);
  const view = new DataView(iv);
  // Each direction has its own IV namespace under the shared key.
  view.setUint8(0, Number(fromHost));
  view.setBigUint64(4, BigInt(sequence));
  return iv;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const curve = { name: "ECDH", namedCurve: "P-256" };

export function createEncryptedPeerRelay(
  hubId: string,
  hostId: string,
  playerId: string,
  localVersion: number,
  hostVersion: number | undefined,
  onStart: (id: string) => void,
  onReady: (id: string, ready: boolean) => void,
  onMessage: (id: string, message: unknown) => void,
) {
  const isHost = playerId === hostId;
  const peers = new Map<string, RelayPeer>();
  let retry: number | undefined;
  let closed = false;
  let members: HubPlayer[] = [];

  function current(id: string, peer: RelayPeer) {
    return !closed && peers.get(id) === peer;
  }

  function newPeer(id: string, version: number, negotiationId: string): RelayPeer {
    const peer = {
      version, negotiationId, ready: false, outgoingSequence: 0, incomingSequence: 0,
      outgoing: Promise.resolve(), incoming: Promise.resolve(),
    };
    peers.set(id, peer);
    onStart(id);
    return peer;
  }

  function emit(id: string, peer: RelayPeer, body: PeerRelayBody) {
    if (!current(id, peer) || !socket.connected) return;
    socket.emit("hub:peer-relay", {
      hubId, recipientId: id, senderVersion: localVersion, recipientVersion: peer.version,
      negotiationId: peer.negotiationId, body,
    });
  }

  async function createKeyPair(peer: RelayPeer) {
    peer.pair = await crypto.subtle.generateKey(curve, false, ["deriveKey"]);
    peer.publicKey = toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", peer.pair.publicKey)));
  }

  async function deriveKey(peer: RelayPeer, remoteKey: string) {
    if (!peer.pair) return;
    const publicKey = await crypto.subtle.importKey("raw", fromBase64(remoteKey), curve, false, []);
    peer.key = await crypto.subtle.deriveKey({ name: "ECDH", public: publicKey }, peer.pair.privateKey,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  function enqueue(id: string, peer: RelayPeer, value: string) {
    const bytes = encoder.encode(value);
    if (bytes.length > 8_192) return false;
    peer.outgoing = peer.outgoing.then(async () => {
      if (!current(id, peer) || !peer.key) return;
      const sequence = peer.outgoingSequence++;
      const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: ivFor(sequence, isHost),
        additionalData: encoder.encode(peer.negotiationId) }, peer.key, bytes);
      emit(id, peer, { type: "data", sequence, ciphertext: toBase64(new Uint8Array(sealed)) });
    }).catch(() => { if (current(id, peer)) onReady(id, false); });
    return true;
  }

  function forget(id: string) {
    if (peers.delete(id) && !closed) onReady(id, false);
  }

  function receive({ hubId: signalHub, senderId, senderVersion, recipientVersion, negotiationId, body }: PeerRelaySignal) {
    if (closed || signalHub !== hubId || recipientVersion !== localVersion) return;
    let peer = peers.get(senderId);
    if (isHost && body.type === "offer" && members.some(({ id, connected, connectionVersion }) =>
      id === senderId && connected && connectionVersion === senderVersion)) {
      if (peer?.negotiationId === negotiationId && peer.version === senderVersion) {
        if (peer.key && peer.publicKey) emit(senderId, peer, { type: "answer", publicKey: peer.publicKey });
        return;
      }
      const incoming = newPeer(senderId, senderVersion, negotiationId);
      incoming.incoming = (async () => {
        await createKeyPair(incoming);
        await deriveKey(incoming, body.publicKey);
        if (incoming.publicKey) emit(senderId, incoming, { type: "answer", publicKey: incoming.publicKey });
      })().catch(() => { if (current(senderId, incoming)) forget(senderId); });
      return;
    }
    if (!peer || peer.version !== senderVersion || peer.negotiationId !== negotiationId) return;
    const link = peer;
    if (!isHost && senderId === hostId && body.type === "answer") {
      link.incoming = link.incoming.then(async () => {
        if (!current(senderId, link) || link.key) return;
        await deriveKey(link, body.publicKey);
        enqueue(senderId, link, "null");
      }).catch(() => { if (current(senderId, link)) forget(senderId); });
    } else if (body.type === "data") {
      link.incoming = link.incoming.then(async () => {
        if (!current(senderId, link) || !link.key || body.sequence !== link.incomingSequence) return;
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivFor(body.sequence, !isHost),
          additionalData: encoder.encode(link.negotiationId) }, link.key, fromBase64(body.ciphertext));
        if (!current(senderId, link)) return;
        const message: unknown = JSON.parse(decoder.decode(plain));
        link.incomingSequence++;
        if (!link.ready && message === null) {
          if (isHost) enqueue(senderId, link, "null");
          else window.clearInterval(retry);
          link.ready = true;
          onReady(senderId, true);
        } else if (link.ready && message !== null) onMessage(senderId, message);
      }).catch(() => {});
    }
  }

  socket.on("hub:peer-relay", receive);

  return {
    start() {
      if (isHost || closed || hostVersion === undefined || peers.has(hostId) || !crypto.subtle) return;
      const peer = newPeer(hostId, hostVersion, crypto.randomUUID());
      void createKeyPair(peer).then(() => {
        if (!current(hostId, peer) || !peer.publicKey) return;
        const offer = { type: "offer", publicKey: peer.publicKey } as const;
        emit(hostId, peer, offer);
        retry = window.setInterval(() => emit(hostId, peer, offer), 1_000);
      }).catch(() => { if (current(hostId, peer)) forget(hostId); });
    },
    has(id: string) {
      return peers.has(id);
    },
    syncGuests(players: HubPlayer[]) {
      members = players;
      if (!isHost) return;
      for (const [id, peer] of peers) {
        if (!players.some((player) => player.id === id && player.connected && player.connectionVersion === peer.version)) {
          forget(id);
        }
      }
    },
    send(id: string, message: unknown) {
      const peer = peers.get(id);
      return !!peer?.ready && enqueue(id, peer, JSON.stringify(message));
    },
    close() {
      closed = true;
      peers.clear();
      window.clearInterval(retry);
      socket.off("hub:peer-relay", receive);
    },
  };
}
