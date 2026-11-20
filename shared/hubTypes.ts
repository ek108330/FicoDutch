
export type HubStatus = "waiting" | "in-progress" | "full";

export type HubPlayer = {
  id: string;
  pseudo: string;
  isHost: boolean;
  connected: boolean;
};


export type Hub = {
  id: string;
  name: string;
  hostId: string;
  hostPseudo: string;
  players: HubPlayer[];
  maxPlayers: 6;
  status: HubStatus;
  gameStarted: boolean;
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

export type JoinHubRequest = {
  hubId: string;
  pseudo: string;
};
