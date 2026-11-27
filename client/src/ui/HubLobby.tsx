import { useEffect, useId, useRef, useState } from "react";
import { Check, Crown, Search, UserRound, WifiOff, X } from "lucide-react";
import type { Hub } from "../../../shared/hubTypes";
import { VARIANT_LABELS } from "../game/variants";
import LobbyChat from "./LobbyChat";
import PlayerAvatar from "./PlayerAvatar";
import RatingBadge from "./RatingBadge";

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
  onUpdate: (variants: Hub["variants"], endThreshold: Hub["endThreshold"], access?: {
    isPrivate?: boolean; isFriendsOnly?: boolean; extraBotDiscardDelay?: boolean;
  }) => void;
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
  const playerActionsTitle = useId();
  const playerActions = useRef<HTMLDialogElement>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>();
  const selectedPlayer = isHost
    ? hub.players.find((player) => player.id === selectedPlayerId && !player.isHost)
    : undefined;
  const points = hub.endThreshold === null ? "Sans limite" : `${hub.endThreshold} points`;
  const managesAdmission = isHost && hub.isPrivate;
  const hostHasAccount = !!hub.players.find((player) => player.isHost)?.accountId;

  useEffect(() => {
    const dialog = playerActions.current;
    if (selectedPlayer && dialog && !dialog.open) dialog.showModal();
    if (!selectedPlayer && dialog?.open) dialog.close();
  }, [selectedPlayer]);

  useEffect(() => {
    const closePlayerActions = () => playerActions.current?.close();
    window.addEventListener("ficodutch:back", closePlayerActions);
    return () => window.removeEventListener("ficodutch:back", closePlayerActions);
  }, []);

  return (
    <section className={`home-panel lobby-panel${managesAdmission ? " private-lobby" : ""}`} aria-labelledby="lobby-title">
      <header className="lobby-heading">
        <div className="lobby-title-row">
          <h1 id="lobby-title">{hub.name}</h1>
          <div className="lobby-access" role="group" aria-label="Options du Hub">
            <label className="lobby-access-setting">
              <input type="checkbox" checked={!!hub.isPrivate} disabled={!isHost || !connected}
                onChange={(event) => onUpdate(hub.variants, hub.endThreshold, { isPrivate: event.target.checked })} />
              Hub Privé
            </label>
            <label className="lobby-access-setting" title={isHost && !hostHasAccount
              ? "Connecte-toi à un compte pour créer un Hub Amis." : undefined}>
              <input type="checkbox" checked={!!hub.isFriendsOnly}
                disabled={!isHost || !connected || !hostHasAccount}
                onChange={(event) => onUpdate(hub.variants, hub.endThreshold, { isFriendsOnly: event.target.checked })} />
              Hub Amis
            </label>
            <label className="lobby-access-setting" title="Ajoute une seconde avant la défausse des bots à leur tour.">
              <input type="checkbox" checked={!!hub.extraBotDiscardDelay} disabled={!isHost || !connected}
                onChange={(event) => onUpdate(hub.variants, hub.endThreshold, { extraBotDiscardDelay: event.target.checked })} />
              Bot +1s
            </label>
          </div>
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
              const status = player.isBot ? "Bot" : player.connected ? "Connecté" : "Déconnecté";
              return (
                <li key={player.id}>
                  <span className="lobby-player-avatar" role="img"
                    aria-label={status} title={status}>
                    {!player.connected ? <WifiOff className="lobby-disconnected" size={22} aria-hidden="true" />
                      : player.accountId || player.isBot
                      ? <PlayerAvatar id={player.accountId ?? player.id} name={player.pseudo}
                        style={player.avatarStyle} photoId={player.avatarPhotoId} isBot={player.isBot} mini />
                      : <UserRound className="lobby-guest-icon" size={22} aria-hidden="true" />}
                  </span>
                  {isHost && !player.isHost
                    ? <button className="lobby-player-name" type="button" title={player.pseudo}
                      aria-haspopup="dialog" disabled={!connected}
                      onClick={() => setSelectedPlayerId(player.id)}>{player.pseudo}</button>
                    : <strong title={player.pseudo}>{player.pseudo}</strong>}
                  {player.isHost && <Crown className="player-host" size={14} role="img" aria-label="Hôte"><title>Hôte</title></Crown>}
                  {player.connected && player.rating !== undefined && <RatingBadge className="lobby-rn" rating={player.rating} />}
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
        <div className="lobby-actions">
          {isHost && <button type="button" onClick={onAddBot} disabled={!connected || hub.players.length >= hub.maxPlayers}>
            Ajouter un bot
          </button>}
          {isHost && <button type="button" className="start-game-button" disabled={!canStart} onClick={onStart}>
            Lancer la partie
          </button>}
          <button type="button" className="lobby-leave" onClick={onLeave}>Annuler</button>
        </div>
      </footer>
      <dialog className="hub-management lobby-player-actions" ref={playerActions} aria-labelledby={playerActionsTitle}
        onClose={() => setSelectedPlayerId(undefined)}>
        <h2 id={playerActionsTitle}>{selectedPlayer?.pseudo}</h2>
        <div className="hub-management-actions">
          <button type="button" autoFocus onClick={() => playerActions.current?.close()}>Annuler</button>
          <button type="button" className="hub-danger" disabled={!connected || !selectedPlayer} onClick={() => {
            if (!selectedPlayer) return;
            playerActions.current?.close();
            onRemove(selectedPlayer.id);
          }}>Éjecter du Hub</button>
        </div>
      </dialog>
    </section>
  );
}
