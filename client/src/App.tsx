
import { useState, useEffect, useCallback, useRef } from "react";
import { GAME_CONFIG, hubStatusLabels } from "./config/gameConfig";
import { Plus, Settings } from "lucide-react";
import "./App.css";
import { socket, connectToServer, disconnectFromServer } from "./network/socket";
import { useHubPeers } from "./network/useHubPeers";
import { useHostTransfer } from "./network/useHostTransfer";
import { readHubSession, saveHubSession } from "./network/hubSession";
import type { Hub, HubEnd, HubMembership, HubSession, RestartHubRequest, StartHubRequest } from "../../shared/hubTypes";
import { createRound } from "./game/createRound";
import { resumeGameClock } from "./game/gameClock";
import { applyDepartures } from "./game/turn";
import type { UpdateHostRound } from "./game/useRoundTurn";
import GameSettings from "./ui/GameSettings";
import HubLobby from "./ui/HubLobby";
import HubPreview from "./ui/HubPreview";
import RoundScreen from "./ui/RoundScreen";
import { useGameAudio } from "./ui/useCardFeedback";
import AccountScreen from "./ui/AccountScreen";
import { DemoBots, MatchArchive, PlayersDirectory, PublicProfile, RatingPodium, RecentMatches } from "./ui/MatchArchive";
import { guestMatchToken, matchPath, readAccount, readMatch, rememberGuestMatch, tableSummaryPath, type AccountSession } from "./network/accountApi";
import { completedRoundsAfter, logDeal, logMatch } from "./game/matchJournal";
import type { HostRound } from "./game/roundBackup";
import { matchStatistics } from "./game/matchStatistics";

type CurrentHub = Hub & { memorizationDeadline?: number; pauseDeadline?: number };

function prepareGame(hub: Hub) {
  const state = createRound(hub.players.map(({ id, pseudo, accountId, isBot }) => ({ id, pseudo, accountId, isBot, totalScore: 0 })),
    hub.variants, hub.endThreshold);
  return hub.tracked
    ? logDeal({ ...state, matchId: `${hub.id}:${hub.gameNumber}` }, performance.now()) : state;
}

function matchClosure(round: HostRound, hub: Hub, status: "finished" | "interrupted") {
  const { state, previousGames } = round;
  const journal = logMatch(state, performance.now(), { kind: "match-end", status }).journal;
  return {
    report: matchStatistics(journal, status),
    rounds: completedRoundsAfter(state.journal, hub.roundRating?.number ?? 0),
    ...(previousGames?.length && { table: matchStatistics(journal, "interrupted", false, previousGames) }),
  };
}

function routeId(path: string, prefix: string) {
  if (!path.startsWith(prefix)) return undefined;
  try { return decodeURIComponent(path.slice(prefix.length)); }
  catch { return undefined; }
}

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
  const [restarting, setRestarting] = useState(false);
  const [accountSession, setAccountSession] = useState<AccountSession>();
  const [path, setPath] = useState(() => window.location.pathname);
  const pathRef = useRef(path);
  const sealed = useRef<string>(null);
  const hubRef = useRef<CurrentHub | null>(null);
  const sessionRef = useRef(session);
  const readyRef = useRef(false);
  const hostRoundRef = useRef<HostRound | null>(null);
  const pausedAt = useRef<number | null>(null);
  const leaving = useRef(false);
  const playerId = session?.playerId;
  const account = accountSession?.account ?? null;
  const peers = useHubPeers(currentHub, playerId, networkReady);
  const awaitingPeers = !!currentHub && !currentHub.gameStarted &&
    currentHub.players.some(({ id, isBot }) => !isBot && id !== currentHub.hostId && (playerId === currentHub.hostId
      ? !peers.connectedPeers.includes(id) : !peers.hostConnected));

  const navigate = useCallback((destination: string) => {
    if (destination === pathRef.current) return;
    window.history.pushState({ ficoDutch: true, previous: pathRef.current }, "", destination);
    pathRef.current = destination;
    setPath(destination);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if ((pathRef.current === "/compte" || pathRef.current === "/mes-stats") && !window.history.state?.ficoDutch) {
      const destination = window.location.href;
      window.history.replaceState({ ficoDutch: true }, "", "/");
      window.history.pushState({ ficoDutch: true, previous: "/" }, "", destination);
    }
    const onHistory = () => {
      pathRef.current = window.location.pathname;
      setPath(pathRef.current);
    };
    const onAndroidBack = (event: Event) => {
      event.preventDefault();
      if (pathRef.current === "/") return;
      if (window.history.state?.previous) window.history.back();
      else {
        window.history.replaceState({ ficoDutch: true }, "", "/");
        onHistory();
      }
    };
    const load = () => void readAccount(controller.signal).then(setAccountSession, () => {
      if (!controller.signal.aborted) setSessionNotice("Impossible de vérifier la connexion au compte. Réessaie.");
    });
    load();
    window.addEventListener("online", load);
    window.addEventListener("popstate", onHistory);
    window.addEventListener("ficodutch:back", onAndroidBack);
    return () => {
      controller.abort();
      window.removeEventListener("online", load);
      window.removeEventListener("popstate", onHistory);
      window.removeEventListener("ficodutch:back", onAndroidBack);
    };
  }, []);

  function changeAccount(next: AccountSession) {
    setAccountSession(next);
    if (account?.id === next.account?.id) return;
    setNetworkReady(false);
    socket.disconnect().connect();
  }

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
    sealed.current = null;
    storeHub(null);
    storeSession(null);
    storeHostRound(null);
    pausedAt.current = null;
    leaving.current = false;
  }, [storeHub, storeHostRound, storeSession]);

  const updateHostRound = useCallback<UpdateHostRound>((hubId, update) => {
    const current = hostRoundRef.current;
    const hub = hubRef.current;
    if (current?.hubId !== hubId || hub?.id !== hubId || current.gameNumber !== hub.gameNumber || !readyRef.current || leaving.current ||
        pausedAt.current !== null || !socket.connected || sealed.current === current.state.matchId) return;
    const state = update(current.state, hub.players);
    if (state !== current.state) storeHostRound({ ...current, state });
  }, [storeHostRound]);

  const restorePromotion = useCallback((round: HostRound) => {
    const hub = hubRef.current;
    if (!hub?.hostPause || hub.id !== round.hubId || hub.gameNumber !== round.gameNumber ||
        hub.hostId !== sessionRef.current?.playerId || hostRoundRef.current?.hubId === hub.id) return;
    const now = performance.now();
    pausedAt.current = now;
    const setup = round.state.phase === "memorization" && round.state.phaseDeadline === null && hub.memorizationDeadline !== undefined
      ? { ...round.state, phase: "dealing" as const, phaseDeadline: hub.memorizationDeadline - GAME_CONFIG.round.memorizationMs }
      : round.state;
    const state = applyDepartures(setup, new Set(hub.players.map(({ id }) => id)), now);
    storeHostRound({ ...round, state });
  }, [storeHostRound]);
  const createBackup = useHostTransfer(currentHub, playerId, hostRound, networkReady, peers, restorePromotion);

  useEffect(() => {
    let resumeRetry: number | undefined;

    function recoverMatch(saved: HubSession | null) {
      if (!saved?.matchId) return;
      void readMatch(saved.matchId).then((match) => {
        if (match.status === "interrupted" && !sessionRef.current && pathRef.current === "/") {
          navigate(tableSummaryPath(match.id));
        }
      }, () => {});
    }

    function applyHub(update: Hub, serverTime: number) {
      const receivedAt = performance.now();
      const previous = hubRef.current?.id === update.id ? hubRef.current : null;
      let memorizationDeadline = previous?.gameNumber === update.gameNumber ? previous.memorizationDeadline : undefined;
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
        let previousGames = round.previousGames;
        if (update.gameNumber > round.gameNumber) {
          if (state.journal) previousGames = [...(previousGames ?? []), state.journal];
          state = { ...prepareGame(update), phase: "dealing", phaseDeadline: receivedAt + GAME_CONFIG.round.dealingMs };
          pausedAt.current = null;
        } else if (state.roundNumber === 1 && state.phase === "memorization" &&
            state.phaseDeadline === null && memorizationDeadline !== undefined) {
          state = { ...state, phase: "dealing", phaseDeadline: memorizationDeadline - GAME_CONFIG.round.memorizationMs };
        }
        if (update.hostPause) {
          pausedAt.current ??= receivedAt;
        } else if (pausedAt.current !== null && readyRef.current) {
          state = resumeGameClock(state, receivedAt - pausedAt.current);
          pausedAt.current = null;
        }

        const presentIds = new Set(update.players.map(({ id }) => id));
        state = applyDepartures(state, presentIds, pausedAt.current ?? receivedAt);
        if (state !== round.state) storeHostRound({ ...round, gameNumber: update.gameNumber, state, previousGames });
      }
      storeHub({ ...update, memorizationDeadline, pauseDeadline });
      const saved = sessionRef.current;
      if (saved?.hubId === update.id && saved.isHost !== (saved.playerId === update.hostId)) {
        storeSession({ ...saved, isHost: saved.playerId === update.hostId });
      }
    }

    function acceptMembership({ hub, session }: HubMembership, serverTime: number) {
      const match = hub.gameStarted && hub.tracked ? `${hub.id}:${hub.gameNumber}` : undefined;
      if (match && !hub.players.find(({ id }) => id === session.playerId)?.accountId) rememberGuestMatch(match, session.token);
      storeSession({ ...session, matchId: match });
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
            recoverMatch(saved);
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
        const saved = sessionRef.current;
        clearTable();
        if (socket.connected) storeReady(true);
        if (!update) recoverMatch(saved);
        if (current.gameStarted) setSessionNotice(update && update.hostId !== current.hostId
          ? `${update.hostPseudo} a repris la table.`
          : current.hostPause ? "La partie est terminée. L’hôte n’est pas revenu à temps." : "Le Hub de la partie a été fermé.");
        return;
      }
      applyHub(update, serverTime);
      if (update.gameStarted && sessionRef.current && update.tracked) {
        const id = `${update.id}:${update.gameNumber}`;
        if (!update.players.find(({ id: seat }) => seat === sessionRef.current?.playerId)?.accountId) {
          rememberGuestMatch(id, sessionRef.current.token);
        }
        if (sessionRef.current.matchId !== id) storeSession({ ...sessionRef.current, matchId: id });
      }
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

    function onHubEnded({ hubId, reason, matchId, tableSummary }: HubEnd) {
      if (sessionRef.current?.hubId !== hubId) return;
      const saved = sessionRef.current;
      const guest = !hubRef.current?.players.find(({ id }) => id === saved.playerId)?.accountId;
      clearTable();
      if (matchId) {
        if (guest) rememberGuestMatch(matchId, saved.token);
        navigate(tableSummary ? tableSummaryPath(matchId) : matchPath(matchId));
        setSessionNotice(null);
        return;
      }
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
  }, [clearTable, navigate, storeHostRound, storeHub, storeReady, storeSession]);

  useEffect(() => {
    if (!networkReady || !currentHub?.hostPause || currentHub.hostId !== playerId ||
        hostRoundRef.current?.hubId !== currentHub.id) return;
    const activeIds = new Set(hostRoundRef.current.state.players.filter(({ hasLeft }) => !hasLeft).map(({ id }) => id));
    const others = currentHub.players.filter(({ id, connected, isBot }) => !isBot && connected && id !== playerId && activeIds.has(id));
    if (others.every(({ id }) => peers.connectedPeers.includes(id))) socket.emit("hub:host-ready");
  }, [currentHub, hostRound?.hubId, networkReady, peers.connectedPeers, playerId]);

  const publishMatch = useCallback((status: "finished" | "interrupted") => {
    const hub = hubRef.current;
    const round = hostRoundRef.current;
    const state = round?.state;
    const id = state?.matchId;
    if (!hub || !round || !state || !id || round.hubId !== hub.id || round.gameNumber !== hub.gameNumber ||
        !readyRef.current || !socket.connected || sealed.current === id) return;
    sealed.current = id;
    socket.timeout(8_000).emit(status === "finished" ? "hub:finish" : "hub:interrupt", {
      hubId: hub.id, gameNumber: hub.gameNumber, ...matchClosure(round, hub, status),
    }, (error: Error | null, accepted?: boolean) => {
      if (sealed.current === id) sealed.current = null;
      if (status === "interrupted" && (error || !accepted) && hubRef.current?.id === hub.id) {
        window.alert("Le bilan n’a pas pu être enregistré. Réessaie d’interrompre la partie.");
      }
    });
  }, []);

  const roundNumber = hostRound?.state.roundNumber;
  const roundPhase = hostRound?.state.phase;
  const pendingRatingMatch = hostRound?.state.matchId;
  useEffect(() => {
    if (!networkReady || !pendingRatingMatch) return;
    let sending = false;
    function saveRounds() {
      const hub = hubRef.current;
      const round = hostRoundRef.current;
      if (sending || !hub || !round || hub.hostPause || round.state.matchId !== pendingRatingMatch ||
          pendingRatingMatch !== `${hub.id}:${hub.gameNumber}` || sealed.current === pendingRatingMatch) return;
      const rounds = completedRoundsAfter(round.state.journal, hub.roundRating?.number ?? 0);
      if (!rounds.length) return;
      sending = true;
      socket.timeout(6_000).emit("hub:rate-rounds", { hubId: hub.id, gameNumber: hub.gameNumber, rounds },
        () => { sending = false; });
    }
    saveRounds();
    const retry = window.setInterval(saveRounds, 5_000);
    return () => window.clearInterval(retry);
  }, [networkReady, pendingRatingMatch, roundNumber, roundPhase]);

  useEffect(() => {
    if (!networkReady || !currentHub || currentHub.gameFinished || hostRound?.hubId !== currentHub.id ||
        hostRound.gameNumber !== currentHub.gameNumber || !hostRound.state.result?.gameWinnerIds.length) return;
    if (!hostRound.state.journal) {
      socket.emit("hub:finish", currentHub.gameNumber);
      return;
    }
    publishMatch("finished");
    const retry = window.setInterval(() => publishMatch("finished"), 5_000);
    return () => window.clearInterval(retry);
  }, [currentHub, hostRound, networkReady, publishMatch]);

  const trackedGame = hostRound?.state.matchId;
  const checkpointActive = networkReady && !!currentHub?.gameStarted && !currentHub.gameFinished;
  useEffect(() => {
    if (!trackedGame || !checkpointActive) return;
    let sentSequence = 0;
    function checkpoint() {
      const round = hostRoundRef.current;
      const journal = round?.state.journal;
      if (!round || round.state.matchId !== trackedGame || !journal || sentSequence >= journal.entry.sequence ||
          sealed.current === trackedGame || !socket.connected) return;
      const sequence = journal.entry.sequence;
      socket.timeout(6_000).emit("hub:checkpoint", {
        hubId: round.hubId, gameNumber: round.gameNumber, sequence, report: matchStatistics(journal, "interrupted", true),
        ...(round.previousGames?.length && { table: matchStatistics(journal, "interrupted", true, round.previousGames) }),
      }, (error: Error | null, accepted?: boolean) => {
        if (!error && accepted) sentSequence = Math.max(sentSequence, sequence);
      });
    }
    checkpoint();
    const interval = window.setInterval(checkpoint, 20_000);
    return () => window.clearInterval(interval);
  }, [trackedGame, checkpointActive]);

  function savePseudo(value: string) {
    setPseudo(value);
    localStorage.setItem("ficodutch-pseudo", value);
  }

  function createHub() {
    const cleanPseudo = (account?.name ?? pseudo).trim();

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
    const cleanPseudo = (account?.name ?? pseudo).trim();

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

  async function startGame(hub: Hub) {
    if (!networkReady || hostRoundRef.current?.hubId === hub.id) return;

    const state = prepareGame(hub);
    const preparedRound = { hubId: hub.id, gameNumber: hub.gameNumber, state };
    storeHostRound(preparedRound);
    const backup = hub.players.some(({ id, isBot }) => id !== hub.hostId && !isBot)
      ? await createBackup(preparedRound).catch(() => undefined) : undefined;
    if (hostRoundRef.current !== preparedRound || !socket.connected) {
      if (hostRoundRef.current === preparedRound) storeHostRound(null);
      return;
    }
    const request: StartHubRequest = {
      hubId: hub.id,
      variants: state.variants,
      endThreshold: state.endThreshold,
      backup,
      cardCounts: Object.fromEntries(
        state.players.map(({ id, cards }) => [id, cards.length])
      ),
    };

    socket.emit("hub:start", request, (accepted: boolean) => {
      if (!accepted && hostRoundRef.current === preparedRound) storeHostRound(null);
    });
  }

  function restartGame() {
    const hub = hubRef.current;
    const round = hostRoundRef.current;
    const result = round?.state.result;
    if (restarting || !readyRef.current || !hub?.gameFinished || hub.hostPause ||
        round?.hubId !== hub.id || round.gameNumber !== hub.gameNumber || !result?.gameWinnerIds.length) return;

    const request: RestartHubRequest = { hubId: hub.id, gameNumber: hub.gameNumber, variants: result.nextVariants };
    setRestarting(true);
    socket.timeout(5_000).emit("hub:restart", request, () => setRestarting(false));
  }

  async function leaveHub() {
    const hub = hubRef.current;
    const round = hostRoundRef.current;
    if (leaving.current) return;
    if (networkReady && hub?.gameStarted && !hub.gameFinished && hub.hostId === playerId) {
      leaving.current = true;
      const backup = round && hub.players.some(({ id, connected, isBot }) => id !== playerId && connected && !isBot)
        ? await createBackup(round).catch(() => undefined) : undefined;
      if (!socket.connected || hubRef.current?.id !== hub.id) {
        leaving.current = false;
        return;
      }
      socket.timeout(8_000).emit("hub:leave", {
        backup,
        ...(round?.state.journal && matchClosure(round, hub, "interrupted")),
      }, (error: Error | null, accepted?: boolean) => {
        leaving.current = false;
        if (hubRef.current?.id !== hub.id) return;
        if (accepted && !error) clearTable();
        else window.alert("La reprise n’est pas encore prête. Réessaie dans un instant.");
      });
      return;
    }
    if (networkReady) socket.emit("hub:leave");
    clearTable();
  }

  const interrupt = currentHub?.gameStarted && networkReady && currentHub.hostId === playerId
    ? () => hostRound?.state.journal ? publishMatch("interrupted") : socket.emit("hub:interrupt", { hubId: currentHub.id }) : undefined;
  const management = currentHub && networkReady && currentHub.hostId === playerId && !currentHub.gameFinished &&
    !hostRound?.state.result?.gameWinnerIds.length ? {
    members: currentHub.players,
    onRemove: (playerId: string) => socket.emit("hub:remove-guest", { hubId: currentHub.id, playerId }),
    onInterrupt: interrupt,
  } : undefined;

  function canJoinHub(hub: Hub) {
    return networkReady && (!!account || !!pseudo.trim()) &&
      (hub.status === "waiting" || hub.status === "in-progress");
  }

  const settings = (
    <button type="button" className="settings-trigger" aria-label="Paramètres du jeu" aria-haspopup="dialog"
      onClick={() => settingsDialog.current?.showModal()}>
      <Settings size={21} aria-hidden="true" />
    </button>
  );

  function renderScreen() {
    const tableMatch = routeId(path, "/bilans/");
    const match = tableMatch ?? routeId(path, "/parties/");
    const profile = routeId(path, "/joueurs/");
    const archiveProps = {
      navigate, backToTable: !!currentHub,
      ...(currentHub?.gameFinished && { leaveTable: () => { leaveHub(); navigate("/"); } }),
    };
    if (profile) return <PublicProfile key={profile} id={profile} canReport={!!account && account.id !== profile} {...archiveProps} />;
    if (path === "/joueurs") return <PlayersDirectory {...archiveProps} />;
    if (path === "/bots") return <DemoBots {...archiveProps} />;
    if (path === "/mes-stats" && account) return <PublicProfile key={account.id} id={account.id} personal {...archiveProps} />;
    if (path === "/compte" || (accountSession?.enabled && !account && ((match && !guestMatchToken(match)) || path === "/mes-parties" || path === "/mes-stats"))) {
      return <AccountScreen account={account} onChange={changeAccount} navigate={navigate} forStats={path === "/mes-stats"} />;
    }
    if (match && accountSession) return <MatchArchive key={path} id={match} tableSummary={!!tableMatch} {...archiveProps} />;
    if (path === "/mes-parties" && accountSession) return <RecentMatches {...archiveProps} />;
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
          key={`${currentHub.id}:${currentHub.gameNumber}`}
          hubId={currentHub.id}
          hostId={currentHub.hostId}
          playerId={playerId ?? ""}
          deadline={memorizationDeadline}
          members={currentHub.players}
          gameFinished={currentHub.gameFinished}
          hostRound={hostRound?.hubId === currentHub.id && hostRound.gameNumber === currentHub.gameNumber ? hostRound.state : null}
          peers={peers}
          updateHostRound={updateHostRound}
          onLeave={leaveHub}
          onRestart={restartGame}
          onInterrupt={interrupt}
          restarting={restarting}
          settings={settings}
          playSound={playSound}
          clockVersion={currentHub.clockVersion}
          pause={currentHub.hostPause
            ? { reason: currentHub.hostPause.transfer ? "transfer" : "host", deadline: currentHub.pauseDeadline }
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
          <div className="brand"><img src="/ficodutch-logo.png" alt="" width="30" height="20" /> <span>FicoDutch</span></div>
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
            <div className="home-entry-layout">
              <div className="home-panel home-entry">
                {previewHub && <HubPreview key={previewHub.id} hub={previewHub} canJoin={canJoinHub(previewHub)}
                  onClose={() => setPreviewHubId(null)} onJoin={() => joinHub(previewHub.id)} />}
                <form className="home-create" onSubmit={(event) => {
                  event.preventDefault();
                  createHub();
                }}>
                  {sessionNotice && <p className="home-notice" role="status">{sessionNotice}</p>}
                  {accountSession && !account ? <label className="guest-entry">
                    Jouer sans compte
                    <input id="pseudo" type="text" aria-label="Pseudo" placeholder="Pseudo"
                      value={pseudo} maxLength={GAME_CONFIG.player.pseudoMaxLength}
                      onChange={(event) => savePseudo(event.target.value)} />
                  </label> : !accountSession ? <button type="button" onClick={() => {
                    void readAccount().then(setAccountSession, () => setSessionNotice("La connexion au compte est indisponible."));
                  }}>Vérifier la connexion</button> : <strong>{account?.name}</strong>}
                  <button className="primary-button" type="submit" disabled={!accountSession}>
                    <Plus size={19} aria-hidden="true" /> Créer un Hub
                  </button>
                  {accountSession?.enabled && !account && <div className="account-links">
                    <a href="/compte" onClick={(event) => { event.preventDefault(); navigate("/compte"); }}>Se connecter ou créer un compte</a>
                  </div>}
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
              {accountSession?.enabled && <>
                <nav className="home-stats" aria-label="Statistiques">
                  <button type="button" onClick={() => navigate("/mes-stats")}>Mes stats</button>
                  <button type="button" onClick={() => navigate("/joueurs")}>Classement</button>
                </nav>
                <RatingPodium navigate={navigate} />
              </>}
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <>
      {renderScreen()}
      <GameSettings dialog={settingsDialog} sound={sound} toggleSound={toggleSound} management={management}
        onLeave={currentHub?.gameStarted && !currentHub.gameFinished && networkReady ? leaveHub : undefined}
        onAccount={accountSession?.enabled ? () => navigate("/compte") : undefined} />
    </>
  );
}

export default App;
