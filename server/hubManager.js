
const { randomUUID } = require("crypto");

const hubs = new Map();

function findPlayerHub(socketId) {
  for (const hub of hubs.values()) {
    if (hub.players.some((player) => player.id === socketId)) {
      return hub;
    }
  }

  return null;
}

function getHubStatus(hub) {
  if (hub.players.length >= hub.maxPlayers) {
    return "full";
  }

  return hub.gameStarted ? "in-progress" : "waiting";
}

function getPublicHub(hub) {
  return {
    ...hub,
    status: getHubStatus(hub),
  };
}

function getAllHubs() {
  return Array.from(hubs.values()).map(getPublicHub);
}

function createHub(socketId, pseudo) {
      if (findPlayerHub(socketId)) {
    return null;
  }
  const hub = {
    id: randomUUID(),
    name: `Hub de ${pseudo}`,
    hostId: socketId,
    hostPseudo: pseudo,
    players: [
      {
        id: socketId,
        pseudo,
        isHost: true,
        connected: true,
      },
    ],
    maxPlayers: 6,
gameStarted: false,
createdAt: Date.now(),

variants: {
  sixCards: false,
  infinitePose: false,
  plusMinusOne: false,
  jokerPlus: false,
},

endThreshold: 100,
  };

  hubs.set(hub.id, hub);

  return getPublicHub(hub);
}

function joinHub(hubId, socketId, pseudo) {
  const hub = hubs.get(hubId);

  const existingHub = findPlayerHub(socketId);

  if (existingHub) {
    if (existingHub.id === hubId) {
      return getPublicHub(existingHub);
    }

    return null;
  }

    if (hub && hub.players.some((player) => player.id === socketId)) {
    return getPublicHub(hub);
  }

  if (!hub || hub.gameStarted || hub.players.length >= hub.maxPlayers) {
    return null;
  }

  hub.players.push({
    id: socketId,
    pseudo,
    isHost: false,
    connected: true,
  });

  return getPublicHub(hub);
}


function updateHubSettings(socketId, settings) {
  const hub = findPlayerHub(socketId);

  if (!hub || hub.hostId !== socketId || hub.gameStarted) {
    return null;
  }

  const threshold = settings.endThreshold;
const allowedThresholds = [50, 100, 200, 500, 1000, null];

if (!allowedThresholds.includes(threshold)) {
  return null;
}

  hub.variants = {
    sixCards: Boolean(settings.variants?.sixCards),
    infinitePose: Boolean(settings.variants?.infinitePose),
    plusMinusOne: Boolean(settings.variants?.plusMinusOne),
    jokerPlus: Boolean(settings.variants?.jokerPlus),
  };

  hub.endThreshold = threshold;

  return getPublicHub(hub);
}

function removePlayer(socketId) {
  for (const [hubId, hub] of hubs.entries()) {
    const playerIndex = hub.players.findIndex(
      (player) => player.id === socketId
    );

    if (playerIndex === -1) continue;

    const player = hub.players[playerIndex];

    if (player.isHost) {
      hubs.delete(hubId);
      return { hubId, deleted: true };
    }

    hub.players.splice(playerIndex, 1);
    return { hubId, deleted: false };
  }

  return null;
}

function startHubGame(socketId) {
  const hub = findPlayerHub(socketId);

  if (!hub || hub.hostId !== socketId) {
    return { error: "Seul le créateur peut lancer la partie." };
  }

  if (hub.gameStarted) {
    return { error: "La partie est déjà lancée." };
  }

  if (hub.players.length < 2) {
    return { error: "Il faut au moins 2 joueurs pour commencer." };
  }

  hub.gameStarted = true;

  return { hub: getPublicHub(hub) };
}

module.exports = {
  getAllHubs,
  createHub,
  joinHub,
  updateHubSettings,
  startHubGame,
  removePlayer,
};
