import { useId, useRef, useState } from "react";
import type { HubPlayer } from "../../../shared/hubTypes";

type Props = {
  members: HubPlayer[];
  onRemove: (playerId: string) => void;
  onInterrupt?: () => void;
  className?: string;
};

type Confirmation = { kind: "remove"; playerId: string } | { kind: "interrupt" };

export default function HubManagement({ members, onRemove, onInterrupt, className }: Props) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const description = useId();
  const guests = members.filter(({ isHost }) => !isHost);
  const target = confirmation?.kind === "remove"
    ? guests.find(({ id }) => id === confirmation.playerId)
    : undefined;
  const interrupting = confirmation?.kind === "interrupt";

  return (
    <>
      <button type="button" className={className} onClick={() => dialog.current?.showModal()}>
        Gérer la table
      </button>
      <dialog className="hub-management" ref={dialog} onClose={() => setConfirmation(null)}
        aria-labelledby={heading} aria-describedby={target || interrupting ? description : undefined}>
        {target || interrupting ? (
          <>
            <h2 id={heading}>{target ? `Retirer ${target.pseudo} ?` : "Interrompre la partie ?"}</h2>
            <p id={description}>{target
              ? target.isBot ? "Ce bot quittera la table." : "Ce joueur retournera à l’accueil."
              : "Le Hub sera fermé et tous les joueurs retourneront à l’accueil."}</p>
            <div className="hub-management-actions">
              <button type="button" autoFocus onClick={() => setConfirmation(null)}>Annuler</button>
              <button type="button" className="hub-danger" onClick={() => {
                dialog.current?.close();
                if (target) onRemove(target.id);
                else onInterrupt?.();
              }}>{target ? "Confirmer le retrait" : "Confirmer l’interruption"}</button>
            </div>
          </>
        ) : (
          <>
            <h2 id={heading}>Gérer la table</h2>
            {guests.length > 0 ? (
              <ul className="hub-management-list">
                {guests.map((guest) => (
                  <li key={guest.id}>
                    <span>
                      <strong>{guest.pseudo}</strong>
                      <small>{guest.isBot ? "Bot" : guest.connected ? "Connecté" : "Déconnecté"}</small>
                    </span>
                    <button type="button" onClick={() => setConfirmation({ kind: "remove", playerId: guest.id })}
                      aria-label={`Retirer ${guest.pseudo}`}>Retirer</button>
                  </li>
                ))}
              </ul>
            ) : <p>Aucun invité à cette table.</p>}
            <div className="hub-management-actions">
              <button type="button" onClick={() => dialog.current?.close()}>Fermer</button>
              {onInterrupt && <button type="button" className="hub-danger"
                onClick={() => setConfirmation({ kind: "interrupt" })}>Interrompre la partie</button>}
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
