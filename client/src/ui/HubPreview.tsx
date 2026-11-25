import { useEffect, useId, useRef } from "react";
import type { Hub } from "../../../shared/hubTypes";
import { hubStatusLabels } from "../config/gameConfig";
import { VARIANT_LABELS } from "../game/variants";
import HubName from "./HubName";

type Props = { hub: Hub; canJoin: boolean; onClose: () => void; onJoin: () => void };

export default function HubPreview({ hub, canJoin, onClose, onJoin }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog className="hub-management" ref={dialog} aria-labelledby={title} onClose={onClose}>
      <h2 id={title}><HubName hub={hub} /></h2>
      <p>{hubStatusLabels[hub.status]} · {hub.players.length}/{hub.maxPlayers} joueurs</p>
      <p>{hub.endThreshold === null ? "Partie sans limite de points" : `Fin de partie à ${hub.endThreshold} points`}</p>
      <div className="variant-grid preview-variants" role="group" aria-label="Variantes">
        {Object.entries(VARIANT_LABELS).map(([key, label]) => {
          const active = hub.variants[key as keyof Hub["variants"]];
          return <span key={key} data-active={active}>
            {label}<span className="sr-only">{active ? ", activée" : ", désactivée"}</span>
          </span>;
        })}
      </div>
      <ul className="hub-management-list" aria-label="Joueurs du Hub">
        {hub.players.map((player) => (
          <li key={player.id}>
            <strong>{player.pseudo}</strong>
            {player.isHost && <span>Hôte</span>}
            {player.isBot && <span>Bot</span>}
          </li>
        ))}
      </ul>
      <div className="hub-management-actions">
        <button type="button" onClick={() => dialog.current?.close()}>Fermer</button>
        <button type="button" onClick={onJoin} disabled={!canJoin}>Rejoindre</button>
      </div>
    </dialog>
  );
}
