import type { ReactNode } from "react";
import type { PowerKind } from "../game/gameTypes";
import { powerCardCount, type PowerView } from "../game/powers";
import type { TurnAction, TurnView } from "../game/turn";
import { CardFaceMark } from "./PlayingCard";
import { describeCardFace } from "./cardLabels";

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
  view, canPlay, act, remaining, playerId, reaction,
}: TurnControlsProps & {
  remaining: number;
  playerId: string;
  reaction: { armed: boolean; toggle: () => void } | null;
}) {
  const { power } = view;
  const activeLabel = view.playerId === playerId ? "À toi de jouer" : `Au tour de ${view.playerName}`;
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
  const message = reaction?.armed ? "Choisis une de tes cartes à poser."
    : feedback ?? (power && canPlay ? null : dutchNotice) ?? pending;
  const reactionButton = reaction && (
    <button type="button" aria-pressed={reaction.armed} onClick={reaction.toggle}>
      {reaction.armed ? "Annuler la réaction" : "Réagir"}
    </button>
  );
  const dutchButton = canPlay && view.canAnnounceDutch && (
    <button type="button" aria-label="Annoncer Dutch en fin de tour" aria-pressed={view.dutchArmed}
      onClick={() => act({ kind: "dutch-intent", enabled: !view.dutchArmed })}>
      Dutch
    </button>
  );
  const extraActions = <>{reactionButton}{dutchButton}</>;
  const normalInstruction = canPlay
    ? view.hasDrawn ? "Choisis une carte à remplacer." : "Prends une carte dans l’une des piles."
    : null;
  return (
    <section className="round-panel" aria-label="Tour de jeu">
      <div className="round-heading">
        <strong role="status">{power ? powerLabels[power.kind].title : activeLabel}</strong>
        <span role="timer" className="round-timer">{Math.ceil(remaining / 1_000)} s</span>
      </div>
      {power && canPlay ? (
        <PowerControls power={power} act={act} message={message} extraActions={extraActions} />
      ) : (
        <>
          {(message || (power ? activeLabel : normalInstruction)) && (
            <p aria-live="polite">{message ?? (power ? activeLabel : normalInstruction)}</p>
          )}
          {(reactionButton || dutchButton || (canPlay && view.hasDrawn)) && (
            <div className="power-actions">
              {canPlay && view.hasDrawn && (
                <button type="button" onClick={() => act({ kind: "discard" })}>Défausser la carte tirée</button>
              )}
              {extraActions}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function TurnPiles({ view, canPlay, act }: TurnControlsProps) {
  const canDraw = canPlay && !view.hasDrawn && !view.power;
  const drawnCard = canPlay ? view.drawnCard : null;

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
        <span className="pile-card deck-slot">
          {view.deckCount === 0 && view.discardCount > 1 ? "À refaire" : view.deckCount}
        </span>
      </button>
      <button
        className="pile-slot"
        type="button"
        aria-label={view.topDiscard ? `Prendre la défausse, ${describeCardFace(view.topDiscard)}` : "Défausse vide"}
        disabled={!canDraw || !view.topDiscard}
        onClick={() => act({ kind: "draw", source: "discard", reference: view.reaction.reference })}
      >
        <span>Défausse</span>
        <span className={`pile-card discard-slot${view.topDiscard ? " face-up" : ""}`}>
          {view.topDiscard ? <CardFaceMark face={view.topDiscard} /> : "Vide"}
        </span>
      </button>
      {drawnCard && (
        <div className="pile-slot">
          <span>Carte tirée</span>
          <span className="pile-card face-up" role="img" aria-label={`Carte tirée, ${describeCardFace(drawnCard)}`}>
            <CardFaceMark face={drawnCard} />
          </span>
        </div>
      )}
    </div>
  );
}
