import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { RoundResultView } from "../game/hands";
import { VARIANT_LABELS, type GameVariants } from "../game/variants";
import PlayingCard from "./PlayingCard";

type Props = {
  result: RoundResultView;
  hostManagement: ReactNode;
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

function RoundHands({ result }: { result: RoundResultView }) {
  const emptyPlayer = result.players.find(({ id }) => id === result.emptyHandPlayerId);
  const announcer = result.players.find(({ id }) => id === result.dutchAnnouncerId);
  const winners = result.players.filter(({ id }) => result.winnerIds.includes(id));
  const winnerNames = new Intl.ListFormat("fr").format(winners.map(({ pseudo }) => pseudo));

  return (
    <div role="region" aria-label="Résultat de la manche">
      {emptyPlayer && <p>{emptyPlayer.pseudo} a posé sa dernière carte.</p>}
      {!emptyPlayer && announcer && <p>{announcer.pseudo} a annoncé Dutch.</p>}
      {result.dutchPenalty && announcer && <p>{announcer.pseudo} reçoit 10 points de pénalité Dutch.</p>}
      <p className="round-winners">{winnerNames} {winners.length > 1 ? "remportent" : "remporte"} la manche.</p>
      <div className="result-hands">
        {result.players.map(({ id, pseudo, cards, roundScore }) => (
          <section key={id} className="result-hand" aria-label={`Main de ${pseudo}`}>
            <h2>{pseudo}</h2>
            <p>{roundScore} {roundScore > 1 ? "points" : "point"}</p>
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

function Ranking({ result }: { result: RoundResultView }) {
  const sorted = [...result.players].sort((a, b) => a.totalScore - b.totalScore);
  return (
    <table className="score-ranking" aria-label="Classement cumulé">
      <thead>
        <tr><th>Rang</th><th>Joueur</th><th>Total</th><th>Progression</th></tr>
      </thead>
      <tbody>
        {sorted.map(({ id, pseudo, totalScore, scoreHistory }) => (
          <tr key={id}>
            <td>{sorted.findIndex((player) => player.totalScore === totalScore) + 1}</td>
            <th scope="row">{pseudo}</th>
            <td>{totalScore}</td>
            <td>{scoreHistory.join(" → ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RoundResults({
  result, hostManagement, roundNumber, remaining, isHost, canStartNext, waitingPlayers, toggleVariant, startNext, onLeave,
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
      {hostManagement}
      <section className="round-results" aria-labelledby="result-title">
        <div className="result-heading">
          <p className="result-round-label">Manche {roundNumber}</p>
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
        </div>
        <h1 id="result-title">{isFinal ? "Fin de la partie" : "Fin de la manche"}</h1>
        {isFinal ? (
          <>
            <p className="round-winners">{winnerNames} {gameWinners.length > 1 ? "remportent" : "remporte"} la partie.</p>
            <p>Seuil de {result.endThreshold} points atteint.</p>
          </>
        ) : (
          <p className="result-countdown">
            {seconds > 0 ? <>Prochaine manche dans <span role="timer">{seconds} s</span></>
              : "En attente de joueurs disponibles pour la prochaine manche."}
          </p>
        )}
        {!isFinal && waitingPlayers.length > 0 && (
          <p>En attente de la prochaine manche · {new Intl.ListFormat("fr").format(waitingPlayers)}</p>
        )}
        <div aria-live="polite">
          {panel === "round" ? <RoundHands result={result} /> : <Ranking result={result} />}
        </div>
        <fieldset className="result-variants" disabled={!isHost || isFinal || seconds === 0}>
          <legend>{isFinal ? "Variantes de la partie" : "Variantes de la prochaine manche"}</legend>
          {isFinal ? (
            <p>{activeVariants.length ? new Intl.ListFormat("fr").format(activeVariants.map((key) => VARIANT_LABELS[key])) : "Aucune"}</p>
          ) : variantKeys.map((key) => (
            <button key={key} type="button" aria-pressed={result.nextVariants[key]} onClick={() => toggleVariant(key)}>
              {VARIANT_LABELS[key]}
            </button>
          ))}
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
