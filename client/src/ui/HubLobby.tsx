import { useEffect, useId, useState } from "react";
import { Ban, Bot, Crown } from "lucide-react";
import type { Hub } from "../../../shared/hubTypes";
import { VARIANT_LABELS } from "../game/variants";
import LobbyChat from "./LobbyChat";
import HubName from "./HubName";

type Props = {
  hub: Hub;
  connected: boolean;
  awaitingPeers: boolean;
  usingRelay: boolean;
  isHost: boolean;
  canStart: boolean;
  onStart: () => void;
  onAddBot: () => void;
  onLeave: () => void;
  onUpdate: (variants: Hub["variants"], endThreshold: Hub["endThreshold"], isPrivate?: boolean) => void;
  onRemove: (playerId: string) => void;
  onDecision: (requestId: string, accept: boolean) => void;
};

const thresholds = [50, 100, 200, 500, 1000, null];
const variantKeys = Object.keys(VARIANT_LABELS) as (keyof Hub["variants"])[];

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
  onStart, onAddBot, onLeave, onUpdate, onRemove, onDecision }: Props) {
  const thresholdId = useId();
  const points = hub.endThreshold === null ? "Sans limite" : `${hub.endThreshold} points`;
  return (
    <section className="home-panel lobby-panel" aria-labelledby="lobby-title">
      <header className="lobby-heading">
        <h1 id="lobby-title"><HubName hub={hub} /></h1>
        <div className="lobby-meta">
          <p>Salle d'attente</p>
          <p>{hub.players.length}/{hub.maxPlayers} joueurs</p>
        </div>
      </header>
      <fieldset className="hub-settings" aria-label="Paramètres de la partie" disabled={!isHost || !connected}>
        <label className="private-setting">
          <input type="checkbox" checked={!!hub.isPrivate}
            onChange={(event) => onUpdate(hub.variants, hub.endThreshold, event.target.checked)} />
          Hub Privé
        </label>
        <div className="threshold-setting">
          <label htmlFor={thresholdId}>Fin de partie</label>
          <input id={thresholdId} type="range" min="0" max={thresholds.length - 1}
            value={thresholds.indexOf(hub.endThreshold)} aria-valuetext={points}
            onChange={(event) => onUpdate(hub.variants, thresholds[Number(event.target.value)])} />
          <span>{points}</span>
        </div>
        <div className="variant-grid" role="group" aria-label="Variantes">
          {variantKeys.map((key) => (
            <button key={key} type="button" aria-pressed={hub.variants[key]}
              onClick={() => onUpdate({ ...hub.variants, [key]: !hub.variants[key] }, hub.endThreshold)}>
              {VARIANT_LABELS[key]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="lobby-body">
        <div className="lobby-roster">
          <ul className="lobby-players" aria-label="Joueurs présents">
            {hub.players.map((player) => {
              const status = player.connected ? "Connecté" : "Déconnecté";
              return (
                <li key={player.id}>
                  {player.isBot ? <Bot className="player-bot" size={15} role="img" aria-label="Bot" />
                    : <span className="player-connection" data-connected={player.connected} role="img"
                      aria-label={status} title={status} />}
                  <strong>{player.pseudo}</strong>
                  {isHost && !player.isHost && <button className="lobby-remove" type="button" disabled={!connected}
                    aria-label={`Retirer ${player.pseudo}`} title={`Retirer ${player.pseudo}`} onClick={() => onRemove(player.id)}>
                    <Ban size={15} aria-hidden="true" />
                  </button>}
                  {player.rating !== undefined && <small className="lobby-rn">RN {Math.round(player.rating)}</small>}
                  {player.isHost && <Crown className="player-host" size={14} role="img" aria-label="Hôte"><title>Hôte</title></Crown>}
                </li>
              );
            })}
          </ul>
          {isHost && !!hub.joinRequests?.length && <ul className="admission-queue" aria-label="Demandes d’admission">
            {hub.joinRequests.map(({ id, pseudo }) => <li key={id}>
              <strong>{pseudo}</strong>
              <button type="button" disabled={!connected} aria-label={`Accepter ${pseudo}`} onClick={() => onDecision(id, true)}>Accepter</button>
              <button type="button" disabled={!connected} aria-label={`Refuser ${pseudo}`} onClick={() => onDecision(id, false)}>Refuser</button>
            </li>)}
          </ul>}
        </div>
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
          {isHost && <button type="button" onClick={onAddBot} disabled={!connected || hub.players.length >= hub.maxPlayers}>
            Ajouter un bot
          </button>}
          <button type="button" className="lobby-leave" onClick={onLeave}>Quitter le Hub</button>
        </div>
      </footer>
    </section>
  );
}
