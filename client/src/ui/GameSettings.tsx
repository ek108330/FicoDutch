import { useId, useState, type RefObject } from "react";
import { BookOpen, GraduationCap, LogOut, UserRound, Users, Volume2, VolumeX, X } from "lucide-react";
import HubManagement, { type HubManagementOptions } from "./HubManagement";
import Rules from "./Rules";

type Props = {
  dialog: RefObject<HTMLDialogElement | null>;
  sound: boolean;
  toggleSound: () => void;
  management?: HubManagementOptions;
  onAccount?: () => void;
  onTutorial?: () => void;
  onSignOut?: () => Promise<void>;
  onLeave?: () => void;
};

export default function GameSettings({ dialog, sound, toggleSound, management, onAccount, onTutorial, onSignOut, onLeave }: Props) {
  const title = useId();
  const [panel, setPanel] = useState<"settings" | "rules" | "table">("settings");
  const showRules = panel === "rules";
  const SoundIcon = sound ? Volume2 : VolumeX;
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function disconnect() {
    if (!onSignOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await onSignOut();
      dialog.current?.close();
    } catch {
      setSignOutError("Impossible de se déconnecter. Réessaie dans un instant.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <dialog className={showRules ? "rules-dialog" : "hub-management game-settings"} ref={dialog}
      aria-labelledby={title} onClose={() => { setPanel("settings"); setSignOutError(""); }}>
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
            {onTutorial && <button type="button" onClick={() => { dialog.current?.close(); onTutorial(); }}>
              <GraduationCap size={19} aria-hidden="true" /> Apprendre à jouer
            </button>}
            {onAccount && <button type="button" onClick={() => { dialog.current?.close(); onAccount(); }}>
              <UserRound size={19} aria-hidden="true" /> Mon compte
            </button>}
            {onSignOut && <button className="account-danger" type="button" disabled={signingOut} onClick={() => void disconnect()}>
              <LogOut size={19} aria-hidden="true" /> Se déconnecter
            </button>}
            {management && (
              <button type="button" className="settings-management" onClick={() => setPanel("table")}>
                <Users size={19} aria-hidden="true" /> Gérer la table
              </button>
            )}
            {onLeave && <button type="button" onClick={() => { dialog.current?.close(); onLeave(); }}>
              <LogOut size={19} aria-hidden="true" /> Quitter la table
            </button>}
          </div>
          {signOutError && <p role="alert">{signOutError}</p>}
        </>
      )}
    </dialog>
  );
}
