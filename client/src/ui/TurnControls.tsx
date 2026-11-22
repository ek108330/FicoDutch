import type { ReactNode } from "react";
import { ArrowDownUp, X } from "lucide-react";
import type { PowerKind } from "../game/gameTypes";
import { powerCardCount, type PowerView } from "../game/powers";
import { FINAL_REACTION_MS, TURN_DURATION_MS, type TurnAction, type TurnView } from "../game/turn";
import { CardBackMark, CardFaceMark } from "./PlayingCard";
import { describeCardFace } from "./cardLabels";
import type { CardFeedback } from "./useCardFeedback";
import PerimeterClock from "./PerimeterClock";
import { useTapAction } from "./useTapAction";
import GiftDeckCard from "./GiftDeckCard";

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
  "give-card": { title: "Pouvoir du Joker+", instruction: "Glisse la carte vers un joueur." },
};

function PowerControls({ power, act }: {
  power: PowerView;
  act: TurnControlsProps["act"];
}) {
  const selected = power.selection?.targets.length ?? 0;
  const completedSelection = powerCardCount(power.kind) > 0 && power.selection?.remaining === 0;
  const instruction = selected === 1 && powerCardCount(power.kind) === 2
    ? "Choisis la deuxième carte."
    : powerLabels[power.kind].instruction;

  if (power.lookTarget || completedSelection) return null;

  return (
    <>
      <p>{instruction}</p>
      <button type="button" aria-label="Passer le pouvoir" onClick={() => act({ kind: "power-pass" })}>Passer</button>
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
  const valetPair = canPlay && power?.kind === "look-and-swap" && power.selection?.remaining === 0;
  const canSwap = valetPair && power.selection?.canSwap === true;
  const swapTap = useTapAction(canSwap ? () => act({ kind: "power-swap" }) : undefined);
  const cancelTap = useTapAction(valetPair ? () => act({ kind: "power-pass" }) : undefined);
  const showCenter = canPlay || view.finalReaction;
  const turnLabel = view.finalReaction ? "Dernières réactions" : `${view.playerName} joue`;
  const notice = view.reaction.notice;
  const reactor = notice && view.players.find(({ id }) => id === notice.playerId)?.pseudo;
  const feedback = reactor && notice ? {
    played: `${reactor} a réagi.`,
    penalty: `${reactor} reçoit une carte de pénalité.`,
    "empty-pile": "Réaction incorrecte. Aucune carte de pénalité disponible.",
  }[notice.outcome] : null;
  return (
    <section className="turn-layout" aria-label="Tour de jeu">
      {piles}
      {showCenter ? <div className="round-panel turn-panel" data-local-turn={canPlay || undefined}>
        {!power?.lookTarget && <PerimeterClock key={`${view.number}:${power?.kind ?? "turn"}:${view.finalReaction}`}
          remaining={remaining} duration={view.finalReaction ? FINAL_REACTION_MS : TURN_DURATION_MS}
          label={view.finalReaction ? "Temps pour réagir" : "Temps restant"} />}
        <div className="turn-player-row">
          <strong className="turn-player" role="status">{turnLabel}</strong>
          {valetPair && <div className="turn-decision">
            <button type="button" className="turn-swap" aria-label="Échanger les cartes" disabled={!canSwap}
              title={canSwap ? "Échanger les deux cartes retournées" : "Échange bloqué par la protection Dutch"} {...swapTap}>
              <ArrowDownUp size={18} aria-hidden="true" />
            </button>
            <button type="button" className="turn-cancel" aria-label="Annuler l’échange"
              title="Laisser les cartes en place" {...cancelTap}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>}
        </div>
        {canPlay && power && (
          <div className="turn-choices">
            <h2 className="power-title">{powerLabels[power.kind].title}</h2>
            {valetPair && !canSwap && <p>La protection Dutch empêche l’échange.</p>}
            <PowerControls power={power} act={act} />
          </div>
        )}
      </div> : <strong className="sr-only" role="status">{turnLabel}</strong>}
      {feedback && <p className="sr-only" aria-live="polite">{feedback}</p>}
    </section>
  );
}

export function TurnPiles({ view, canPlay, act, feedback, onGiftSlide }: TurnControlsProps & {
  feedback: CardFeedback | null;
  onGiftSlide: () => void;
}) {
  const canDraw = canPlay && !view.hasDrawn && !view.power;
  const canDiscard = canPlay && view.hasDrawn && !view.power;
  const giftPending = view.power?.kind === "give-card";
  const deckBack = view.deckCount > 0 || giftPending;
  const deckPile = (
    <>
      <span>Pioche</span>
      <span className={`pile-card deck-slot${deckBack ? " pile-backed" : ""}`}
        data-gift-pending={giftPending || undefined} data-stacked={view.deckCount > 1 || undefined}>
        {feedback?.pile === "deck" && <span key={feedback.id} className="card-feedback feedback-draw" aria-hidden="true" />}
        {deckBack ? <CardBackMark /> : view.discardCount > 1 ? "À refaire" : "Vide"}
      </span>
    </>
  );
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
      {canPlay && giftPending ? (
        <GiftDeckCard onGift={(playerId) => act({ kind: "power-player", playerId })} onSlide={onGiftSlide}>
          {deckPile}
        </GiftDeckCard>
      ) : <button
        className="pile-slot"
        type="button"
        aria-label="Piocher dans la pioche"
        disabled={!canDraw || (view.deckCount === 0 && view.discardCount < 2)}
        onClick={() => act({ kind: "draw", source: "deck" })}
      >
        {deckPile}
      </button>}
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
