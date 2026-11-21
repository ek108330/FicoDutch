import type { ReactNode } from "react";
import type { PowerKind } from "../game/gameTypes";
import { powerCardCount, type PowerView } from "../game/powers";
import { FINAL_REACTION_MS, TURN_DURATION_MS, type TurnAction, type TurnView } from "../game/turn";
import { CardBackMark, CardFaceMark } from "./PlayingCard";
import { describeCardFace } from "./cardLabels";
import type { CardFeedback } from "./useCardFeedback";
import PerimeterClock from "./PerimeterClock";

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
  power, act, message,
}: {
  power: PowerView;
  act: TurnControlsProps["act"];
  message: string | null;
}) {
  const selected = power.selection?.targets.length ?? 0;
  const revealed = !!power.selection?.revealed.length;
  const canSwap = power.selection?.canSwap === true;
  const viewedPair = revealed && power.kind === "look-and-swap";
  const completedSelection = powerCardCount(power.kind) > 0 && power.selection?.remaining === 0;
  const passLabel = viewedPair ? "Garder en place" : "Passer le pouvoir";
  const instruction = selected === 1 && powerCardCount(power.kind) === 2
    ? "Choisis la deuxième carte."
    : powerLabels[power.kind].instruction;

  if (power.lookTarget) return message ? <p aria-live="polite">{message}</p> : null;

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
  return (
    <section className="turn-layout" aria-label="Tour de jeu">
      <div className="round-panel turn-panel">
        {!power?.lookTarget && <PerimeterClock key={`${view.number}:${power?.kind ?? "turn"}:${view.finalReaction}`}
          remaining={remaining} duration={view.finalReaction ? FINAL_REACTION_MS : TURN_DURATION_MS}
          label={view.finalReaction ? "Temps pour réagir" : "Temps restant"} />}
        <strong className="turn-player" role="status">{view.finalReaction ? "Dernières réactions" : `${view.playerName} joue`}</strong>
      </div>
      {(power || feedback) && (
        <div className="round-panel turn-choices">
          {power && <h2 className="power-title">{powerLabels[power.kind].title}</h2>}
          {power && canPlay ? (
            <PowerControls power={power} act={act} message={feedback} />
          ) : feedback && <p aria-live="polite">{feedback}</p>}
        </div>
      )}
      {piles}
    </section>
  );
}

export function TurnPiles({ view, canPlay, act, feedback }: TurnControlsProps & { feedback: CardFeedback | null }) {
  const canDraw = canPlay && !view.hasDrawn && !view.power;
  const canDiscard = canPlay && view.hasDrawn && !view.power;
  const discardLabel = view.topDiscard ? `Défausse, ${describeCardFace(view.topDiscard)}` : "Défausse vide";
  const discardPile = (
    <>
      <span>Défausse</span>
      <span className={`pile-card discard-slot${view.topDiscard ? " face-up" : ""}`}
        data-stacked={view.discardCount > 1 || undefined}>
        {feedback?.pile === "discard" && <span key={feedback.id}
          className={`card-feedback feedback-${feedback.kind}`} aria-hidden="true" />}
        {view.topDiscard ? <CardFaceMark face={view.topDiscard} /> : "Vide"}
      </span>
    </>
  );

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
      {canDiscard ? (
        <button className="pile-slot discard-target" type="button" aria-label={discardLabel}
          aria-description="Au clavier, Entrée ou Espace défausse la carte tirée."
          onClick={(event) => { if (event.detail === 0) act({ kind: "discard" }); }}>
          {discardPile}
        </button>
      ) : <div className="pile-slot" role="img" aria-label={discardLabel}>{discardPile}</div>}
    </div>
  );
}
