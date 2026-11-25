import type hubSocial from "./hubSocial.json";

export type HubStatus = "waiting" | "in-progress" | "full" | "finished";

export type HubPlayer = {
  id: string;
  accountId?: string;
  avatarStyle?: number;
  avatarPhotoId?: string;
  rating?: number;
  pseudo: string;
  isHost: boolean;
  isBot?: true;
  connected: boolean;
  connectionVersion: number;
};


export type Hub = {
  id: string;
  tracked?: true;
  name: string;
  creatorAvatar?: { id: string; style?: number; photoId?: string };
  isPrivate?: true;
  joinRequests?: { id: string; pseudo: string }[];
  hostId: string;
  hostPseudo: string;
  players: HubPlayer[];
  maxPlayers: 6;
  status: HubStatus;
  gameStarted: boolean;
  gameFinished: boolean;
  gameNumber: number;
  hostPause: { startedAt: number; until: number; transfer?: true } | null;
  manualPause?: { startedAt: number; resumeAt?: number };
  clockVersion: number;
  roundRating?: { number: number };
  initialCardCounts?: Record<string, number>;
  memorizationEndsAt?: number;
  createdAt: number;
  variants: {
    sixCards: boolean;
    infinitePose: boolean;
    plusMinusOne: boolean;
    jokerPlus: boolean;
  };
  endThreshold: number | null;
};


export type CreateHubRequest = {
  pseudo: string;
};

export type HubListing = Hub | (Pick<Hub, "id" | "name" | "creatorAvatar" | "status" |
  "gameStarted" | "gameFinished"> & { isPrivate: true; players: [] });

export type HubSession = { hubId: string; playerId: string; token: string; isHost: boolean; matchId?: string };
export type HubMembership = { hub: Hub; session: HubSession };
export type HubAdmission = { hubId: string; status: "waiting" | "closed" | "refused" | "cancelled" };
export type HubEnd = { hubId: string; reason: "removed" | "interrupted"; matchId?: string; tableSummary?: boolean };
export type HubEmoji = keyof typeof hubSocial.emojis;
export type LobbyChatContent = { kind: "text"; text: string } | { kind: "emoji"; emoji: HubEmoji };
export type LobbyChatMessage = LobbyChatContent & { id: string; hubId: string; playerId: string; pseudo: string };
export type LobbyChatStatus = "ok" | "unavailable" | "invalid" | "slow";

export type JoinHubRequest = {
  hubId: string;
  pseudo: string;
  returnToken?: string;
};

export type StartHubRequest = Pick<Hub, "variants" | "endThreshold"> & {
  hubId: string;
  cardCounts: Record<string, number>;
  backup?: { hubId: string; gameNumber: number; sequence: number; bytes: Uint8Array };
};

export type RestartHubRequest = Pick<Hub, "gameNumber" | "variants"> & { hubId: string };

export type PeerDescription = {
  type: "offer" | "answer";
  sdp: string;
};

export type PeerSignal = {
  hubId: string;
  senderId: string;
  senderVersion: number;
  recipientVersion: number;
  negotiationId: string;
  description: PeerDescription;
};

export type PeerRelayBody =
  | { type: "offer" | "answer"; publicKey: string }
  | { type: "data"; sequence: number; ciphertext: string };

export type PeerRelaySignal = Omit<PeerSignal, "description"> & { body: PeerRelayBody };
