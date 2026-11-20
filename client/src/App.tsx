
import { useState, useEffect } from "react";
import { GAME_CONFIG } from "./config/gameConfig";
import { Users, BookOpen, Plus, Spade } from "lucide-react";
import "./App.css";
import { socket, connectToServer, disconnectFromServer } from "./network/socket";
import type { Hub } from "../../shared/hubTypes";
import Rules from "./ui/Rules";
import GameTable from "./ui/GameTable";

function App() {
  const [pseudo, setPseudo] = useState(
    localStorage.getItem("ficodutch-pseudo") || ""
  );

  const [showRules, setShowRules] = useState(false);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [currentHub, setCurrentHub] = useState<Hub | null>(null);

  useEffect(() => {
    connectToServer();

    socket.on("connect", () => {
      console.log("FicoDutch connecté au serveur :", socket.id);
    });

    socket.on("hubs:update", (updatedHubs: Hub[]) => {
      setHubs(updatedHubs);

      setCurrentHub((current) => {
        if (!current) return null;

        return updatedHubs.find((hub) => hub.id === current.id) || null;
      });
    });

    socket.on("hub:created", (hub: Hub) => {
      setCurrentHub(hub);
    });

    socket.on("hub:joined", (hub: Hub) => {
      setCurrentHub(hub);
    });

    socket.on("disconnect", () => {
      console.log("FicoDutch déconnecté du serveur");
    });

    socket.on("hub:error", (message: string) => {
      alert(message);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("hubs:update");
      socket.off("hub:error");
      socket.off("hub:created");
      socket.off("hub:joined");
      disconnectFromServer();
    };
  }, []);

  function savePseudo(value: string) {
    setPseudo(value);
    localStorage.setItem("ficodutch-pseudo", value);
  }

  function createHub() {
    const cleanPseudo = pseudo.trim();

    if (cleanPseudo.length < GAME_CONFIG.player.pseudoMinLength) {
      alert("Ton pseudo doit contenir au moins 2 caractères.");
      return;
    }

    if (!GAME_CONFIG.player.allowedPseudoPattern.test(cleanPseudo)) {
      alert("Le pseudo doit uniquement contenir des lettres et des chiffres.");
      return;
    }

    if (!socket.connected) {
      alert("Connexion au serveur en cours. Réessaie dans un instant.");
      return;
    }

    socket.emit("hub:create", { pseudo: cleanPseudo });
  }

  function joinHub(hubId: string) {
    const cleanPseudo = pseudo.trim();

    if (cleanPseudo.length < GAME_CONFIG.player.pseudoMinLength) {
      alert("Ton pseudo doit contenir au moins 2 caractères.");
      return;
    }

    if (!GAME_CONFIG.player.allowedPseudoPattern.test(cleanPseudo)) {
      alert("Le pseudo doit uniquement contenir des lettres et des chiffres.");
      return;
    }

    socket.emit("hub:join", {
      hubId,
      pseudo: cleanPseudo,
    });
  }

  if (showRules) {
  return <Rules onBack={() => setShowRules(false)} />;
  }

  if (currentHub?.gameStarted) {
  return (
    <main className="game-screen">
      <GameTable
        localPlayerId={socket.id ?? ""}
        players={currentHub.players.map((player) => ({
          id: player.id,
          pseudo: player.pseudo,
          cardCount: currentHub.variants.sixCards ? 6 : 4,
        }))}
      />
    </main>
  );
}

  if (currentHub) {
    return (
      <main className="home-page">
        <header className="top-bar">
          <div className="brand">
            <Spade size={28} />
            <span>FicoDutch</span>
          </div>
          <span className="version">
            Version {GAME_CONFIG.version}
          </span>
        </header>

        <section className="hero">
          <h1>{currentHub.name}</h1>
          <p className="subtitle">Salle d'attente</p>

          <div className="home-panel">
            <h2>Joueurs présents</h2>

            <p>
              {currentHub.players.length}/{currentHub.maxPlayers} joueurs
            </p>

            
<div className="hub-settings">
  <h3>Paramètres de la partie</h3>

  
<div className="threshold-setting">
  <h4>Fin de partie</h4>

  <input
    type="range"
    min="0"
    max="5"
    step="1"
    value={
      [50, 100, 200, 500, 1000, null].indexOf(currentHub.endThreshold)
    }
    disabled={
  currentHub.hostId !== socket.id ||
  currentHub.gameStarted
}
    onChange={(event) => {
      const values = [50, 100, 200, 500, 1000, null];
      const threshold = values[Number(event.target.value)];

      socket.emit("hub:update-settings", {
        variants: currentHub.variants,
        endThreshold: threshold,
      });
    }}
  />

  <div className="threshold-labels">
    <span>50</span>
    <span>100</span>
    <span>200</span>
    <span>500</span>
    <span>1000</span>
    <span>No Limit</span>
  </div>
</div>


  <h4>Variantes</h4>

  
<div className="variant-grid">
  {(
    [
      ["sixCards", "6 cartes"],
      ["infinitePose", "Pose infinie"],
      ["plusMinusOne", "+1 / -1"],
      ["jokerPlus", "Joker +"],
    ] as const
  ).map(([key, label]) => (
    <button
      key={key}
      type="button"
      className={`variant-button ${
        currentHub.variants[key] ? "active" : ""
      }`}
      disabled={
  currentHub.hostId !== socket.id ||
  currentHub.gameStarted
}
      onClick={() => {
        socket.emit("hub:update-settings", {
          variants: {
            ...currentHub.variants,
            [key]: !currentHub.variants[key],
          },
          endThreshold: currentHub.endThreshold,
        });
      }}
    >
      {label}

    </button>
  ))}
</div>

</div>


            {currentHub.players.map((player) => (
              <div className="hub-item" key={player.id}>
                <div className="hub-info">
                  <strong>{player.pseudo}</strong>
                  <span>
                    {player.isHost ? "Créateur du Hub" : "Joueur"}
                  </span>
                </div>
                <span>{player.connected ? "Connecté" : "Déconnecté"}</span>
              </div>
            ))}

            {!currentHub.gameStarted ? (
  <>
    <p>En attente du lancement de la partie...</p>

    {currentHub.hostId === socket.id && (
      <button
        type="button"
        className="start-game-button"
        disabled={currentHub.players.length < 2}
        onClick={() => socket.emit("hub:start")}
      >
        Lancer la partie
      </button>
    )}
  </>
) : (
  <>
    <p>La partie est lancée !</p>

    <GameTable
      localPlayerId={socket.id ?? ""}
      players={currentHub.players.map((player) => ({
        id: player.id,
        pseudo: player.pseudo,
        cardCount: currentHub.variants.sixCards ? 6 : 4,
      }))}
    />
  </>
)}
            <button
  className="rules-button"
  onClick={() => {
    socket.emit("hub:leave");
    setCurrentHub(null);
  }}
>
  Quitter le Hub
</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="home-page">
      <header className="top-bar">
        <div className="brand">
          <Spade size={28} />
          <span>FicoDutch</span>
        </div>

        <span className="version">
          Version {GAME_CONFIG.version}
        </span>
      </header>

      <section className="hero">
        <div className="hero-icon">🃏</div>

        <h1>FicoDutch</h1>

        <p className="subtitle">
          Le jeu de cartes où mémoire, stratégie et audace font la différence.
        </p>

        <div className="home-panel">
          <label htmlFor="pseudo">Choisis ton pseudo</label>

          <input
            id="pseudo"
            type="text"
            placeholder="Ton pseudo..."
            value={pseudo}
            maxLength={GAME_CONFIG.player.pseudoMaxLength}
            onChange={(event) => savePseudo(event.target.value)}
          />

          <button className="primary-button" onClick={createHub}>
            <Plus size={20} />
            Créer un Hub
          </button>

          <div className="separator">
            <span>OU REJOINDRE UNE PARTIE</span>
          </div>

          <div className="hub-list">
            {hubs.length === 0 ? (
              <div className="empty-hubs">
                <Users size={22} />
                <p>Aucun Hub disponible pour le moment.</p>
              </div>
            ) : (
              hubs.map((hub) => (
                <div className="hub-item" key={hub.id}>
                  <div className="hub-info">
                    <strong>{hub.name}</strong>
                    <span>Créé par {hub.hostPseudo}</span>
                    <span>
                      {hub.players.length}/{hub.maxPlayers} joueurs
                    </span>
                  </div>

                  <div className="hub-actions">
                    <div className="hub-status">
                      {hub.status === "waiting" && "En attente"}
                      {hub.status === "in-progress" && "En cours"}
                      {hub.status === "full" && "Complet"}
                    </div>

                    <button
                      className="join-button"
                      disabled={hub.status !== "waiting" || !pseudo.trim()}
                      onClick={() => joinHub(hub.id)}
                    >
                      Rejoindre
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <button
          className="rules-button"
          onClick={() => setShowRules(true)}
        >
          <BookOpen size={18} />
          Consulter les règles
        </button>
      </section>

      <footer>
        FicoDutch · Jeu de cartes multijoueur · {GAME_CONFIG.version}
      </footer>
    </main>
  );
}

export default App;
