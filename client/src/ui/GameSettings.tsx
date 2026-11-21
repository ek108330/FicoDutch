import { useId, useState, type RefObject } from "react";
import { BookOpen, Volume2, VolumeX, X } from "lucide-react";
import type { Hub } from "../../../shared/hubTypes";
import { VARIANT_LABELS, type GameVariants } from "../game/variants";
import Rules from "./Rules";

const thresholds = [50, 100, 200, 500, 1000, null];
const variantKeys = Object.keys(VARIANT_LABELS) as (keyof GameVariants)[];

type Props = {
  dialog: RefObject<HTMLDialogElement | null>;
  sound: boolean;
  toggleSound: () => void;
  hub: Hub | null;
  canEdit: boolean;
  onUpdate: (variants: GameVariants, endThreshold: Hub["endThreshold"]) => void;
};

export default function GameSettings({ dialog, sound, toggleSound, hub, canEdit, onUpdate }: Props) {
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
          {hub && (
            <fieldset className="hub-settings" disabled={!canEdit}>
              <legend>Paramètres de la partie</legend>
              <label className="threshold-setting" htmlFor={`${title}-threshold`}>
                Fin de partie <span>{hub.endThreshold === null ? "Sans limite" : `${hub.endThreshold} points`}</span>
              </label>
              <input id={`${title}-threshold`} type="range" min="0" max={thresholds.length - 1}
                value={thresholds.indexOf(hub.endThreshold)}
                aria-valuetext={hub.endThreshold === null ? "Sans limite" : `${hub.endThreshold} points`}
                onChange={(event) => onUpdate(hub.variants, thresholds[Number(event.target.value)])} />
              <div className="threshold-labels" aria-hidden="true">
                {thresholds.map((value) => <span key={value ?? "none"}>{value ?? "Sans limite"}</span>)}
              </div>
              <h3>Variantes</h3>
              <div className="variant-grid">
                {variantKeys.map((key) => (
                  <button key={key} type="button" aria-pressed={hub.variants[key]}
                    onClick={() => onUpdate({ ...hub.variants, [key]: !hub.variants[key] }, hub.endThreshold)}>
                    {VARIANT_LABELS[key]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}
    </dialog>
  );
}
