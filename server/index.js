const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Server } = require("socket.io");
const { openDatabase } = require("./database");
const { mountAccounts } = require("./accounts");
const { createMatchStore, mountMatchRoutes, matchId } = require("./matchStore");
const {
  getAllHubs, createHub, joinHub, updateHubSettings, startHubGame, resolvePeerRelay, removePlayer,
  disconnectPlayer, resumeHub, completeHostResume, expireHostPause, finishHubGame, restartHubGame,
  changeManualPause, finishManualResume,
  addHubBot, removeHubGuest, interruptHub, relayLobbyMessage, resolveEncryptedRelay, findPlayerHub, getHub, getActiveMatchIds,
  guestNameInUse, withPlayerName, applyRoundRating, nextHumanHost, promoteHost, privateHubMembers, returningPlayer, publishRoundVariants,
} = require("./hubManager");

const app = express();
const httpServer = http.createServer(app);
const buildRevision = process.env.RENDER_GIT_COMMIT || process.env.FICODUTCH_BUILD_REVISION;
const allowedOrigins = new Set((process.env.CLIENT_ORIGINS || process.env.RENDER_EXTERNAL_URL ||
  "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean));
const acceptsOrigin = (origin) => !origin || allowedOrigins.has(origin);
const originPolicy = (origin, callback) => callback(null, acceptsOrigin(origin));
if (process.env.RENDER_EXTERNAL_URL) app.set("trust proxy", 1);
app.use(cors({ origin: originPolicy, credentials: true }));
app.use(express.json());

const io = new Server(httpServer, {
  cors: { origin: originPolicy, methods: ["GET", "POST"], credentials: true },
  allowRequest: (request, callback) => callback(null, acceptsOrigin(request.headers.origin)),
});

app.get("/healthz", (_request, response) => response.json({ status: "online" }));
let matchStore;
let demoBots = [];
const closing = new Set();
const recentCheckpoints = new WeakMap();
const roundBackups = new WeakMap();
const backupHolders = new WeakMap();
// Requests are tied to the connected socket and never included in the public directory.
const privateRequests = new Map();

if (process.env.SERVE_CLIENT === "1") {
  const clientFiles = path.resolve(__dirname, "../client/dist");
  app.use(express.static(clientFiles, {
    setHeaders(response, file) {
      if (path.extname(file) === ".html") response.setHeader("Cache-Control", "no-store");
    },
  }));
  app.get(["/parties/:id", "/bilans/:id", "/joueurs/:id", "/joueurs", "/mes-parties", "/mes-stats", "/compte", "/bots"], (_request, response) =>
    response.set("Cache-Control", "no-store").sendFile(path.join(clientFiles, "index.html")));
}

app.get("/", (req, res) => {
  res.json({
    name: "FicoDutch Server",
    status: "online",
    message: "Le serveur central fonctionne.",
  });
});

function broadcastHubs() {
  const queues = new Map();
  for (const [socketId, entry] of privateRequests) {
    const hub = getHub(entry.hubId);
    if (canRequestAdmission(hub)) {
      const queue = queues.get(hub.id) ?? [];
      queue.push({ id: entry.id, pseudo: entry.identity.pseudo });
      queues.set(hub.id, queue);
    } else {
      privateRequests.delete(socketId);
      io.to(socketId).emit("hub:admission", { hubId: entry.hubId, status: "closed" });
    }
  }
  const listings = getAllHubs();
  const now = Date.now();
  const recipients = [];
  for (const { view, connections } of privateHubMembers()) {
    const list = listings.map((item) => item.id === view.id ? view : item);
    for (const { socketId, isHost } of connections) {
      const joined = isHost && queues.has(view.id)
        ? list.map((item) => item.id === view.id ? { ...view, joinRequests: queues.get(view.id) } : item)
        : list;
      recipients.push(socketId);
      io.to(socketId).emit("hubs:update", joined, now);
    }
  }
  io.except(recipients).emit("hubs:update", listings, now);
}

function canRequestAdmission(hub) {
  return hub?.isPrivate && !hub.gameStarted && hub.players.length < hub.maxPlayers;
}

function saveRoundBackup(current, request, now = Date.now()) {
  const { hub, player } = current;
  if (!player.isHost || !hub.gameStarted || hub.gameFinished || hub.id !== request?.hubId ||
      hub.gameNumber !== request.gameNumber || !Number.isSafeInteger(request.sequence) || request.sequence < 1 ||
      !Buffer.isBuffer(request.bytes) || request.bytes.length <= 28 || request.bytes.length > 700_000) return;
  const previous = roundBackups.get(hub);
  if (previous?.hostId === player.id && previous.gameNumber === hub.gameNumber && previous.sequence >= request.sequence) return;
  roundBackups.set(hub, { hostId: player.id, gameNumber: hub.gameNumber, sequence: request.sequence, bytes: request.bytes, at: now });
}

function sendPromotion(hub, socketId, snapshot, departedAt) {
  if (snapshot?.gameNumber === hub.gameNumber) {
    const stoppedAt = Math.min(departedAt, hub.manualPause?.startedAt ?? departedAt);
    io.to(socketId).emit("hub:promotion", { hubId: hub.id, gameNumber: hub.gameNumber,
      age: Math.max(0, stoppedAt - snapshot.at), bytes: snapshot.bytes });
  }
}

async function departHost(socket, current, request, explicit) {
  const { hub, player } = current;
  const id = matchId(hub);
  if (explicit) saveRoundBackup(current, request?.backup);
  const successor = nextHumanHost(hub);
  const snapshot = roundBackups.get(hub);
  if (successor && snapshot?.gameNumber === hub.gameNumber &&
      backupHolders.get(hub)?.get(successor.id) === successor.connectionVersion) {
    const departedAt = hub.hostPause?.startedAt ?? Date.now();
    if (!promoteHost(current, successor)) return false;
    const pauseUntil = hub.hostPause.until;
    backupHolders.get(hub).delete(player.id);
    if (matchStore) await matchStore.recordDeparture(id, player.id, "left").catch((error) => socketError(socket, error));
    broadcastHubs();
    if (hub.hostId === successor.id && successor.socketId) {
      sendPromotion(hub, successor.socketId, snapshot, departedAt);
    }
    scheduleHostExpiry(hub.id, pauseUntil);
    return true;
  }
  if (successor) {
    if (explicit) return false;
    const { pauseUntil } = disconnectPlayer(socket.id);
    broadcastHubs();
    if (pauseUntil !== undefined) scheduleHostExpiry(hub.id, pauseUntil);
    return true;
  }
  if (closing.has(hub.id)) return false;
  closing.add(hub.id);
  try {
    if (matchStore) {
      if (explicit && request?.rounds?.length) await persistRatings(hub, request.rounds);
      const saved = explicit && request?.report &&
        await matchStore.finish(id, "interrupted", request.report, Date.now(), request.table);
      if (!saved) await matchStore.finish(id, "interrupted");
    }
    const sockets = interruptHub(socket.id, hub.id);
    if (!sockets) return false;
    io.to(sockets).emit("hub:ended", { hubId: hub.id, reason: "interrupted",
      ...(matchStore && { matchId: id, tableSummary: true }) });
    broadcastHubs();
    return true;
  } finally {
    closing.delete(hub.id);
  }
}

function scheduleHostExpiry(hubId, pauseUntil) {
  setTimeout(() => {
    const hub = getHub(hubId);
    if (!hub || hub.hostPause?.until !== pauseUntil) return;
    if (!matchStore) {
      if (expireHostPause(hubId, pauseUntil)) broadcastHubs();
      return;
    }
    const close = async () => {
      if (getHub(hubId) !== hub || hub.hostPause?.until !== pauseUntil) return;
      await matchStore.finish(matchId(hub), "interrupted");
      const sockets = hub.players.map(({ socketId }) => socketId).filter(Boolean);
      if (expireHostPause(hubId, pauseUntil)) {
        io.to(sockets).emit("hub:ended", { hubId, reason: "interrupted", matchId: matchId(hub), tableSummary: true });
        broadcastHubs();
      }
    };
    const retry = () => close().catch((error) => {
      console.error("Bilan d’interruption en attente :", error.code);
      setTimeout(retry, 5_000).unref();
    });
    void retry();
  }, Math.max(0, pauseUntil - Date.now()) + 1).unref();
}

function readPseudo(data) {
  const pseudo = typeof data?.pseudo === "string" ? data.pseudo.trim() : "";
  return /^[A-Za-z0-9]{2,20}$/.test(pseudo) ? pseudo : null;
}

function checkClientBuild(socket) {
  if (!buildRevision || socket.handshake.auth?.buildRevision === buildRevision) return true;
  socket.emit("hub:error", `Une version plus récente de FicoDutch est en ligne (${buildRevision.slice(0, 7)}). Recharge la page sur les deux appareils.`);
  return false;
}

function accountIdentity(socket) {
  const session = socket.data.session;
  return session && session.expiresAt > Date.now()
    ? { id: session.account.id, pseudo: session.account.name, avatarStyle: session.account.avatarStyle,
      avatarPhotoId: session.account.avatarPhotoId } : null;
}

async function admit(socket, data, action) {
  const identity = accountIdentity(socket);
  if (identity) return action(identity);
  const pseudo = readPseudo(data);
  if (!pseudo) return socket.emit("hub:error", "Pseudo invalide.");
  await withPlayerName(pseudo, async () => {
    if (guestNameInUse(pseudo) || await matchStore?.nameReserved(pseudo)) {
      socket.emit("hub:error", "Ce pseudo est déjà utilisé. Choisis-en un autre ou connecte-toi.");
    } else if (socket.connected) await action({ pseudo });
  });
}

function socketError(socket, error, acknowledge) {
  console.error("Opération FicoDutch non terminée :", error.code ?? error.name);
  if (typeof acknowledge === "function") acknowledge(false);
  socket.emit("hub:error", "Le serveur n’a pas pu enregistrer cette action. Réessaie dans un instant.");
}

async function persistEnd(socket, request, status, acknowledge) {
  const found = findPlayerHub(socket.id);
  const hub = found?.hub;
  if (!found?.player.isHost || !hub.gameStarted || hub.id !== request?.hubId ||
      hub.gameNumber !== request.gameNumber || !request.report || closing.has(hub.id)) {
    if (typeof acknowledge === "function") acknowledge(false);
    return;
  }
  closing.add(hub.id);
  try {
    const id = matchId(hub);
    const through = request.rounds?.length ? await persistRatings(hub, request.rounds) : hub.roundRating?.number ?? 0;
    if (through === null || (Number.isSafeInteger(request.report.rounds) && request.report.rounds > through)) {
      if (typeof acknowledge === "function") acknowledge(false);
      return;
    }
    if (!await matchStore.finish(id, status, request.report, Date.now(), request.table)) {
      if (typeof acknowledge === "function") acknowledge(false);
      return;
    }
    if (status === "finished") {
      hub.gameFinished = true;
    } else {
      const sockets = interruptHub(socket.id, hub.id);
      if (sockets) io.to(sockets).emit("hub:ended", { hubId: hub.id, reason: "interrupted", matchId: id, tableSummary: true });
    }
    if (typeof acknowledge === "function") acknowledge(true);
    broadcastHubs();
  } finally {
    closing.delete(hub.id);
  }
}

async function persistRatings(hub, rounds) {
  const gameNumber = hub.gameNumber;
  const saved = await matchStore.recordRounds(matchId(hub), rounds);
  if (!saved) return null;
  if (hub.gameNumber === gameNumber && saved.results.length &&
      saved.through > (hub.roundRating?.number ?? 0)) {
    for (const { number, changes } of saved.results) {
      applyRoundRating(hub, number, changes);
      for (const { accountId, after } of changes) {
        const bot = demoBots.find(({ id }) => id === accountId);
        if (bot) bot.rating = after;
      }
    }
    broadcastHubs();
  }
  return saved.through;
}

io.on("connection", (socket) => {
  console.log("Connexion établie :", socket.id);
  socket.emit("hubs:update", getAllHubs(), Date.now());

  socket.on("hub:peer-signal", (request) => {
    const relay = resolvePeerRelay(socket.id, request);
    if (relay) io.to(relay.socketId).emit("hub:peer-signal", relay.signal);
  });

  socket.on("hub:peer-relay", (request) => {
    const relay = resolveEncryptedRelay(socket.id, request);
    if (relay) io.to(relay.socketId).emit("hub:peer-relay", relay.signal);
  });

  socket.on("hub:lobby-chat", (request, acknowledge) => {
    const result = relayLobbyMessage(socket.id, request);
    if (result.status === "ok") io.to(result.socketIds).emit("hub:lobby-chat", result.message);
    if (typeof acknowledge === "function") acknowledge(result.status);
  });

  socket.on("hub:create", (data) => {
    if (!checkClientBuild(socket)) return;
    void admit(socket, data, async (identity) => {
      const rating = identity.id ? await matchStore?.getRating(identity.id) : undefined;
      if (!socket.connected) return;
      const membership = createHub(socket.id, identity.pseudo, identity.id, !!matchStore, identity.avatarStyle, identity.avatarPhotoId, rating);
      if (!membership) return socket.emit("hub:error", "Tu appartiens déjà à un Hub.");
      privateRequests.delete(socket.id);
      socket.emit("hub:created", membership, Date.now());
      broadcastHubs();
      console.log("Hub créé :", membership.hub.name);
    }).catch((error) => socketError(socket, error));
  });

  socket.on("hub:join", async (data) => {
    if (!checkClientBuild(socket)) return;
    const hubId = data?.hubId;
    if (typeof hubId !== "string" || !hubId) {
      socket.emit("hub:error", "Informations invalides.");
      return;
    }
    try { await admit(socket, data, async (identity) => {
      const rating = identity.id ? await matchStore?.getRating(identity.id) : undefined;
      const hub = getHub(hubId);
      const id = matchStore && hub?.gameStarted ? matchId(hub) : null;
      const returnToken = typeof data.returnToken === "string" && data.returnToken.length === 43 ? data.returnToken : undefined;
      const returning = hub && returningPlayer(hub, identity, returnToken);
      if (closing.has(hubId) || (id && identity.id && !returning && await matchStore.hasSeat(id, identity.id))) {
        socket.emit("hub:error", "Ce compte a déjà une place dans cette partie, ou la table est en cours de fermeture.");
        return;
      }
      if (!socket.connected || closing.has(hubId)) return;
      if (hub?.isPrivate && !returning) {
        if (!canRequestAdmission(hub) || findPlayerHub(socket.id) ||
            (identity.id && hub.players.some(({ accountId }) => accountId === identity.id)) ||
            [...privateRequests].some(([otherSocketId, entry]) => otherSocketId !== socket.id && entry.hubId === hubId &&
              (identity.id ? entry.identity.id === identity.id : entry.identity.pseudo.toLowerCase() === identity.pseudo.toLowerCase()))) {
          return socket.emit("hub:error", "Ce Hub privé est indisponible ou une demande existe déjà pour ce pseudo.");
        }
        const pending = privateRequests.get(socket.id);
        if (pending?.hubId !== hubId) privateRequests.set(socket.id, { id: randomUUID(), hubId, identity, rating });
        socket.emit("hub:admission", { hubId, status: "waiting" });
        broadcastHubs();
        return;
      }
      const membership = joinHub(hubId, socket.id, identity.pseudo, identity.id, identity.avatarStyle, identity.avatarPhotoId,
        rating, false, returnToken);
      if (!membership) {
        socket.emit("hub:error", "Impossible de rejoindre ce Hub. Vérifie qu’il est disponible et que ce compte n’y occupe pas déjà une place.");
        return;
      }
      if (matchStore && membership.hub.gameStarted) {
        try {
          await matchStore.addSeat(matchId(membership.hub), findPlayerHub(socket.id).player);
        } catch (error) {
          removePlayer(socket.id, !!returning);
          broadcastHubs();
          throw error;
        }
      }
      privateRequests.delete(socket.id);
      socket.emit("hub:joined", membership, Date.now());
      broadcastHubs();
    });
    } catch (error) {
      socketError(socket, error);
    }
  });

  socket.on("hub:round-variants", (request) => {
    if (publishRoundVariants(socket.id, request)) broadcastHubs();
  });

  socket.on("hub:cancel-admission", (request) => {
    const hubId = request?.hubId;
    if (!hubId || privateRequests.get(socket.id)?.hubId !== hubId) return;
    privateRequests.delete(socket.id);
    socket.emit("hub:admission", { hubId, status: "cancelled" });
    broadcastHubs();
  });

  socket.on("hub:admission-decision", (request) => {
    const current = findPlayerHub(socket.id);
    if (!current?.player.isHost || current.hub.id !== request?.hubId ||
        !canRequestAdmission(current.hub) || typeof request.accept !== "boolean") return;
    const match = [...privateRequests].find(([, entry]) => entry.hubId === current.hub.id && entry.id === request.requestId);
    if (!match) return;
    const [socketId, entry] = match;
    const applicant = io.sockets.sockets.get(socketId);
    if (!applicant) return;
    const { id, pseudo } = entry.identity;
    function stillPending() {
      const authority = findPlayerHub(socket.id);
      return privateRequests.get(socketId) === entry && applicant.connected && authority?.player.isHost &&
        authority.hub.id === entry.hubId && canRequestAdmission(authority.hub);
    }

    async function decide() {
      if (!stillPending()) return;
      const identity = id ? accountIdentity(applicant) : entry.identity;
      const allowed = request.accept && identity && !findPlayerHub(socketId) &&
        (id ? identity.id === id : !guestNameInUse(pseudo) && !await matchStore?.nameReserved(pseudo));
      if (!stillPending()) return;
      privateRequests.delete(socketId);
      const membership = allowed && joinHub(entry.hubId, socketId, identity.pseudo, identity.id,
        identity.avatarStyle, identity.avatarPhotoId, entry.rating, true);
      if (membership) applicant.emit("hub:joined", membership, Date.now());
      else applicant.emit("hub:admission", { hubId: entry.hubId, status: request.accept ? "closed" : "refused" });
      broadcastHubs();
    }
    void (id ? decide() : withPlayerName(pseudo, decide)).catch((error) => socketError(socket, error));
  });

  socket.on("hub:resume", (request, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    const resumed = resumeHub(socket.id, request, Date.now(), accountIdentity(socket)?.id);
    if (!resumed) {
      acknowledge(null, Date.now());
      return;
    }
    const { previousSocketId, ...membership } = resumed;
    privateRequests.delete(socket.id);
    if (previousSocketId) io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    if (previousSocketId && membership.session.isHost && membership.hub.hostPause) {
      scheduleHostExpiry(membership.hub.id, membership.hub.hostPause.until);
    }
    acknowledge(membership, Date.now());
    broadcastHubs();
    if (membership.session.isHost && membership.hub.hostPause?.transfer) {
      const hub = getHub(membership.hub.id);
      if (hub) sendPromotion(hub, socket.id, roundBackups.get(hub), hub.hostPause.startedAt);
    }
  });

  socket.on("hub:host-ready", () => {
    if (completeHostResume(socket.id)) broadcastHubs();
  });

  socket.on("hub:pause", (request) => {
    if (closing.has(request?.hubId)) return;
    const hub = changeManualPause(socket.id, request);
    if (!hub) return;
    broadcastHubs();
    const resumeAt = hub.manualPause?.resumeAt;
    if (resumeAt === undefined) return;
    function resume() {
      const now = Date.now();
      if (hub.manualPause?.resumeAt !== resumeAt || getHub(hub.id) !== hub) return;
      if (now < resumeAt) setTimeout(resume, resumeAt - now);
      else if (finishManualResume(hub, resumeAt, now)) broadcastHubs();
    }
    setTimeout(resume, Math.max(0, resumeAt - Date.now()));
  });

  socket.on("hub:backup-ready", (request) => {
    const current = findPlayerHub(socket.id);
    if (!current || current.player.isHost || current.hub.id !== request?.hubId || current.hub.hostId !== request.hostId) return;
    if (!backupHolders.has(current.hub)) backupHolders.set(current.hub, new Map());
    backupHolders.get(current.hub).set(current.player.id, current.player.connectionVersion);
  });

  socket.on("hub:backup-round", (request) => {
    const current = findPlayerHub(socket.id);
    if (current && !current.hub.hostPause) saveRoundBackup(current, request);
  });

  socket.on("hub:checkpoint", (request, acknowledge) => {
    if (!matchStore) return;
    const current = findPlayerHub(socket.id);
    const hub = current?.hub;
    if (!current?.player.isHost || !hub.gameStarted || hub.gameFinished || closing.has(hub.id) ||
        hub.id !== request?.hubId || hub.gameNumber !== request.gameNumber) return;
    const now = Date.now();
    if (now - (recentCheckpoints.get(hub) ?? 0) < 12_000) return;
    recentCheckpoints.set(hub, now);
    void matchStore.checkpoint(matchId(hub), request.sequence, request.report, request.table).then((accepted) => {
      if (typeof acknowledge === "function") acknowledge(accepted);
    }).catch((error) => console.error("Point de reprise non enregistré :", error.code ?? error.name));
  });

  socket.on("hub:finish", (request, acknowledge) => {
    if (!matchStore) {
      if (finishHubGame(socket.id, request)) broadcastHubs();
      return;
    }
    void persistEnd(socket, request, "finished", acknowledge).catch((error) => socketError(socket, error, acknowledge));
  });

  socket.on("hub:rate-rounds", (request, acknowledge) => {
    const current = findPlayerHub(socket.id);
    const hub = current?.hub;
    if (typeof acknowledge !== "function") return;
    if (!matchStore || !current?.player.isHost || !hub.gameStarted || hub.hostPause || hub.manualPause || closing.has(hub.id) ||
        hub.id !== request?.hubId || hub.gameNumber !== request.gameNumber) return acknowledge(null);
    void persistRatings(hub, request.rounds).then(acknowledge).catch((error) => {
      console.error("Indice RN non enregistré :", error.code ?? error.name);
      acknowledge(null);
    });
  });

  socket.on("hub:restart", async (request, acknowledge) => {
    const hub = findPlayerHub(socket.id)?.hub;
    const previous = hub && { ...hub };
    if (!hub || closing.has(hub.id) || !restartHubGame(socket.id, request)) {
      socket.emit("hub:error", "Impossible de relancer la partie. Il faut au moins deux joueurs disponibles.");
      if (typeof acknowledge === "function") acknowledge(false);
      return;
    }
    closing.add(hub.id);
    try {
      if (matchStore) await matchStore.register(hub);
      broadcastHubs();
      if (typeof acknowledge === "function") acknowledge(true);
    } catch (error) {
      Object.assign(hub, previous);
      socketError(socket, error, acknowledge);
    } finally {
      closing.delete(hub.id);
    }
  });

  socket.on("hub:add-bot", (request) => {
    if (!addHubBot(socket.id, request?.hubId, demoBots)) {
      socket.emit("hub:error", "L’ajout d’un bot nécessite une place libre dans la salle d’attente de ton Hub.");
      return;
    }
    broadcastHubs();
  });

  socket.on("hub:remove-guest", async (request) => {
    const { hubId, playerId } = request ?? {};
    const result = removeHubGuest(socket.id, hubId, playerId);
    if (!result) {
      socket.emit("hub:error", "Ce joueur ne peut pas être retiré de la table.");
      return;
    }
    const hub = getHub(hubId);
    if (hub) backupHolders.get(hub)?.delete(playerId);
    if (matchStore && hub?.gameStarted) {
      await matchStore.recordDeparture(matchId(hub), playerId, "removed").catch((error) => socketError(socket, error));
    }
    if (result.socketId) io.to(result.socketId).emit("hub:ended", { hubId, reason: "removed" });
    broadcastHubs();
  });

  socket.on("hub:interrupt", (request, acknowledge) => {
    const { hubId } = request ?? {};
    if (matchStore) {
      void persistEnd(socket, request, "interrupted", acknowledge).catch((error) => socketError(socket, error, acknowledge));
      return;
    }
    const socketIds = interruptHub(socket.id, hubId);
    if (!socketIds) {
      socket.emit("hub:error", "Cette partie ne peut plus être interrompue.");
      return;
    }
    io.to(socketIds).emit("hub:ended", { hubId, reason: "interrupted" });
    broadcastHubs();
  });

  socket.on("hub:update-settings", (settings) => {
    const hub = updateHubSettings(socket.id, settings);
    if (!hub) {
      socket.emit("hub:error", "Seul le créateur peut modifier les paramètres du Hub.");
      return;
    }
    broadcastHubs();
    console.log("Paramètres du Hub modifiés :", hub.name);
  });

  socket.on("hub:start", async (request, acknowledge) => {
    const result = startHubGame(socket.id, request);
    if (result.error) {
      if (typeof acknowledge === "function") acknowledge(false);
      socket.emit("hub:error", result.error);
      return;
    }
    const hub = getHub(result.hub.id);
    saveRoundBackup(findPlayerHub(socket.id), request?.backup);
    closing.add(hub.id);
    try {
      if (matchStore) await matchStore.register(hub);
      broadcastHubs();
      if (typeof acknowledge === "function") acknowledge(true);
    } catch (error) {
      hub.gameStarted = false;
      delete hub.initialCardCounts;
      delete hub.memorizationEndsAt;
      socketError(socket, error, acknowledge);
    } finally {
      closing.delete(hub.id);
    }
  });

  socket.on("hub:leave", async (request, acknowledge) => {
    const current = findPlayerHub(socket.id);
    if (current?.player.isHost && current.hub.gameStarted && !current.hub.gameFinished) {
      try {
        const accepted = await departHost(socket, current, request, true);
        if (typeof acknowledge === "function") acknowledge(accepted);
      } catch (error) {
        socketError(socket, error, acknowledge);
      }
      return;
    }
    const result = removePlayer(socket.id, true);
    if (result) {
      if (current) backupHolders.get(current.hub)?.delete(current.player.id);
      if (matchStore && current?.hub.gameStarted && !current.player.isHost) {
        await matchStore.recordDeparture(matchId(current.hub), current.player.id, "left").catch((error) => socketError(socket, error));
      }
      socket.emit("hub:left");
      broadcastHubs();
      console.log("Joueur sorti de son Hub :", socket.id);
    }
  });

  socket.on("disconnect", () => {
    console.log("Déconnexion :", socket.id);
    const current = findPlayerHub(socket.id);
    const hadRequest = privateRequests.delete(socket.id);
    if (current?.player.isHost && current.hub.gameStarted && !current.hub.gameFinished) {
      void departHost(socket, current, null, false).catch((error) => {
        console.error("Départ de l’hôte non enregistré :", error.code ?? error.name);
        const fallback = disconnectPlayer(socket.id);
        if (fallback?.pauseUntil !== undefined) scheduleHostExpiry(fallback.hubId, fallback.pauseUntil);
        broadcastHubs();
      });
      return;
    }
    if (current) backupHolders.get(current.hub)?.delete(current.player.id);
    const result = disconnectPlayer(socket.id);
    if (!result && !hadRequest) return;
    broadcastHubs();

    if (!result) return;
    const { hubId, pauseUntil } = result;
    if (pauseUntil !== undefined) scheduleHostExpiry(hubId, pauseUntil);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
async function start() {
  const db = await openDatabase();
  if (db) {
    matchStore = createMatchStore(db);
    if (process.env.FICODUTCH_DEMO === "1") {
      const { seedDemoPopulation } = require("./demoPopulation");
      await seedDemoPopulation(db, matchStore);
      demoBots = await matchStore.listBots();
      console.log(`Population de test disponible : ${demoBots.length} bots et leur historique simulé.`);
    }
    const readAccount = mountAccounts(app, io, db, acceptsOrigin, broadcastHubs);
    mountMatchRoutes(app, matchStore, readAccount, acceptsOrigin);
    setInterval(async () => {
      try {
        for (const id of await matchStore.staleMatches(Date.now() - 120_000, getActiveMatchIds())) {
          if (!getHub(id.split(":")[0])) await matchStore.finish(id, "interrupted");
        }
      } catch (error) {
        console.error("Reprise des bilans en attente :", error.code ?? error.name);
      }
    }, 60_000).unref();
  } else {
    app.get("/api/session", (_request, response) => response.json({ enabled: false, account: null }));
  }
  app.use("/api", (_request, response) => response.status(404).json({ error: "Cette page est indisponible." }));
  app.use((error, _request, response, _next) => {
    console.error("Requête API non terminée :", error.code ?? error.name);
    response.status(error.status === 413 ? 413 : 503).json({ error: "Le service est momentanément indisponible." });
  });
  httpServer.listen(PORT, HOST, () => console.log(`FicoDutch Server démarré sur le port ${PORT}`));
}

start().catch((error) => {
  console.error("Démarrage de FicoDutch impossible :", error.code ?? error.name);
  process.exit(1);
});
