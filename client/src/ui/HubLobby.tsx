import { useEffect, useId, useRef, useState } from "react";
import { Ban, Check, Crown, Search, X } from "lucide-react";
import type { Hub } from "../../../shared/hubTypes";
import { VARIANT_LABELS } from "../game/variants";
import LobbyChat from "./LobbyChat";
import HubName from "./HubName";
import PlayerAvatar from "./PlayerAvatar";

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

function AdmissionQueue({ requests, connected, onDecision }: {
  requests: NonNullable<Hub["joinRequests"]>;
  connected: boolean;
  onDecision: Props["onDecision"];
}) {
  const [search, setSearch] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const query = search.trim().toLocaleLowerCase("fr");
  const matches = requests.filter(({ pseudo }) => pseudo.toLocaleLowerCase("fr").includes(query));

  return (
    <section className="lobby-admission" aria-label="File d’attente">
      <div className="admission-heading">
        <h2>Demandes ({requests.length})</h2>
        {(requests.length > 10 || search) && <div className="admission-search">
          <Search size={14} aria-hidden="true" />
          <input type="search" aria-label="Rechercher un pseudo" placeholder="Rechercher un pseudo"
            autoComplete="off" value={search} onChange={(event) => {
              setSearch(event.target.value);
              if (list.current) list.current.scrollTop = 0;
            }} />
        </div>}
      </div>
      {matches.length ? <ul className="admission-queue" ref={list} aria-label="Demandes d’admission" tabIndex={0}>
        {matches.map(({ id, pseudo }) => <li key={id}>
          <strong title={pseudo}>{pseudo}</strong>
          <button className="admission-accept" type="button" disabled={!connected} aria-label={`Accepter ${pseudo}`}
            title={`Accepter ${pseudo}`} onClick={() => onDecision(id, true)}><Check size={16} aria-hidden="true" /></button>
          <button className="admission-reject" type="button" disabled={!connected} aria-label={`Refuser ${pseudo}`}
            title={`Refuser ${pseudo}`} onClick={() => onDecision(id, false)}><X size={16} aria-hidden="true" /></button>
        </li>)}
      </ul> : <p className="admission-empty">{query ? "Aucun pseudo trouvé." : "Aucune demande."}</p>}
    </section>
  );
}

export default function HubLobby({ hub, connected, awaitingPeers, usingRelay, isHost, canStart,
  onStart, onAddBot, onLeave, onUpdate, onRemove, onDecision }: Props) {
  const thresholdId = useId();
  const points = hub.endThreshold === null ? "Sans limite" : `${hub.endThreshold} points`;
  const managesAdmission = isHost && hub.isPrivate;
  return (
    <section className={`home-panel lobby-panel${managesAdmission ? " private-lobby" : ""}`} aria-labelledby="lobby-title">
      <header className="lobby-heading">
        <div className="lobby-title-row">
          <label className="private-setting">
            <input type="checkbox" checked={!!hub.isPrivate} disabled={!isHost || !connected}
              onChange={(event) => onUpdate(hub.variants, hub.endThreshold, event.target.checked)} />
            Hub Privé
          </label>
          <h1 id="lobby-title"><HubName hub={hub} /></h1>
        </div>
        <div className="lobby-meta">
          <p>Salle d'attente</p>
          <p>{hub.players.length}/{hub.maxPlayers} joueurs</p>
        </div>
      </header>
      <fieldset className="hub-settings" aria-label="Paramètres de la partie" disabled={!isHost || !connected}>
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
                  {isHost && !player.isHost && <button className="lobby-remove" type="button" disabled={!connected}
                    aria-label={`Retirer ${player.pseudo}`} title={`Retirer ${player.pseudo}`} onClick={() => onRemove(player.id)}>
                    <Ban size={15} aria-hidden="true" />
                  </button>}
                  {player.isBot ? <span className="player-bot" role="img" aria-label="Bot">
                    <PlayerAvatar id={player.accountId ?? player.id} name={player.pseudo} style={player.avatarStyle} isBot mini />
                  </span>
                    : <span className="player-connection" data-connected={player.connected} role="img"
                      aria-label={status} title={status} />}
                  <strong>{player.pseudo}</strong>
                  {player.rating !== undefined && <small className="lobby-rn">RN {Math.round(player.rating)}</small>}
                  {player.isHost && <Crown className="player-host" size={14} role="img" aria-label="Hôte"><title>Hôte</title></Crown>}
                </li>
              );
            })}
          </ul>
        </div>
        {managesAdmission && <AdmissionQueue requests={hub.joinRequests ?? []} connected={connected} onDecision={onDecision} />}
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
