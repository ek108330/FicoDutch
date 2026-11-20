
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const {
  getAllHubs,
  createHub,
  joinHub,
  updateHubSettings,
  startHubGame,
  removePlayer,
} = require("./hubManager");

const app = express();
const httpServer = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.json({
    name: "FicoDutch Server",
    status: "online",
    message: "Le serveur central fonctionne.",
  });
});

function broadcastHubs() {
  io.emit("hubs:update", getAllHubs());
}

io.on("connection", (socket) => {
  console.log("Connexion établie :", socket.id);

  socket.emit("hubs:update", getAllHubs());

  // Créer un Hub
  socket.on("hub:create", (data) => {
    const pseudo = data?.pseudo?.trim();

    if (!pseudo || pseudo.length < 2 || pseudo.length > 20) {
      socket.emit("hub:error", "Pseudo invalide.");
      return;
    }

    const hub = createHub(socket.id, pseudo);

if (!hub) {
  socket.emit("hub:error", "Tu appartiens déjà à un Hub.");
  return;
}

socket.emit("hub:created", hub);
broadcastHubs();

console.log("Hub créé :", hub.name);
  });

  // Rejoindre un Hub
  socket.on("hub:join", (data) => {
    const pseudo = data?.pseudo?.trim();
    const hubId = data?.hubId;

    if (!pseudo || pseudo.length < 2 || pseudo.length > 20 || !hubId) {
      socket.emit("hub:error", "Informations invalides.");
      return;
    }

    const hub = joinHub(hubId, socket.id, pseudo);

    if (!hub) {
  socket.emit(
    "hub:error",
    "Impossible de rejoindre ce Hub. Vérifie qu'il est disponible et que tu n'appartiens pas déjà à un autre Hub."
  );
  return;
}

    socket.emit("hub:joined", hub);
    broadcastHubs();

    console.log(pseudo, "a rejoint", hub.name);
  });

  // Modifier les paramètres du Hub
socket.on("hub:update-settings", (settings) => {
  const hub = updateHubSettings(socket.id, settings);

  if (!hub) {
    socket.emit(
      "hub:error",
      "Seul le créateur peut modifier les paramètres du Hub."
    );
    return;
  }

  broadcastHubs();

  console.log("Paramètres du Hub modifiés :", hub.name);
});

// Lancer une partie
socket.on("hub:start", () => {
  const result = startHubGame(socket.id);

  if (result.error) {
    socket.emit("hub:error", result.error);
    return;
  }

  broadcastHubs();

  console.log("Partie lancée :", result.hub.name);
});

  // Quitter volontairement un Hub
  socket.on("hub:leave", () => {
    const result = removePlayer(socket.id);

    if (result) {
      socket.emit("hub:left");
      broadcastHubs();

      console.log("Joueur sorti de son Hub :", socket.id);
    }
  });

  // Déconnexion
  socket.on("disconnect", () => {
    console.log("Déconnexion :", socket.id);

    const result = removePlayer(socket.id);

    if (result) {
      broadcastHubs();
    }
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`FicoDutch Server démarré sur le port ${PORT}`);
});
