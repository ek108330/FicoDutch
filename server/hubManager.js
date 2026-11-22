const { randomBytes, randomUUID } = require("crypto");
const { emojis, maxMessageLength } = require("../shared/hubSocial.json");

const hubs = new Map();
const MEMORIZATION_DURATION_MS = 15_000;
const HOST_GRACE_MS = 120_000;
const CHAT_INTERVAL_MS = 650;

function findPlayerHub(socketId) {
  for (const hub of hubs.values()) {
    const player = hub.players.find((entry) => entry.socketId === socketId);
    if (player) return { hub, player };
  }
  return null;
}

function newPlayer(socketId, pseudo, isHost = false) {
  return {
    id: randomUUID(), pseudo, isHost, connected: true, connectionVersion: 1,
    socketId, token: randomBytes(32).toString("base64url"),
  };
}

function getHubStatus(hub) {
  if (hub.gameFinished) return "finished";
  if (hub.players.length >= hub.maxPlayers) return "full";
  return hub.gameStarted ? "in-progress" : "waiting";
}

function getPublicHub(hub) {
  return {
    ...hub,
    players: hub.players.map(({ id, pseudo, isHost, isBot, connected, connectionVersion }) => ({
      id, pseudo, isHost, connected, connectionVersion, ...(isBot && { isBot }),
    })),
    status: getHubStatus(hub),
  };
}

function membership(hub, player) {
  return {
    hub: getPublicHub(hub),
    session: { hubId: hub.id, playerId: player.id, token: player.token, isHost: player.isHost },
  };
}

function getAllHubs() {
  return Array.from(hubs.values()).map(getPublicHub);
}

function relayLobbyMessage(socketId, request, now = Date.now()) {
  const current = findPlayerHub(socketId);
  if (!current || current.hub.id !== request?.hubId || current.hub.gameStarted) return { status: "unavailable" };
  const { hub, player } = current;
  let content;
  if (request.kind === "text" && typeof request.text === "string" &&
      request.text.length <= maxMessageLength && !/\p{Cc}/u.test(request.text) && request.text.trim()) {
    content = { kind: "text", text: request.text.trim() };
  } else if (request.kind === "emoji" && typeof request.emoji === "string" && Object.hasOwn(emojis, request.emoji)) {
    content = { kind: "emoji", emoji: request.emoji };
  } else {
    return { status: "invalid" };
  }

  if (player.lastLobbyMessageAt !== undefined && now - player.lastLobbyMessageAt < CHAT_INTERVAL_MS) {
    return { status: "slow" };
  }
  player.lastLobbyMessageAt = now;
  return {
    status: "ok",
    socketIds: hub.players.map(({ socketId }) => socketId).filter(Boolean),
    message: { ...content, id: randomUUID(), hubId: hub.id, playerId: player.id, pseudo: player.pseudo },
  };
}

function createHub(socketId, pseudo) {
  if (findPlayerHub(socketId)) return null;
  const host = newPlayer(socketId, pseudo, true);
  const hub = {
    id: randomUUID(),
    name: `Hub de ${pseudo}`,
    hostId: host.id,
    hostPseudo: pseudo,
    players: [host],
    maxPlayers: 6,
    gameStarted: false,
    gameFinished: false,
    gameNumber: 1,
    createdAt: Date.now(),
    hostPause: null,
    clockVersion: 0,
    variants: { sixCards: false, infinitePose: false, plusMinusOne: false, jokerPlus: false },
    endThreshold: 100,
  };
  hubs.set(hub.id, hub);
  return membership(hub, host);
}

function joinHub(hubId, socketId, pseudo) {
  const existing = findPlayerHub(socketId);
  if (existing) return existing.hub.id === hubId ? membership(existing.hub, existing.player) : null;

  const hub = hubs.get(hubId);
  if (!hub || hub.gameFinished || hub.players.length >= hub.maxPlayers) return null;
  const player = newPlayer(socketId, pseudo);
  hub.players.push(player);
  return membership(hub, player);
}

function updateHubSettings(socketId, settings) {
  const current = findPlayerHub(socketId);
  if (!current?.player.isHost || current.hub.gameStarted) return null;
  const { hub } = current;
  const threshold = settings?.endThreshold;
  if (![50, 100, 200, 500, 1000, null].includes(threshold)) return null;

  hub.variants = {
    sixCards: Boolean(settings.variants?.sixCards),
    infinitePose: Boolean(settings.variants?.infinitePose),
    plusMinusOne: Boolean(settings.variants?.plusMinusOne),
    jokerPlus: Boolean(settings.variants?.jokerPlus),
  };
  hub.endThreshold = threshold;
  return getPublicHub(hub);
}

function addHubBot(socketId, hubId) {
  const current = findPlayerHub(socketId);
  if (!current?.player.isHost || current.hub.id !== hubId || current.hub.gameStarted) return false;
  const { hub } = current;
  if (hub.players.length >= hub.maxPlayers) return false;
  let number = 1;
  while (hub.players.some(({ pseudo }) => pseudo === `Bot ${number}`)) number++;
  hub.players.push({
    id: randomUUID(), pseudo: `Bot ${number}`, isHost: false, isBot: true, connected: true, connectionVersion: 0,
  });
  return true;
}

function removePlayer(socketId) {
  const current = findPlayerHub(socketId);
  if (!current) return null;
  const { hub, player } = current;
  if (player.isHost) {
    hubs.delete(hub.id);
    return { hubId: hub.id, deleted: true };
  }
  hub.players.splice(hub.players.indexOf(player), 1);
  return { hubId: hub.id, deleted: false };
}

function removeHubGuest(socketId, hubId, playerId) {
  const current = findPlayerHub(socketId);
  if (!current?.player.isHost || current.hub.id !== hubId || current.hub.gameFinished) return null;
  const { hub } = current;
  const index = hub.players.findIndex(({ id, isHost }) => id === playerId && !isHost);
  if (index === -1) return null;
  const [guest] = hub.players.splice(index, 1);
  return { socketId: guest.socketId };
}

function interruptHub(socketId, hubId) {
  const current = findPlayerHub(socketId);
  if (!current?.player.isHost || current.hub.id !== hubId || !current.hub.gameStarted || current.hub.gameFinished) {
    return null;
  }
  const socketIds = current.hub.players.map((player) => player.socketId).filter(Boolean);
  hubs.delete(hubId);
  return socketIds;
}

function disconnectPlayer(socketId, now = Date.now()) {
  const current = findPlayerHub(socketId);
  if (!current || !current.hub.gameStarted) return removePlayer(socketId);
  const { hub, player } = current;
  player.socketId = null;
  player.connected = false;
  if (player.isHost) {
    hub.hostPause ??= { startedAt: now, until: now + HOST_GRACE_MS };
    return { hubId: hub.id, pauseUntil: hub.hostPause.until };
  }
  return { hubId: hub.id };
}

function expireHostPause(hubId, pauseUntil, now = Date.now()) {
  const hub = hubs.get(hubId);
  if (!hub?.hostPause || hub.hostPause.until !== pauseUntil || now < pauseUntil) return false;
  hubs.delete(hubId);
  return true;
}

function resumeHub(socketId, request, now = Date.now()) {
  const { hubId, token, hasHostState } = request ?? {};
  if (typeof hubId !== "string" || typeof token !== "string" || token.length !== 43) return null;
  const hub = hubs.get(hubId);
  const player = hub?.players.find((entry) => entry.token === token);
  if (!player || (hub.hostPause && now >= hub.hostPause.until) ||
      (player.isHost && hub.gameStarted && hasHostState !== true)) return null;

  const current = findPlayerHub(socketId);
  if (current && current.player !== player) return null;
  const previousSocketId = player.socketId === socketId ? null : player.socketId;
  if (player.socketId !== socketId) {
    if (previousSocketId && player.isHost && hub.gameStarted) {
      hub.hostPause ??= { startedAt: now, until: now + HOST_GRACE_MS };
    }
    player.socketId = socketId;
    player.connected = true;
    player.connectionVersion++;
  }
  return { ...membership(hub, player), previousSocketId };
}

function completeHostResume(socketId, now = Date.now()) {
  const current = findPlayerHub(socketId);
  if (!current?.player.isHost || !current.hub.hostPause || now >= current.hub.hostPause.until) return false;
  current.hub.hostPause = null;
  current.hub.clockVersion++;
  return true;
}

function startHubGame(socketId, request) {
  const current = findPlayerHub(socketId);
  if (!current?.player.isHost) return { error: "Seul le créateur peut lancer la partie." };
  const { hub } = current;
  if (hub.gameStarted) return { error: "La partie est déjà lancée." };
  if (hub.players.length < 2) return { error: "Il faut au moins 2 joueurs pour commencer." };

  const { cardCounts, variants, endThreshold } = request ?? {};
  const cardsPerPlayer = hub.variants.sixCards ? 6 : 4;
  const settingsMatch = request?.hubId === hub.id && endThreshold === hub.endThreshold &&
    Object.keys(hub.variants).every((key) => variants?.[key] === hub.variants[key]);
  const countsMatch = cardCounts && typeof cardCounts === "object" && !Array.isArray(cardCounts) &&
    Object.keys(cardCounts).length === hub.players.length &&
    hub.players.every(({ id }) => Object.hasOwn(cardCounts, id) && cardCounts[id] === cardsPerPlayer);
  if (!settingsMatch || !countsMatch) {
    return { error: "La distribution ne correspond plus au Hub. Réessaie de lancer la partie." };
  }

  hub.initialCardCounts = Object.fromEntries(hub.players.map(({ id }) => [id, cardCounts[id]]));
  hub.memorizationEndsAt = Date.now() + MEMORIZATION_DURATION_MS;
  hub.gameStarted = true;
  return { hub: getPublicHub(hub) };
}

function restartHubGame(socketId, request) {
  const current = findPlayerHub(socketId);
  if (!current?.player.isHost || current.hub.id !== request?.hubId) return false;
  const { hub } = current;
  if (!hub.gameFinished || hub.hostPause || hub.gameNumber !== request.gameNumber ||
      hub.players.filter(({ connected }) => connected).length < 2) return false;

  const keys = Object.keys(hub.variants);
  if (!keys.every((key) => typeof request.variants?.[key] === "boolean")) return false;
  hub.variants = Object.fromEntries(keys.map((key) => [key, request.variants[key]]));
  const cardsPerPlayer = hub.variants.sixCards ? 6 : 4;
  hub.initialCardCounts = Object.fromEntries(hub.players.map(({ id }) => [id, cardsPerPlayer]));
  hub.memorizationEndsAt = Date.now() + MEMORIZATION_DURATION_MS;
  hub.gameFinished = false;
  hub.gameNumber++;
  hub.clockVersion++;
  return true;
}

function finishHubGame(socketId, gameNumber) {
  const current = findPlayerHub(socketId);
  if (!current?.player.isHost || !current.hub.gameStarted || current.hub.gameFinished ||
      current.hub.gameNumber !== gameNumber) return false;
  current.hub.gameFinished = true;
  return true;
}

function findPeerRoute(socketId, request) {
  const { hubId, recipientId, senderVersion, recipientVersion, negotiationId } = request ?? {};
  if (typeof negotiationId !== "string" || !negotiationId.length || negotiationId.length > 64) return null;
  const current = findPlayerHub(socketId);
  if (!current || current.hub.id !== hubId || current.player.connectionVersion !== senderVersion) return null;
  const sender = current.player;
  const recipient = current.hub.players.find(({ id }) => id === recipientId);
  if (!recipient?.socketId || sender.isHost === recipient.isHost || recipient.connectionVersion !== recipientVersion) return null;
  return {
    socketId: recipient.socketId,
    isHost: sender.isHost,
    signal: { hubId, senderId: sender.id, senderVersion, recipientVersion, negotiationId },
  };
}

function resolvePeerRelay(socketId, request) {
  const { type, sdp } = request?.description ?? {};
  if (typeof sdp !== "string" || sdp.length === 0 || sdp.length > 65_536) return null;
  const route = findPeerRoute(socketId, request);
  if (!route || type !== (route.isHost ? "answer" : "offer")) return null;
  return { socketId: route.socketId, signal: { ...route.signal, description: { type, sdp } } };
}

function resolveEncryptedRelay(socketId, request) {
  const route = findPeerRoute(socketId, request);
  if (!route) return null;
  const { type, publicKey, sequence, ciphertext } = request?.body ?? {};
  let body;
  if (type === (route.isHost ? "answer" : "offer") && typeof publicKey === "string" &&
      /^[A-Za-z0-9+/]{87}=$/.test(publicKey)) {
    body = { type, publicKey };
  } else if (type === "data" && Number.isSafeInteger(sequence) && sequence >= 0 &&
      typeof ciphertext === "string" && ciphertext.length >= 24 && ciphertext.length <= 12_000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
    body = { type, sequence, ciphertext };
  } else return null;
  return { socketId: route.socketId, signal: { ...route.signal, body } };
}

module.exports = {
  getAllHubs, createHub, joinHub, updateHubSettings, startHubGame, removePlayer,
  disconnectPlayer, resumeHub, completeHostResume, expireHostPause, resolvePeerRelay,
  finishHubGame, restartHubGame, resolveEncryptedRelay,
  addHubBot, removeHubGuest, interruptHub, relayLobbyMessage,
};
