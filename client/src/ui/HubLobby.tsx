import { useEffect, useState, type ReactNode } from "react";
import { Crown } from "lucide-react";
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
  return (
    <section className="home-panel lobby-panel" aria-labelledby="lobby-title">
      <header className="lobby-heading">
        <h1 id="lobby-title">{hub.name}</h1>
        <div className="lobby-meta">
          <p>Salle d'attente</p>
          <p>{hub.players.length}/{hub.maxPlayers} joueurs</p>
        </div>
      </header>
      <div className="lobby-body">
        <ul className="lobby-players" aria-label="Joueurs présents">
          {hub.players.map((player) => {
            const status = player.connected ? "Connecté" : "Déconnecté";
            return (
              <li key={player.id}>
                <span className="player-connection" data-connected={player.connected} role="img"
                  aria-label={status} title={status} />
                <strong>{player.pseudo}</strong>
                {player.isHost && <Crown className="player-host" size={14} role="img" aria-label="Hôte"><title>Hôte</title></Crown>}
              </li>
            );
          })}
        </ul>
        <LobbyChat hubId={hub.id} connected={connected} />
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
