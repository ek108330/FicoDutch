import { useId, useState, type RefObject } from "react";
import { BookOpen, UserRound, Users, Volume2, VolumeX, X } from "lucide-react";
import HubManagement, { type HubManagementOptions } from "./HubManagement";
import Rules from "./Rules";

type Props = {
  dialog: RefObject<HTMLDialogElement | null>;
  sound: boolean;
  toggleSound: () => void;
  management?: HubManagementOptions;
  onAccount?: () => void;
};

export default function GameSettings({ dialog, sound, toggleSound, management, onAccount }: Props) {
  const title = useId();
  const [panel, setPanel] = useState<"settings" | "rules" | "table">("settings");
  const showRules = panel === "rules";
  const SoundIcon = sound ? Volume2 : VolumeX;

  return (
    <dialog className={showRules ? "rules-dialog" : "hub-management game-settings"} ref={dialog}
      aria-labelledby={title} onClose={() => setPanel("settings")}>
      {showRules ? <Rules titleId={title} onBack={() => setPanel("settings")} />
        : panel === "table" && management ? (
          <HubManagement {...management} titleId={title} onBack={() => setPanel("settings")} onClose={() => dialog.current?.close()} />
        ) : (
        <>
          <header className="settings-heading">
            <h2 id={title}>Paramètres du jeu</h2>
            <button type="button" className="settings-close" aria-label="Fermer les paramètres" autoFocus
              onClick={() => dialog.current?.close()}><X size={19} aria-hidden="true" /></button>
          </header>
          <div className="settings-links">
            <button type="button" aria-label="Sons de jeu" aria-pressed={sound} onClick={toggleSound}>
              <SoundIcon size={19} aria-hidden="true" /> Son {sound ? "activé" : "coupé"}
            </button>
            <button type="button" onClick={() => setPanel("rules")}>
              <BookOpen size={19} aria-hidden="true" /> Règles du jeu
            </button>
            {onAccount && <button type="button" onClick={() => { dialog.current?.close(); onAccount(); }}>
              <UserRound size={19} aria-hidden="true" /> Mon compte
            </button>}
            {management && (
              <button type="button" className="settings-management" onClick={() => setPanel("table")}>
                <Users size={19} aria-hidden="true" /> Gérer la table
              </button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
