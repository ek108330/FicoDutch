const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("node:path");
const { Server } = require("socket.io");
const {
  getAllHubs, createHub, joinHub, updateHubSettings, startHubGame, resolvePeerRelay, removePlayer,
  disconnectPlayer, resumeHub, completeHostResume, expireHostPause, finishHubGame,
  removeHubGuest, interruptHub, relayLobbyMessage,
} = require("./hubManager");

const app = express();
const httpServer = http.createServer(app);
const allowedOrigins = new Set((process.env.CLIENT_ORIGINS || process.env.RENDER_EXTERNAL_URL ||
  "http://localhost:5173,http://127.0.0.1:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean));
const acceptsOrigin = (origin) => !origin || allowedOrigins.has(origin);
const originPolicy = (origin, callback) => callback(null, acceptsOrigin(origin));
app.use(cors({ origin: originPolicy }));
app.use(express.json());

const io = new Server(httpServer, {
  cors: { origin: originPolicy, methods: ["GET", "POST"] },
  allowRequest: (request, callback) => callback(null, acceptsOrigin(request.headers.origin)),
});

app.get("/healthz", (_request, response) => response.json({ status: "online" }));
if (process.env.SERVE_CLIENT === "1") app.use(express.static(path.resolve(__dirname, "../client/dist")));

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
    if (expireHostPause(hubId, pauseUntil)) broadcastHubs();
  }, Math.max(0, pauseUntil - Date.now()) + 1).unref();
}

function readPseudo(data) {
  const pseudo = typeof data?.pseudo === "string" ? data.pseudo.trim() : "";
  return /^[A-Za-z0-9]{2,20}$/.test(pseudo) ? pseudo : null;
}

io.on("connection", (socket) => {
  console.log("Connexion établie :", socket.id);
  socket.emit("hubs:update", getAllHubs(), Date.now());

  socket.on("hub:peer-signal", (request) => {
    const relay = resolvePeerRelay(socket.id, request);
    if (relay) io.to(relay.socketId).emit("hub:peer-signal", relay.signal);
  });

  socket.on("hub:lobby-chat", (request, acknowledge) => {
    const result = relayLobbyMessage(socket.id, request);
    if (result.status === "ok") io.to(result.socketIds).emit("hub:lobby-chat", result.message);
    if (typeof acknowledge === "function") acknowledge(result.status);
  });

  socket.on("hub:create", (data) => {
    const pseudo = readPseudo(data);
    if (!pseudo) {
      socket.emit("hub:error", "Pseudo invalide.");
      return;
    }
    const membership = createHub(socket.id, pseudo);
    if (!membership) {
      socket.emit("hub:error", "Tu appartiens déjà à un Hub.");
      return;
    }
    socket.emit("hub:created", membership, Date.now());
    broadcastHubs();
    console.log("Hub créé :", membership.hub.name);
  });

  socket.on("hub:join", (data) => {
    const pseudo = readPseudo(data);
    const hubId = data?.hubId;
    if (!pseudo || typeof hubId !== "string" || !hubId) {
      socket.emit("hub:error", "Informations invalides.");
      return;
    }
    const membership = joinHub(hubId, socket.id, pseudo);
    if (!membership) {
      socket.emit("hub:error", "Impossible de rejoindre ce Hub. Vérifie qu'il est disponible et que tu n'appartiens pas déjà à un autre Hub.");
      return;
    }
    socket.emit("hub:joined", membership, Date.now());
    broadcastHubs();
    console.log(pseudo, "a rejoint", membership.hub.name);
  });

  socket.on("hub:resume", (request, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    const resumed = resumeHub(socket.id, request);
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

  socket.on("hub:finish", () => {
    if (finishHubGame(socket.id)) broadcastHubs();
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

  socket.on("hub:interrupt", (request) => {
    const { hubId } = request ?? {};
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

  socket.on("hub:start", (request, acknowledge) => {
    const result = startHubGame(socket.id, request);
    if (result.error) {
      if (typeof acknowledge === "function") acknowledge(false);
      socket.emit("hub:error", result.error);
      return;
    }
    broadcastHubs();
    if (typeof acknowledge === "function") acknowledge(true);
    console.log("Partie lancée :", result.hub.name);
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
httpServer.listen(PORT, HOST, () => {
  console.log(`FicoDutch Server démarré sur le port ${PORT}`);
});
