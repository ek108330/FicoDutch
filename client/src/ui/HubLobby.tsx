import { useEffect, useState, type ReactNode } from "react";
import { MessageCircle, Users } from "lucide-react";
import type { Hub } from "../../../shared/hubTypes";
import LobbyChat from "./LobbyChat";

type Props = {
  hub: Hub;
  connected: boolean;
  awaitingPeers: boolean;
  usingRelay: boolean;
  isHost: boolean;
  canStart: boolean;
  onStart: () => void;
  onLeave: () => void;
  management: ReactNode;
};

function PlayerConnectionNotice() {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDelayed(true), 15_000);
    return () => window.clearTimeout(timer);
  }, []);
  return <p role="status">{delayed
    ? "La connexion entre les joueurs prend du temps. Garde les onglets de jeu ouverts."
    : "Connexion aux joueurs en cours…"}</p>;
}

export default function HubLobby({ hub, connected, awaitingPeers, usingRelay, isHost, canStart,
  onStart, onLeave, management }: Props) {
  const [panel, setPanel] = useState<"players" | "chat">("players");
  const showChat = panel === "chat";

  return (
    <section className="home-panel lobby-panel" aria-labelledby="lobby-title">
      <header className="lobby-heading">
        <h1 id="lobby-title">{hub.name}</h1>
        <p>Salle d'attente</p>
      </header>
      <div className="lobby-body">
        <div className="lobby-nav" role="group" aria-label="Affichage de la salle d’attente">
          <button type="button" aria-pressed={!showChat} onClick={() => setPanel("players")}>
            <Users size={17} aria-hidden="true" /> Joueurs
          </button>
          <button type="button" aria-pressed={showChat} onClick={() => setPanel("chat")}>
            <MessageCircle size={17} aria-hidden="true" /> Chat
          </button>
        </div>
        <div className="lobby-players" hidden={showChat}>
          <p className="player-count">{hub.players.length}/{hub.maxPlayers} joueurs</p>
          <ul aria-label="Joueurs présents">
            {hub.players.map((player) => (
              <li key={player.id}>
                <strong>{player.pseudo}</strong>
                {player.isHost && <span className="player-host">Hôte</span>}
                <span className="player-connection" data-connected={player.connected}>
                  {player.connected ? "Connecté" : "Déconnecté"}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <LobbyChat hubId={hub.id} connected={connected} active={showChat} />
      </div>
      <footer className="lobby-footer">
        {awaitingPeers && <PlayerConnectionNotice />}
        {!awaitingPeers && usingRelay && <p role="status">Le relais chiffré est actif.</p>}
        {!isHost && <p>En attente du lancement de la partie…</p>}
        {isHost && (
          <button type="button" className="start-game-button" disabled={!canStart} onClick={onStart}>
            Lancer la partie
          </button>
        )}
        <div className="lobby-actions">
          {management}
          <button type="button" className="lobby-leave" onClick={onLeave}>Quitter le Hub</button>
        </div>
      </footer>
    </section>
  );
}
