import { useId, useState, type RefObject } from "react";
import { BookOpen, Volume2, VolumeX, X } from "lucide-react";
import Rules from "./Rules";

type Props = {
  dialog: RefObject<HTMLDialogElement | null>;
  sound: boolean;
  toggleSound: () => void;
};

export default function GameSettings({ dialog, sound, toggleSound }: Props) {
  const title = useId();
  const [showRules, setShowRules] = useState(false);
  const SoundIcon = sound ? Volume2 : VolumeX;

  return (
    <dialog className={showRules ? "rules-dialog" : "hub-management game-settings"} ref={dialog}
      aria-labelledby={title} onClose={() => setShowRules(false)}>
      {showRules ? <Rules titleId={title} onBack={() => setShowRules(false)} /> : (
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
            <button type="button" onClick={() => setShowRules(true)}>
              <BookOpen size={19} aria-hidden="true" /> Règles du jeu
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
