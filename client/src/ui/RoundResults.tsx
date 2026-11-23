import { useId, useRef, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Megaphone, Trophy } from "lucide-react";
import { GAME_CONFIG } from "../config/gameConfig";
import { rankPlayers, type RoundResultView } from "../game/hands";
import { VARIANT_LABELS, type GameVariants } from "../game/variants";
import PlayingCard from "./PlayingCard";
import PerimeterClock from "./PerimeterClock";
import { InterruptConfirmation } from "./HubManagement";

type Props = {
  result: RoundResultView;
  settings: ReactNode;
  roundNumber: number;
  remaining: number;
  isHost: boolean;
  canEditVariants: boolean;
  canStartNext: boolean;
  waitingPlayers: string[];
  toggleVariant: (key: keyof GameVariants) => void;
  startNext: () => void;
  onLeave: () => void;
  onRestart: () => void;
  onInterrupt?: () => void;
  canRestart: boolean;
};

const variantKeys = Object.keys(VARIANT_LABELS) as Array<keyof GameVariants>;
const signedScore = new Intl.NumberFormat("fr", { signDisplay: "always" });

function ResultHands({ result }: { result: RoundResultView }) {
  const winners = result.players.filter(({ id }) => result.winnerIds.includes(id));
  const winnerNames = new Intl.ListFormat("fr").format(winners.map(({ pseudo }) => pseudo));

  return (
    <section aria-labelledby="round-detail-title">
      <h2 id="round-detail-title" className="result-section-title">Détail de la manche</h2>
      <p className="sr-only">{winnerNames} {winners.length > 1 ? "remportent" : "remporte"} la manche.</p>
      <div className="result-hands">
        {result.players.map(({ id, pseudo, cards, roundScore, penaltyPoints }) => (
          <section key={id} className="result-hand" data-winner={result.winnerIds.includes(id)} aria-label={`Main de ${pseudo}`}>
            <div className="result-player-heading">
              <h3 title={pseudo}>{pseudo}</h3>
              <PlayerBadges id={id} result={result} />
              <span className="sr-only">Points de la manche </span>
              <span className="result-points">{penaltyPoints > 0 ? (
                <>{roundScore - penaltyPoints} <span className="result-penalty">+{penaltyPoints}</span></>
              ) : roundScore}</span>
            </div>
            {cards.length ? (
              <div className="result-cards">
                {cards.map((face, index) => <PlayingCard key={index} face={face} index={index} />)}
              </div>
            ) : <p>Aucune carte</p>}
          </section>
        ))}
      </div>
    </section>
  );
}

function PlayerBadges({ id, result }: { id: string; result: RoundResultView }) {
  const won = result.winnerIds.includes(id);
  const announced = id === result.dutchAnnouncerId;
  return (
    <>
      {won && <span className="result-badge" role="img" aria-label="Manche remportée" title="Manche remportée"><Trophy size={13} /></span>}
      {announced && (
        <span className="result-badge result-dutch" role="img" title={result.dutchPenalty ? "Dutch · pénalité de 10 points" : "Annonce Dutch"}
          aria-label={result.dutchPenalty ? "Annonce Dutch, pénalité de 10 points" : "Annonce Dutch"}>
          <Megaphone size={13} />
        </span>
      )}
    </>
  );
}

function RankingPosition({ rank, previousRank }: { rank: number; previousRank?: number }) {
  const change = previousRank === undefined ? 0 : previousRank - rank;
  const Icon = change > 0 ? ArrowUp : ArrowDown;
  const places = Math.abs(change);
  const label = `${change > 0 ? "Gagne" : "Perd"} ${places} ${places === 1 ? "place" : "places"}`;
  return <span className="ranking-position">
    <span><span className="sr-only">Rang </span>{rank}</span>
    {change !== 0 && <span className="rank-movement" data-direction={change > 0 ? "up" : "down"}
      role="img" aria-label={label} title={label}><Icon size={13} strokeWidth={2.8} aria-hidden="true" /></span>}
  </span>;
}

function Ranking({ result }: { result: RoundResultView }) {
  return (
    <table className="score-ranking" aria-label="Classement cumulé">
      <caption className="result-section-title">Classement général</caption>
      <thead>
        <tr>
          <th scope="col" className="ranking-rank">Rang</th><th scope="col">Joueur</th>
          <th scope="col" className="ranking-round-score">Dernière manche</th><th scope="col" className="result-total">Total</th>
        </tr>
      </thead>
      <tbody>
        {rankPlayers(result.players).map(({ rank, player: { id, pseudo, totalScore, roundScore, previousRank } }) => (
          <tr key={id}>
            <td><RankingPosition rank={rank} previousRank={previousRank} /></td>
            <th scope="row"><span className="ranking-player"><span title={pseudo}>{pseudo}</span><PlayerBadges id={id} result={result} /></span></th>
            <td className="ranking-round-score">{signedScore.format(roundScore)}</td>
            <td className="result-total">{totalScore}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RoundResults({
  result, settings, roundNumber, remaining, isHost, canEditVariants, canStartNext, waitingPlayers, toggleVariant, startNext, onLeave,
  onRestart, onInterrupt, canRestart,
}: Props) {
  const interruptDialog = useRef<HTMLDialogElement>(null);
  const interruptTitle = useId();
  const gameWinners = result.players.filter(({ id }) => result.gameWinnerIds.includes(id));
  const isFinal = gameWinners.length > 0;
  const seconds = Math.ceil(remaining / 1_000);
  const winnerNames = new Intl.ListFormat("fr").format(gameWinners.map(({ pseudo }) => pseudo));

  return (
    <main className="game-screen result-screen" data-final={isFinal || undefined}>
      <section className="round-results" aria-labelledby="result-title">
        {!isFinal && <PerimeterClock remaining={remaining} duration={GAME_CONFIG.round.resultsMs}
          label="Temps avant la manche suivante" radius={15} />}
        <div className="result-heading">
          <h1 id="result-title">{isFinal ? "Fin de la partie" : `Manche ${roundNumber}`}</h1>
          <div className="result-tools">{settings}</div>
        </div>
        {isFinal ? (
          <div className="result-summary">
            <p className="round-winners">{winnerNames} {gameWinners.length > 1 ? "remportent" : "remporte"} la partie.</p>
            <p>Seuil de {result.endThreshold} points atteint.</p>
          </div>
        ) : seconds === 0 && <p role="status">En attente de joueurs disponibles.</p>}
        {!isFinal && waitingPlayers.length > 0 && (
          <p>En attente de la prochaine manche · {new Intl.ListFormat("fr").format(waitingPlayers)}</p>
        )}
        <div className="result-details">
          <ResultHands result={result} />
          <Ranking result={result} />
        </div>
        <div className="result-footer">
          <fieldset className="result-variants" disabled={!canEditVariants}>
            <legend>{isFinal ? "Variantes de la prochaine partie" : "Variantes de la prochaine manche"}</legend>
            <div className="result-variant-tiles">
              {variantKeys.map((key) => (
                <button key={key} type="button" aria-pressed={result.nextVariants[key]} onClick={() => toggleVariant(key)}>
                  {VARIANT_LABELS[key]}
                </button>
              ))}
            </div>
          </fieldset>
          {!isFinal && isHost && (
            <button type="button" className="result-primary" disabled={!canStartNext} onClick={startNext}>
              Lancer la manche suivante
            </button>
          )}
          {isFinal && (isHost ? (
            <div className="result-actions">
              {onInterrupt && <button type="button" className="hub-danger" aria-haspopup="dialog" onClick={() => interruptDialog.current?.showModal()}>
                Interrompre la partie
              </button>}
              <button type="button" className="result-primary" disabled={!canRestart} onClick={onRestart}>
                Lancer la prochaine partie
              </button>
            </div>
          ) : <button type="button" className="result-primary" onClick={onLeave}>Quitter la table</button>)}
        </div>
      </section>
      {isFinal && onInterrupt && <dialog className="hub-management game-settings" ref={interruptDialog} aria-labelledby={interruptTitle}>
        <InterruptConfirmation titleId={interruptTitle} onCancel={() => interruptDialog.current?.close()} onConfirm={() => {
          interruptDialog.current?.close();
          onInterrupt();
        }} />
      </dialog>}
    </main>
  );
}
