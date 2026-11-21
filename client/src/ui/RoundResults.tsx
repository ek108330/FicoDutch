import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronRight, Megaphone, Trophy } from "lucide-react";
import { GAME_CONFIG } from "../config/gameConfig";
import type { RoundResultView } from "../game/hands";
import { VARIANT_LABELS, type GameVariants } from "../game/variants";
import PlayingCard from "./PlayingCard";
import PerimeterClock from "./PerimeterClock";

type Props = {
  result: RoundResultView;
  settings: ReactNode;
  roundNumber: number;
  remaining: number;
  isHost: boolean;
  canStartNext: boolean;
  waitingPlayers: string[];
  toggleVariant: (key: keyof GameVariants) => void;
  startNext: () => void;
  onLeave: () => void;
};

const variantKeys = Object.keys(VARIANT_LABELS) as Array<keyof GameVariants>;
const interactive = "button, a, input, select, textarea, summary, dialog";
const signedScore = new Intl.NumberFormat("fr", { signDisplay: "always" });

function RoundHands({ result }: { result: RoundResultView }) {
  const winners = result.players.filter(({ id }) => result.winnerIds.includes(id));
  const winnerNames = new Intl.ListFormat("fr").format(winners.map(({ pseudo }) => pseudo));

  return (
    <div role="region" aria-label="Résultat de la manche">
      <p className="result-sr-only">{winnerNames} {winners.length > 1 ? "remportent" : "remporte"} la manche.</p>
      <div className="result-hands">
        {result.players.map(({ id, pseudo, cards, roundScore, penaltyPoints }) => (
          <section key={id} className="result-hand" data-winner={result.winnerIds.includes(id)} aria-label={`Main de ${pseudo}`}>
            <div className="result-player-heading">
              <h2>{pseudo}</h2>
              <PlayerBadges id={id} result={result} />
            </div>
            {penaltyPoints > 0 ? (
              <p className="result-points">{roundScore - penaltyPoints} <span className="result-penalty">+{penaltyPoints}</span></p>
            ) : (
              <p className="result-points">{roundScore} {roundScore > 1 ? "points" : "point"}</p>
            )}
            {cards.length ? (
              <div className="result-cards">
                {cards.map((face, index) => <PlayingCard key={index} face={face} index={index} />)}
              </div>
            ) : <p>Aucune carte</p>}
          </section>
        ))}
      </div>
    </div>
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

function Ranking({ result }: { result: RoundResultView }) {
  const sorted = [...result.players].sort((a, b) => a.totalScore - b.totalScore);
  return (
    <table className="score-ranking" aria-label="Classement cumulé">
      <thead>
        <tr><th>Rang</th><th>Joueur</th><th>Total</th></tr>
      </thead>
      <tbody>
        {sorted.map(({ id, pseudo, totalScore, roundScore }) => (
          <tr key={id}>
            <td>{sorted.findIndex((player) => player.totalScore === totalScore) + 1}</td>
            <th scope="row"><span className="result-player-heading"><span>{pseudo}</span><PlayerBadges id={id} result={result} /></span></th>
            <td>{totalScore} <span className="ranking-round-score">({signedScore.format(roundScore)})</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RoundResults({
  result, settings, roundNumber, remaining, isHost, canStartNext, waitingPlayers, toggleVariant, startNext, onLeave,
}: Props) {
  const [panel, setPanel] = useState<"round" | "ranking">("round");
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const ignoreClick = useRef(false);
  const gameWinners = result.players.filter(({ id }) => result.gameWinnerIds.includes(id));
  const isFinal = gameWinners.length > 0;
  const seconds = Math.ceil(remaining / 1_000);
  const winnerNames = new Intl.ListFormat("fr").format(gameWinners.map(({ pseudo }) => pseudo));
  const activeVariants = variantKeys.filter((key) => result.nextVariants[key]);

  function flipPage() {
    setPanel((current) => current === "round" ? "ranking" : "round");
  }

  function beginSwipe(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary) return;
    ignoreClick.current = false;
    touchOrigin.current = event.pointerType === "touch" && !(event.target as Element).closest(interactive)
      ? { x: event.clientX, y: event.clientY } : null;
  }

  function endSwipe(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary || !touchOrigin.current) return;
    const { x, y } = touchOrigin.current;
    touchOrigin.current = null;
    const horizontal = Math.abs(event.clientX - x);
    if (horizontal < 45 || horizontal < Math.abs(event.clientY - y) * 1.5) return;
    ignoreClick.current = true;
    flipPage();
  }

  function clickScreen(event: MouseEvent<HTMLElement>) {
    if (ignoreClick.current || (event.target as Element).closest(interactive) || window.getSelection()?.toString()) return;
    flipPage();
  }

  return (
    <main className="game-screen result-screen" onClick={clickScreen} onPointerDown={beginSwipe} onPointerUp={endSwipe}
      onPointerCancel={() => { touchOrigin.current = null; }}>
      <section className="round-results" aria-labelledby="result-title">
        {!isFinal && <PerimeterClock remaining={remaining} duration={GAME_CONFIG.round.resultsMs} label="Temps avant la manche suivante" />}
        <div className="result-heading">
          <h1 id="result-title">{isFinal ? "Fin de la partie" : `Manche ${roundNumber}`}</h1>
          <button type="button" className="result-progress" onClick={flipPage}
            aria-label={panel === "round" ? "Afficher le classement cumulé" : "Afficher les cartes de la manche"}
            aria-keyshortcuts="ArrowLeft ArrowRight" onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              flipPage();
            }}>
            <span data-current={panel === "round"} aria-hidden="true" />
            <span data-current={panel === "ranking"} aria-hidden="true" />
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          <div className="result-tools">{settings}</div>
        </div>
        {isFinal ? (
          <>
            <p className="round-winners">{winnerNames} {gameWinners.length > 1 ? "remportent" : "remporte"} la partie.</p>
            <p>Seuil de {result.endThreshold} points atteint.</p>
          </>
        ) : seconds === 0 && <p role="status">En attente de joueurs disponibles.</p>}
        {!isFinal && waitingPlayers.length > 0 && (
          <p>En attente de la prochaine manche · {new Intl.ListFormat("fr").format(waitingPlayers)}</p>
        )}
        <div aria-live="polite">
          {panel === "round" ? <RoundHands result={result} /> : <Ranking result={result} />}
        </div>
        <fieldset className="result-variants" disabled={!isHost || isFinal || seconds === 0}>
          <legend>{isFinal ? "Variantes de la partie" : "Variantes"}</legend>
          {isFinal ? (
            <p>{activeVariants.length ? new Intl.ListFormat("fr").format(activeVariants.map((key) => VARIANT_LABELS[key])) : "Aucune"}</p>
          ) : (
            <div className="result-variant-tiles">
              {variantKeys.map((key) => (
                <button key={key} type="button" aria-pressed={result.nextVariants[key]} onClick={() => toggleVariant(key)}>
                  {VARIANT_LABELS[key]}
                </button>
              ))}
            </div>
          )}
        </fieldset>
        {!isFinal && isHost && panel === "ranking" && (
          <button type="button" className="result-primary" disabled={!canStartNext} onClick={startNext}>
            Lancer la manche suivante
          </button>
        )}
        {isFinal && <button type="button" className="result-primary" onClick={onLeave}>Quitter la table</button>}
      </section>
    </main>
  );
}
