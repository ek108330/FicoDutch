const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("node:path");
const { Server } = require("socket.io");
const { openDatabase } = require("./database");
const { mountAccounts } = require("./accounts");
const { createMatchStore, mountMatchRoutes, matchId } = require("./matchStore");
const {
  getAllHubs, createHub, joinHub, updateHubSettings, startHubGame, resolvePeerRelay, removePlayer,
  disconnectPlayer, resumeHub, completeHostResume, expireHostPause, finishHubGame, restartHubGame,
  addHubBot, removeHubGuest, interruptHub, relayLobbyMessage, resolveEncryptedRelay, findPlayerHub, getHub, getActiveMatchIds,
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
const closing = new Set();
const recentCheckpoints = new WeakMap();

if (process.env.SERVE_CLIENT === "1") {
  const clientFiles = path.resolve(__dirname, "../client/dist");
  app.use(express.static(clientFiles, {
    setHeaders(response, file) {
      if (path.extname(file) === ".html") response.setHeader("Cache-Control", "no-store");
    },
  }));
  app.get(["/parties/:id", "/joueurs/:id", "/mes-parties", "/compte"], (_request, response) =>
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
  io.emit("hubs:update", getAllHubs(), Date.now());
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
        io.to(sockets).emit("hub:ended", { hubId, reason: "interrupted", matchId: matchId(hub) });
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

function seatIdentity(socket, data) {
  if (!matchStore) {
    const pseudo = readPseudo(data);
    return pseudo && { pseudo };
  }
  const session = socket.data.session;
  return session && session.expiresAt > Date.now() ? { id: session.account.id, pseudo: session.account.name } : null;
}

function socketError(socket, error, acknowledge) {
  console.error("Opération FicoDutch non terminée :", error.code ?? error.name);
  if (typeof acknowledge === "function") acknowledge(false);
  socket.emit("hub:error", "Le serveur n’a pas pu enregistrer cette action. Réessaie dans un instant.");
}

async function persistEnd(socket, request, status, acknowledge) {
  const found = findPlayerHub(socket.id);
  const hub = found?.hub;
  if (!found?.player.isHost || !seatIdentity(socket) || !hub.gameStarted || hub.id !== request?.hubId ||
      hub.gameNumber !== request.gameNumber || !request.report || closing.has(hub.id)) {
    if (typeof acknowledge === "function") acknowledge(false);
    return;
  }
  closing.add(hub.id);
  try {
    const id = matchId(hub);
    if (!await matchStore.finish(id, status, request.report)) {
      if (typeof acknowledge === "function") acknowledge(false);
      return;
    }
    if (status === "finished") {
      hub.gameFinished = true;
      io.to(hub.players.map(({ socketId }) => socketId).filter(Boolean)).emit("match:ready", { id, hubId: hub.id });
    } else {
      const sockets = interruptHub(socket.id, hub.id);
      if (sockets) io.to(sockets).emit("hub:ended", { hubId: hub.id, reason: "interrupted", matchId: id });
    }
    if (typeof acknowledge === "function") acknowledge(true);
    broadcastHubs();
  } finally {
    closing.delete(hub.id);
  }
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
    const identity = seatIdentity(socket, data);
    if (!identity) {
      socket.emit("hub:error", matchStore ? "Connecte-toi pour créer un Hub." : "Pseudo invalide.");
      return;
    }
    const membership = createHub(socket.id, identity.pseudo, identity.id);
    if (!membership) {
      socket.emit("hub:error", "Tu appartiens déjà à un Hub.");
      return;
    }
    socket.emit("hub:created", membership, Date.now());
    broadcastHubs();
    console.log("Hub créé :", membership.hub.name);
  });

  socket.on("hub:join", async (data) => {
    if (!checkClientBuild(socket)) return;
    const identity = seatIdentity(socket, data);
    const hubId = data?.hubId;
    if (!identity || typeof hubId !== "string" || !hubId) {
      socket.emit("hub:error", matchStore && !identity ? "Connecte-toi pour rejoindre un Hub." : "Informations invalides.");
      return;
    }
    try {
      const hub = getHub(hubId);
      const id = matchStore && hub?.gameStarted ? matchId(hub) : null;
      if (closing.has(hubId) || (id && await matchStore.hasSeat(id, identity.id))) {
        socket.emit("hub:error", "Ce compte a déjà une place dans cette partie, ou la table est en cours de fermeture.");
        return;
      }
      if (!socket.connected || closing.has(hubId)) return;
      const membership = joinHub(hubId, socket.id, identity.pseudo, identity.id);
      if (!membership) {
        socket.emit("hub:error", "Impossible de rejoindre ce Hub. Vérifie qu’il est disponible et que ce compte n’y occupe pas déjà une place.");
        return;
      }
      if (matchStore && membership.hub.gameStarted) {
        try {
          await matchStore.addSeat(matchId(membership.hub), findPlayerHub(socket.id).player);
        } catch (error) {
          removePlayer(socket.id);
          broadcastHubs();
          throw error;
        }
      }
      socket.emit("hub:joined", membership, Date.now());
      broadcastHubs();
    } catch (error) {
      socketError(socket, error);
    }
  });

  socket.on("hub:resume", (request, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    const identity = matchStore ? seatIdentity(socket) : null;
    const resumed = (!matchStore || identity) && resumeHub(socket.id, request, Date.now(), identity?.id);
    if (!resumed) {
      acknowledge(null, Date.now());
      return;
    }
    const { previousSocketId, ...membership } = resumed;
    if (previousSocketId) io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    if (previousSocketId && membership.session.isHost && membership.hub.hostPause) {
      scheduleHostExpiry(membership.hub.id, membership.hub.hostPause.until);
    }
    acknowledge(membership, Date.now());
    broadcastHubs();
  });

  socket.on("hub:host-ready", () => {
    if (completeHostResume(socket.id)) broadcastHubs();
  });

  socket.on("hub:checkpoint", (request, acknowledge) => {
    if (!matchStore || !seatIdentity(socket)) return;
    const current = findPlayerHub(socket.id);
    const hub = current?.hub;
    if (!current?.player.isHost || !hub.gameStarted || hub.gameFinished || closing.has(hub.id) ||
        hub.id !== request?.hubId || hub.gameNumber !== request.gameNumber) return;
    const now = Date.now();
    if (now - (recentCheckpoints.get(hub) ?? 0) < 12_000) return;
    recentCheckpoints.set(hub, now);
    void matchStore.checkpoint(matchId(hub), request.sequence, request.report).then((accepted) => {
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
    if (!addHubBot(socket.id, request?.hubId)) {
      socket.emit("hub:error", "L’ajout d’un bot nécessite une place libre dans la salle d’attente de ton Hub.");
      return;
    }
    broadcastHubs();
  });

  socket.on("hub:remove-guest", (request) => {
    const { hubId, playerId } = request ?? {};
    const result = removeHubGuest(socket.id, hubId, playerId);
    if (!result) {
      socket.emit("hub:error", "Ce joueur ne peut pas être retiré de la table.");
      return;
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

  socket.on("hub:leave", () => {
    const result = removePlayer(socket.id);
    if (result) {
      socket.emit("hub:left");
      broadcastHubs();
      console.log("Joueur sorti de son Hub :", socket.id);
    }
  });

  socket.on("disconnect", () => {
    console.log("Déconnexion :", socket.id);
    const result = disconnectPlayer(socket.id);
    if (!result) return;
    broadcastHubs();

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
    const readAccount = mountAccounts(app, io, db, acceptsOrigin);
    mountMatchRoutes(app, matchStore, readAccount);
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
