import { useId, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { HubPlayer } from "../../../shared/hubTypes";

export type HubManagementOptions = {
  members: HubPlayer[];
  onRemove: (playerId: string) => void;
  onInterrupt?: () => void;
};

type Props = HubManagementOptions & { titleId: string; onBack: () => void; onClose: () => void };
type Confirmation = { kind: "remove"; playerId: string } | { kind: "interrupt" };

export function InterruptConfirmation({ titleId, onCancel, onConfirm }: {
  titleId: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const description = useId();
  return (
    <section aria-labelledby={titleId} aria-describedby={description}>
      <h2 id={titleId}>Interrompre la partie ?</h2>
      <p id={description}>Le Hub sera fermé et tous les joueurs retourneront à l’accueil.</p>
      <div className="hub-management-actions">
        <button type="button" autoFocus onClick={onCancel}>Annuler</button>
        <button type="button" className="hub-danger" onClick={onConfirm}>Confirmer l’interruption</button>
      </div>
    </section>
  );
}

export default function HubManagement({ members, onRemove, onInterrupt, titleId, onBack, onClose }: Props) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const description = useId();
  const guests = members.filter(({ isHost }) => !isHost);
  const target = confirmation?.kind === "remove"
    ? guests.find(({ id }) => id === confirmation.playerId)
    : undefined;
  if (confirmation?.kind === "interrupt") return (
    <InterruptConfirmation titleId={titleId} onCancel={() => setConfirmation(null)} onConfirm={() => {
      onClose();
      onInterrupt?.();
    }} />
  );

  return (
    <>
      {target ? (
        <section aria-labelledby={titleId} aria-describedby={description}>
          <h2 id={titleId}>Retirer {target.pseudo} ?</h2>
          <p id={description}>{target.isBot ? "Ce bot quittera la table." : "Ce joueur retournera à l’accueil."}</p>
          <div className="hub-management-actions">
            <button type="button" autoFocus onClick={() => setConfirmation(null)}>Annuler</button>
            <button type="button" className="hub-danger" onClick={() => {
              onClose();
              onRemove(target.id);
            }}>Confirmer le retrait</button>
          </div>
        </section>
      ) : (
        <>
          <header className="settings-heading">
            <h2 id={titleId}>Gérer la table</h2>
            <button type="button" className="settings-close" aria-label="Retour aux paramètres" autoFocus onClick={onBack}>
              <ArrowLeft size={19} aria-hidden="true" />
            </button>
          </header>
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
            <button type="button" onClick={onClose}>Fermer</button>
            {onInterrupt && <button type="button" className="hub-danger"
              onClick={() => setConfirmation({ kind: "interrupt" })}>Interrompre la partie</button>}
          </div>
        </>
      )}
    </>
  );
}
