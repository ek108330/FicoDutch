import type { ReactNode } from "react";
import type { PowerKind } from "../game/gameTypes";
import { powerCardCount, type PowerView } from "../game/powers";
import { TURN_DURATION_MS, type TurnAction, type TurnView } from "../game/turn";
import { CardBackMark, CardFaceMark } from "./PlayingCard";
import { describeCardFace } from "./cardLabels";
import type { CardFeedback } from "./useCardFeedback";

type TurnControlsProps = {
  view: TurnView;
  canPlay: boolean;
  act: (action: TurnAction) => void;
};

const powerLabels: Record<PowerKind, { title: string; instruction: string }> = {
  "look-own": { title: "Pouvoir du 8", instruction: "Choisis une de tes cartes à regarder." },
  "look-other": { title: "Pouvoir du 9", instruction: "Choisis une carte adverse à regarder." },
  "blind-swap": { title: "Pouvoir du 10", instruction: "Échange deux cartes face cachée." },
  "look-and-swap": { title: "Pouvoir du Valet", instruction: "Choisis deux cartes à regarder." },
  "give-card": { title: "Pouvoir du Joker+", instruction: "Choisis à qui donner une carte cachée." },
};

function PowerControls({
  power, act, message, extraActions,
}: {
  power: PowerView;
  act: TurnControlsProps["act"];
  message: string | null;
  extraActions: ReactNode;
}) {
  const selected = power.selection?.targets.length ?? 0;
  const revealed = !!power.selection?.revealed.length;
  const canSwap = power.selection?.canSwap === true;
  const viewedPair = revealed && power.kind === "look-and-swap";
  const completedSelection = powerCardCount(power.kind) > 0 && power.selection?.remaining === 0;
  const passLabel = viewedPair ? "Garder en place" : completedSelection ? "Terminer le pouvoir" : "Passer le pouvoir";
  const instruction = selected === 1 && powerCardCount(power.kind) === 2
    ? "Choisis la deuxième carte."
    : powerLabels[power.kind].instruction;

  return (
    <>
      {message ? <p aria-live="polite">{message}</p>
        : viewedPair && !canSwap ? <p>La protection Dutch empêche l’échange.</p>
        : !completedSelection && <p>{instruction}</p>}
      <div className="power-actions">
        {canSwap && (
          <button type="button" onClick={() => act({ kind: "power-swap" })}>Échanger les cartes</button>
        )}
        <button type="button" onClick={() => act({ kind: "power-pass" })}>{passLabel}</button>
        {extraActions}
      </div>
    </>
  );
}

export function TurnPanel({
  view, canPlay, act, remaining, piles,
}: TurnControlsProps & {
  remaining: number;
  piles: ReactNode;
}) {
  const { power } = view;
  const notice = view.reaction.notice;
  const reactor = notice && view.players.find(({ id }) => id === notice.playerId)?.pseudo;
  const feedback = reactor && notice ? {
    played: `${reactor} a réagi.`,
    penalty: `${reactor} reçoit une carte de pénalité.`,
    "empty-pile": "Réaction incorrecte. Aucune carte de pénalité disponible.",
  }[notice.outcome] : null;
  const announcer = view.dutch && view.players.find(({ id }) => id === view.dutch?.announcerId)?.pseudo;
  const dutchNotice = view.dutch && announcer
    ? `${announcer} a annoncé Dutch. ${view.dutch.lastTurns === 1 ? "Dernier tour." : `${view.dutch.lastTurns} tours restants.`}`
    : null;
  const pending = view.dutchArmed && !power ? "Dutch sera annoncé en fin de tour." : null;
  const message = feedback ?? (power && canPlay ? null : dutchNotice) ?? pending;
  const dutchButton = canPlay && view.canAnnounceDutch && (
    <button type="button" aria-label="Annoncer Dutch en fin de tour" aria-pressed={view.dutchArmed}
      onClick={() => act({ kind: "dutch-intent", enabled: !view.dutchArmed })}>
      Dutch
    </button>
  );
  const fraction = Math.min(1, Math.max(0, remaining / TURN_DURATION_MS));
  const seconds = Math.ceil(fraction * TURN_DURATION_MS / 1_000);
  const discarding = canPlay && view.hasDrawn;
  return (
    <section className="turn-layout" aria-label="Tour de jeu">
      <div className="round-panel turn-panel">
        <svg key={`${view.number}:${power?.kind ?? "turn"}`} className="turn-clock" role="progressbar"
          aria-label="Temps restant" aria-valuemin={0} aria-valuemax={TURN_DURATION_MS / 1_000}
          aria-valuenow={seconds} aria-valuetext={`${seconds} secondes`}>
          <rect className="turn-clock-track" x="1.5" y="1.5" rx="10" />
          <rect className="turn-clock-progress" x="1.5" y="1.5" rx="10" pathLength="100" strokeDashoffset={100 * (1 - fraction)} />
        </svg>
        <strong className="turn-player" role="status">{view.playerName} joue</strong>
      </div>
      {(power || message || dutchButton || discarding) && (
        <div className="round-panel turn-choices">
          {power && <h2 className="power-title">{powerLabels[power.kind].title}</h2>}
          {power && canPlay ? (
            <PowerControls power={power} act={act} message={message} extraActions={dutchButton} />
          ) : (
            <>
              {message && <p aria-live="polite">{message}</p>}
              {(dutchButton || discarding) && (
                <div className="power-actions">
                  {discarding && <button type="button" onClick={() => act({ kind: "discard" })}>Défausser la carte tirée</button>}
                  {dutchButton}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {piles}
    </section>
  );
}

export function TurnPiles({ view, canPlay, act, feedback }: TurnControlsProps & { feedback: CardFeedback | null }) {
  const canDraw = canPlay && !view.hasDrawn && !view.power;

  return (
    <div className="table-piles">
      <button
        className="pile-slot"
        type="button"
        aria-label="Piocher dans la pioche"
        disabled={!canDraw || (view.deckCount === 0 && view.discardCount < 2)}
        onClick={() => act({ kind: "draw", source: "deck" })}
      >
        <span>Pioche</span>
        <span className={`pile-card deck-slot${view.deckCount > 0 ? " pile-backed" : ""}`}
          data-stacked={view.deckCount > 1 || undefined}>
          {feedback?.pile === "deck" && <span key={feedback.id} className="card-feedback feedback-draw" aria-hidden="true" />}
          {view.deckCount > 0 ? <CardBackMark /> : view.discardCount > 1 ? "À refaire" : "Vide"}
        </span>
      </button>
      <div className="pile-slot" role="img"
        aria-label={view.topDiscard ? `Défausse, ${describeCardFace(view.topDiscard)}` : "Défausse vide"}>
        <span>Défausse</span>
        <span className={`pile-card discard-slot${view.topDiscard ? " face-up" : ""}`}
          data-stacked={view.discardCount > 1 || undefined}>
          {feedback?.pile === "discard" && <span key={feedback.id}
            className={`card-feedback feedback-${feedback.kind}`} aria-hidden="true" />}
          {view.topDiscard ? <CardFaceMark face={view.topDiscard} /> : "Vide"}
        </span>
      </div>
    </div>
  );
}
