
import { useState, useEffect, useCallback, useRef } from "react";
import { GAME_CONFIG, hubStatusLabels } from "./config/gameConfig";
import { Plus, Settings, Spade } from "lucide-react";
import "./App.css";
import { socket, connectToServer, disconnectFromServer } from "./network/socket";
import { useHubPeers } from "./network/useHubPeers";
import { readHubSession, saveHubSession } from "./network/hubSession";
import type { Hub, HubEnd, HubMembership, HubSession, StartHubRequest } from "../../shared/hubTypes";
import { createRound } from "./game/createRound";
import { resumeGameClock } from "./game/gameClock";
import type { GameState } from "./game/gameTypes";
import { applyDepartures } from "./game/turn";
import type { UpdateHostRound } from "./game/useRoundTurn";
import GameSettings from "./ui/GameSettings";
import HubLobby from "./ui/HubLobby";
import HubPreview from "./ui/HubPreview";
import RoundScreen from "./ui/RoundScreen";
import { useGameAudio } from "./ui/useCardFeedback";

type CurrentHub = Hub & { memorizationDeadline?: number; pauseDeadline?: number };
type HostRound = { hubId: string; state: GameState };

function App() {
  const [pseudo, setPseudo] = useState(localStorage.getItem("ficodutch-pseudo") || "");
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const { sound, toggleSound, playSound } = useGameAudio();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [previewHubId, setPreviewHubId] = useState<string | null>(null);
  const [currentHub, setCurrentHub] = useState<CurrentHub | null>(null);
  const [session, setSession] = useState(readHubSession);
  const [networkReady, setNetworkReady] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [hostRound, setHostRound] = useState<HostRound | null>(null);
  const hubRef = useRef<CurrentHub | null>(null);
  const sessionRef = useRef(session);
  const readyRef = useRef(false);
  const hostRoundRef = useRef<HostRound | null>(null);
  const pausedAt = useRef<number | null>(null);
  const playerId = session?.playerId;
  const peers = useHubPeers(currentHub, playerId, networkReady);
  const awaitingPeers = !!currentHub && !currentHub.gameStarted &&
    currentHub.players.some(({ id, isBot }) => !isBot && id !== currentHub.hostId && (playerId === currentHub.hostId
      ? !peers.connectedPeers.includes(id) : !peers.hostConnected));

  const storeHostRound = useCallback((round: HostRound | null) => {
    hostRoundRef.current = round;
    setHostRound(round);
  }, []);

  const storeHub = useCallback((hub: CurrentHub | null) => {
    hubRef.current = hub;
    setCurrentHub(hub);
  }, []);

  const storeSession = useCallback((value: HubSession | null) => {
    sessionRef.current = value;
    setSession(value);
    saveHubSession(value);
  }, []);

  const storeReady = useCallback((ready: boolean) => {
    readyRef.current = ready;
    setNetworkReady(ready);
  }, []);

  const clearTable = useCallback(() => {
    storeHub(null);
    storeSession(null);
    storeHostRound(null);
    pausedAt.current = null;
  }, [storeHub, storeHostRound, storeSession]);

  const updateHostRound = useCallback<UpdateHostRound>((hubId, update) => {
    const current = hostRoundRef.current;
    const hub = hubRef.current;
    if (current?.hubId !== hubId || hub?.id !== hubId || !readyRef.current ||
        pausedAt.current !== null || !socket.connected) return;
    const state = update(current.state, hub.players);
    if (state !== current.state) storeHostRound({ hubId, state });
  }, [storeHostRound]);

  useEffect(() => {
    let resumeRetry: number | undefined;

    function applyHub(update: Hub, serverTime: number) {
      const receivedAt = performance.now();
      const previous = hubRef.current?.id === update.id ? hubRef.current : null;
      let memorizationDeadline = previous?.memorizationDeadline;
      if (memorizationDeadline === undefined && update.memorizationEndsAt !== undefined) {
        memorizationDeadline = receivedAt + Math.max(0, update.memorizationEndsAt - serverTime);
      }
      const pauseDeadline = update.hostPause
        ? previous?.hostPause?.until === update.hostPause.until && previous.pauseDeadline !== undefined
          ? previous.pauseDeadline
          : receivedAt + Math.max(0, update.hostPause.until - serverTime)
        : undefined;

      const round = hostRoundRef.current;
      if (round?.hubId === update.id && update.gameStarted) {
        let state = round.state;
        if (state.roundNumber === 1 && state.phase === "memorization" &&
            state.phaseDeadline === null && memorizationDeadline !== undefined) {
          state = { ...state, phaseDeadline: memorizationDeadline };
        }
        if (update.hostPause) {
          pausedAt.current ??= receivedAt;
        } else if (pausedAt.current !== null && readyRef.current) {
          state = resumeGameClock(state, receivedAt - pausedAt.current);
          pausedAt.current = null;
        }

        const presentIds = new Set(update.players.map(({ id }) => id));
        state = applyDepartures(state, presentIds, pausedAt.current ?? receivedAt);
        if (state !== round.state) storeHostRound({ ...round, state });
      }
      storeHub({ ...update, memorizationDeadline, pauseDeadline });
    }

    function acceptMembership({ hub, session }: HubMembership, serverTime: number) {
      storeSession(session);
      storeReady(true);
      setSessionNotice(null);
      setPreviewHubId(null);
      applyHub(hub, serverTime);
    }

    function onConnect() {
      console.log("FicoDutch connecté au serveur :", socket.id);
      const saved = sessionRef.current;
      if (!saved) {
        storeReady(true);
        return;
      }
      const connectionId = socket.id;
      const tryResume = () => {
        if (!socket.connected || socket.id !== connectionId || sessionRef.current?.token !== saved.token) return;
        socket.timeout(5_000).emit("hub:resume", {
          hubId: saved.hubId,
          token: saved.token,
          hasHostState: hostRoundRef.current?.hubId === saved.hubId,
        }, (error: Error | null, membership: HubMembership | null, serverTime: number) => {
          if (!socket.connected || socket.id !== connectionId || sessionRef.current?.token !== saved.token) return;
          if (error) {
            resumeRetry = window.setTimeout(tryResume, 1_000);
          } else if (membership) {
            acceptMembership(membership, serverTime);
          } else {
            const hostWithoutRound = saved.isHost && !hostRoundRef.current;
            clearTable();
            storeReady(true);
            setSessionNotice(hostWithoutRound
              ? "Pour reprendre une partie en tant qu’hôte, garde son onglet d’origine ouvert."
              : "La reprise de ce Hub n’est plus disponible.");
          }
        });
      };
      tryResume();
    }

    function onHubs(updatedHubs: Hub[], serverTime: number) {
      setHubs(updatedHubs);
      const current = hubRef.current;
      if (!current) return;
      const update = updatedHubs.find(({ id }) => id === current.id);
      if (!update?.players.some(({ id }) => id === sessionRef.current?.playerId)) {
        clearTable();
        if (socket.connected) storeReady(true);
        if (current.gameStarted) setSessionNotice(current.hostPause
          ? "La partie est terminée. L’hôte n’est pas revenu à temps."
          : "Le Hub de la partie a été fermé.");
        return;
      }
      applyHub(update, serverTime);
    }

    function onDisconnect() {
      if (hubRef.current?.gameStarted && hostRoundRef.current) pausedAt.current ??= performance.now();
      storeReady(false);
      window.clearTimeout(resumeRetry);
      console.log("FicoDutch déconnecté du serveur");
    }

    function onHubError(message: string) {
      alert(message);
    }

    function onHubEnded({ hubId, reason }: HubEnd) {
      if (sessionRef.current?.hubId !== hubId) return;
      clearTable();
      setSessionNotice(reason === "removed"
        ? "L’hôte t’a retiré de la table."
        : "L’hôte a interrompu la partie.");
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("hubs:update", onHubs);
    socket.on("hub:error", onHubError);
    socket.on("hub:ended", onHubEnded);
    socket.on("hub:created", acceptMembership);
    socket.on("hub:joined", acceptMembership);
    window.addEventListener("online", connectToServer);
    window.addEventListener("offline", disconnectFromServer);
    if (socket.connected) onConnect();
    else connectToServer();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("hubs:update", onHubs);
      socket.off("hub:error", onHubError);
      socket.off("hub:ended", onHubEnded);
      socket.off("hub:created", acceptMembership);
      socket.off("hub:joined", acceptMembership);
      window.removeEventListener("online", connectToServer);
      window.removeEventListener("offline", disconnectFromServer);
      window.clearTimeout(resumeRetry);
      disconnectFromServer();
    };
  }, [clearTable, storeHostRound, storeHub, storeReady, storeSession]);

  useEffect(() => {
    if (!networkReady || !currentHub?.hostPause || currentHub.hostId !== playerId ||
        hostRoundRef.current?.hubId !== currentHub.id) return;
    const activeIds = new Set(hostRoundRef.current.state.players.filter(({ hasLeft }) => !hasLeft).map(({ id }) => id));
    const others = currentHub.players.filter(({ id, connected, isBot }) => !isBot && connected && id !== playerId && activeIds.has(id));
    if (others.every(({ id }) => peers.connectedPeers.includes(id))) socket.emit("hub:host-ready");
  }, [currentHub, networkReady, peers.connectedPeers, playerId]);

  useEffect(() => {
    if (networkReady && currentHub && !currentHub.gameFinished && hostRound?.hubId === currentHub.id &&
        hostRound.state.result?.gameWinnerIds.length) socket.emit("hub:finish");
  }, [currentHub, hostRound, networkReady]);

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

    if (!networkReady) {
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

  function startGame(hub: Hub) {
    if (!networkReady || hostRoundRef.current?.hubId === hub.id) return;

    const state = createRound(
      hub.players.map(({ id, pseudo, isBot }) => ({ id, pseudo, isBot, totalScore: 0 })),
      hub.variants,
      hub.endThreshold
    );
    const preparedRound = { hubId: hub.id, state };
    const request: StartHubRequest = {
      hubId: hub.id,
      variants: state.variants,
      endThreshold: state.endThreshold,
      cardCounts: Object.fromEntries(
        state.players.map(({ id, cards }) => [id, cards.length])
      ),
    };

    storeHostRound(preparedRound);
    socket.emit("hub:start", request, (accepted: boolean) => {
      if (!accepted && hostRoundRef.current === preparedRound) storeHostRound(null);
    });
  }

  function leaveHub() {
    if (networkReady) socket.emit("hub:leave");
    clearTable();
  }

  const management = currentHub && networkReady && currentHub.hostId === playerId && !currentHub.gameFinished &&
    !hostRound?.state.result?.gameWinnerIds.length ? {
    members: currentHub.players,
    onRemove: (playerId: string) => socket.emit("hub:remove-guest", { hubId: currentHub.id, playerId }),
    onInterrupt: currentHub.gameStarted ? () => socket.emit("hub:interrupt", { hubId: currentHub.id }) : undefined,
  } : undefined;

  function canJoinHub(hub: Hub) {
    return networkReady && !!pseudo.trim() && (hub.status === "waiting" || hub.status === "in-progress");
  }

  const settings = (
    <button type="button" className="settings-trigger" aria-label="Paramètres du jeu" aria-haspopup="dialog"
      onClick={() => settingsDialog.current?.showModal()}>
      <Settings size={21} aria-hidden="true" />
    </button>
  );

  function renderScreen() {
    if (currentHub?.gameStarted) {
      const { memorizationDeadline } = currentHub;
      if (memorizationDeadline === undefined) {
        return (
          <main className="game-screen">
            <div className="game-actions">{settings}</div>
            <p role="status">En attente de la distribution des cartes…</p>
          </main>
        );
      }

      return (
        <RoundScreen
          key={currentHub.id}
          hubId={currentHub.id}
          hostId={currentHub.hostId}
          playerId={playerId ?? ""}
          deadline={memorizationDeadline}
          members={currentHub.players}
          gameFinished={currentHub.gameFinished}
          hostRound={hostRound?.hubId === currentHub.id ? hostRound.state : null}
          peers={peers}
          updateHostRound={updateHostRound}
          onLeave={leaveHub}
          settings={settings}
          playSound={playSound}
          clockVersion={currentHub.clockVersion}
          pause={currentHub.hostPause
            ? { reason: "host", deadline: currentHub.pauseDeadline }
            : !networkReady ? { reason: "local" } : null}
          canLeave={networkReady}
        />
      );
    }

    const isHost = currentHub?.hostId === playerId;
    const previewHub = hubs.find(({ id }) => id === previewHubId);
    return (
      <main className="home-page">
        <header className="top-bar">
          <div className="brand"><Spade size={24} aria-hidden="true" /> <span>FicoDutch</span></div>
          <div className="header-actions">
            <span className="version">Version {GAME_CONFIG.version}</span>
            {settings}
          </div>
        </header>
        <div className="home-content">
          {currentHub ? (
            <HubLobby key={currentHub.id} hub={currentHub} connected={networkReady} awaitingPeers={awaitingPeers}
              usingRelay={peers.relayedPeers.length > 0} isHost={isHost}
              canStart={networkReady && !awaitingPeers && currentHub.players.length >= GAME_CONFIG.players.min &&
                hostRound?.hubId !== currentHub.id}
              onStart={() => startGame(currentHub)} onLeave={leaveHub}
              onAddBot={() => socket.emit("hub:add-bot", { hubId: currentHub.id })}
              onUpdate={(variants, endThreshold) => socket.emit("hub:update-settings", { variants, endThreshold })} />
          ) : (
            <div className="home-panel home-entry">
              {previewHub && <HubPreview key={previewHub.id} hub={previewHub} canJoin={canJoinHub(previewHub)}
                onClose={() => setPreviewHubId(null)} onJoin={() => joinHub(previewHub.id)} />}
              <form className="home-create" onSubmit={(event) => {
                event.preventDefault();
                createHub();
              }}>
                {sessionNotice && <p className="home-notice" role="status">{sessionNotice}</p>}
                <input id="pseudo" type="text" aria-label="Pseudo" placeholder="Pseudo"
                  value={pseudo} maxLength={GAME_CONFIG.player.pseudoMaxLength}
                  onChange={(event) => savePseudo(event.target.value)} />
                <button className="primary-button" type="submit">
                  <Plus size={19} aria-hidden="true" /> Créer un Hub
                </button>
              </form>
              <section className="home-join" aria-labelledby="join-title">
                <h2 id="join-title">Rejoindre une partie</h2>
                <div className="hub-list">
                  {hubs.length === 0 ? (
                    <p className="empty-hubs">Aucun Hub disponible.</p>
                  ) : hubs.map((hub) => (
                    <div className="hub-item" key={hub.id}>
                      <div className="hub-info">
                        <strong>{hub.name}</strong>
                        <span>{hub.players.length}/{hub.maxPlayers} joueurs · <span>{hubStatusLabels[hub.status]}</span></span>
                      </div>
                      <div className="hub-actions">
                        <button type="button" className="preview-button" aria-label={`Aperçu du ${hub.name}`}
                          onClick={() => setPreviewHubId(hub.id)}>Aperçu</button>
                        <button type="button" className="join-button" disabled={!canJoinHub(hub)}
                          onClick={() => joinHub(hub.id)}>Rejoindre</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <>
      {renderScreen()}
      <GameSettings dialog={settingsDialog} sound={sound} toggleSound={toggleSound} management={management} />
    </>
  );
}

export default App;
