import { useState, type ReactNode } from "react";
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
  const gameWinners = result.players.filter(({ id }) => result.gameWinnerIds.includes(id));
  const isFinal = gameWinners.length > 0;
  const seconds = Math.ceil(remaining / 1_000);
  const winnerNames = new Intl.ListFormat("fr").format(gameWinners.map(({ pseudo }) => pseudo));

  return (
    <main className="game-screen">
      {hostManagement}
      <section className="round-results" aria-labelledby="result-title">
        <p className="result-round-label">Manche {roundNumber}</p>
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
        <div className="result-navigation" aria-label="Affichage des résultats">
          <button type="button" aria-pressed={panel === "round"} onClick={() => setPanel("round")}>Cartes de la manche</button>
          <button type="button" aria-pressed={panel === "ranking"} onClick={() => setPanel("ranking")}>Classement cumulé</button>
        </div>
        {panel === "round" ? <RoundHands result={result} /> : (
          <>
            <Ranking result={result} />
            {!isFinal && (
              <fieldset className="result-variants">
                <legend>Variantes de la prochaine manche</legend>
                {variantKeys.map((key) => (
                  <button key={key} type="button" aria-pressed={result.nextVariants[key]}
                    onClick={() => toggleVariant(key)} disabled={!isHost || seconds === 0}>
                    {VARIANT_LABELS[key]}
                  </button>
                ))}
              </fieldset>
            )}
            {!isFinal && isHost && (
              <button type="button" className="result-primary" disabled={!canStartNext} onClick={startNext}>
                Lancer la manche suivante
              </button>
            )}
          </>
        )}
        {isFinal && <button type="button" className="result-primary" onClick={onLeave}>Quitter la table</button>}
      </section>
    </main>
  );
}
