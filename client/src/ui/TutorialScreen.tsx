import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Check, Lightbulb, Play, RotateCcw } from "lucide-react";
import type { HubPlayer } from "../../../shared/hubTypes";
import { createRound } from "../game/createRound";
import { getRoundResultView } from "../game/hands";
import { getMemorizedCards, memorizeCard, setMemorizationReady } from "../game/memorization";
import { beginPlay, getTurnView, playTurn, type TurnAction } from "../game/turn";
import { allTutorialDrills, chapterByDrill, isExpectedAction, learnerId, practicePlayers, setupDrill, tickDrill, tutorialChapters, type TutorialGesture } from "../game/tutorial";
import type { UpdateHostRound } from "../game/useRoundTurn";
import { DEFAULT_VARIANTS } from "../game/variants";
import GameTable from "./GameTable";
import RoundScreen from "./RoundScreen";
import { TurnPanel, TurnPiles } from "./TurnControls";
import { useCardFeedback, type PlayGameSound } from "./useCardFeedback";
import "./Tutorial.css";

export const tutorialPath = "/didacticiel";
type Props = { section?: string; navigate: (path: string) => void; playSound: PlayGameSound;
  completed: string[]; onChapterComplete: (id: string) => void };
type Drill = (typeof allTutorialDrills)[number];
type Run = {
  drill: number;
  step: number;
  state: ReturnType<typeof setupDrill>;
  clock: number;
  entered: number;
  visible: number[];
  notice?: string;
  recaps: { title: string; text: string }[];
};
const members: HubPlayer[] = practicePlayers.map((player) => ({
  ...player, connected: true, connectionVersion: 1, isHost: player.id === learnerId,
}));
const memberById = new Map(members.map((member) => [member.id, member]));
const localPeers = {
  hostConnected: false, connectedPeers: [], relayedPeers: [], send: () => false,
  subscribe: () => () => {},
};

function startDrill(drills: Drill[], drill: number, recaps: Run["recaps"] = []): Run {
  return { drill, step: 0, state: setupDrill(drills[drill]), clock: 0, entered: performance.now(), visible: [], recaps };
}

function nextStep(current: Run, state: Run["state"], clock: number, visible = current.visible): Run {
  return { ...current, state, clock, visible, step: current.step + 1, entered: performance.now(), notice: undefined };
}

function TutorialMenu({ navigate, completed, unknown }: Pick<Props, "navigate" | "completed"> & { unknown?: boolean }) {
  return <main className="archive-screen tutorial-menu">
    <a className="archive-back" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>
      <ArrowLeft size={17} aria-hidden="true" /> Accueil
    </a>
    <h1><BookOpen size={24} aria-hidden="true" /> Apprendre à jouer</h1>
    <p>Entraîne-toi avec Nora et Milo. Les exercices avancent dès que tu réussis le geste.</p>
    {unknown && <p role="status">Cet exercice n’est pas disponible.</p>}
    <button className="tutorial-primary" type="button" onClick={() => navigate(`${tutorialPath}/complet`)}>
      <Play size={17} aria-hidden="true" /> Parcours complet
    </button>
    <div className="tutorial-chapters" aria-label="Choisir un exercice">
      {tutorialChapters.map(({ id, title, description }) => <button type="button" key={id}
        onClick={() => navigate(`${tutorialPath}/${id}`)}>
        <strong>{title}{completed.includes(id) && <Check className="tutorial-completed" size={16} role="img" aria-label="Chapitre terminé" />}</strong>
        <span>{description}</span>
      </button>)}
      <button type="button" onClick={() => navigate(`${tutorialPath}/libre`)}>
        <strong>Partie libre</strong>
        <span>Joue une vraie manche d’entraînement contre deux bots.</span>
      </button>
    </div>
  </main>;
}

function PracticeRound({ navigate, playSound }: Pick<Props, "navigate" | "playSound">) {
  const newRound = () => createRound(practicePlayers, DEFAULT_VARIANTS, null);
  const [round, setRound] = useState(newRound);
  const [session, setSession] = useState(1);
  const updateRound: UpdateHostRound = (_id, update) => setRound((state) => {
    const next = update(state, members);
    if (next === state) return state;
    if ((next.phase === "memorization" || next.phase === "results") && next.phaseDeadline !== null) {
      return { ...next, phaseDeadline: Infinity };
    }
    const turn = next.turn;
    return next.currentPlayerId === learnerId && turn && !turn.completed && !turn.finalReaction && !turn.power?.pendingSwap
      ? { ...next, turn: { ...turn, deadline: Infinity } } : next;
  });
  return <div className="tutorial-practice"><RoundScreen key={session} hubId="entrainement-local" playerId={learnerId} hostId={learnerId}
    deadline={Infinity} hostRound={round} peers={localPeers} members={members} updateHostRound={updateRound}
    extraBotDiscardDelay={false} roundRating={undefined} gameFinished={!!round.result?.gameWinnerIds.length}
    connected clockVersion={0} pause={null} restarting={false} playSound={playSound} practice
    settings={<button className="tutorial-exit" type="button" onClick={() => navigate(tutorialPath)}>Quitter l’entraînement</button>}
    onLeave={() => navigate(tutorialPath)} onRestart={() => {
      setRound(newRound());
      setSession((number) => number + 1);
    }} /></div>;
}

function GuidedRound({ drills, title, navigate, playSound, onChapterComplete }: Pick<Props, "navigate" | "playSound" | "onChapterComplete"> & { drills: Drill[]; title: string }) {
  const [run, setRun] = useState(() => startDrill(drills, 0));
  const [hint, setHint] = useState(false);
  const [reading, setReading] = useState(false);
  const explanations = useRef<HTMLDialogElement>(null);
  const playedDutch = useRef<number>(-1);
  const drill = drills[run.drill];
  const step = drill.steps[run.step];
  const chapter = chapterByDrill.get(drill)!;
  const chapterDone = run.step >= drill.steps.length - 1 && chapter.drills.at(-1) === drill;
  const view = getTurnView(run.state, learnerId, run.clock);
  const result = getRoundResultView(run.state);
  const announcement = !!view?.dutch?.announcementMs;
  const feedback = useCardFeedback(view, run.drill + 1, 0, playSound);
  const canPlay = !!view && view.playerId === learnerId && !view.ending && !view.finalReaction && !announcement;
  const showGuide = hint && step?.kind === "prompt";
  const learner = view?.players.find(({ id }) => id === learnerId);
  const isMemory = run.state.phase === "memorization";
  const remembered = getMemorizedCards(run.state, learnerId);
  const memorization = isMemory ? {
    chosen: remembered.map(({ position }) => position),
    revealed: remembered.filter(({ position }) => run.visible.includes(position)),
    limit: 2,
    toggle: changeMemory,
  } : undefined;

  useEffect(() => {
    if (chapterDone) onChapterComplete(chapter.id);
  }, [chapter.id, chapterDone, onChapterComplete]);

  useEffect(() => {
    if (!announcement || playedDutch.current === run.drill) return;
    playedDutch.current = run.drill;
    playSound("dutch");
  }, [announcement, playSound, run.drill]);

  useEffect(() => {
    if (reading || step?.kind !== "wait") return;
    const timer = window.setTimeout(() => setRun((current) => {
      if (current !== run) return current;
      const clock = current.clock + step.delay;
      const state = tickDrill(current.state, step, clock);
      const completed = current.step + 1 === drill.steps.length;
      const recaps = completed ? [...current.recaps, { title: drill.title, text: step.text }] : current.recaps;
      return completed && !state.result && current.drill + 1 < drills.length
        ? startDrill(drills, current.drill + 1, recaps) : nextStep({ ...current, recaps }, state, clock);
    }), Math.max(0, step.delay - (performance.now() - run.entered)));
    return () => window.clearTimeout(timer);
  }, [drill, drills, reading, run, step]);

  function changeMemory(position: number) {
    if (step?.kind !== "prompt") return;
    const hiding = run.visible.includes(position);
    if (hiding !== (step.action === "hide")) return;
    const clock = run.clock + 1;
    if (hiding) {
      const visible = run.visible.filter((index) => index !== position);
      const state = visible.length ? run.state : beginPlay(setMemorizationReady(run.state, learnerId, true, clock, Infinity), clock);
      setRun(nextStep(run, state, clock, visible));
    } else {
      const state = memorizeCard(run.state, learnerId, position, clock, Infinity);
      if (state === run.state) return;
      setRun(nextStep(run, state, clock, [...run.visible, position]));
    }
    setHint(false);
    playSound("flip");
  }

  function act(action: TurnAction, gesture?: TutorialGesture) {
    if (step?.kind !== "prompt") return;
    if (!isExpectedAction(step, action, gesture)) {
      setRun({ ...run, notice: "Essaie le geste indiqué dans la consigne." });
      return;
    }
    const clock = run.clock + 1;
    const state = playTurn(run.state, learnerId, run.state.turn?.number, action, clock);
    if (state === run.state) return;
    setHint(false);
    setRun(nextStep(run, state, clock));
  }

  function nextDrill() {
    setHint(false);
    playedDutch.current = -1;
    setRun(startDrill(drills, run.drill + 1, run.recaps));
  }

  if (result || (!step && run.drill + 1 === drills.length)) {
    const complete = run.drill + 1 === drills.length;
    return <main className="archive-screen tutorial-menu">
      <h1>{complete ? "Exercices terminés" : "Manche terminée"}</h1>
      <TutorialRecaps recaps={run.recaps} />
      {result && <section className="tutorial-score" aria-label="Résultat de la manche d’entraînement">
        <h2>Le score le plus bas gagne</h2>
        <ul>{result.players.map(({ id, pseudo, roundScore }) =>
          <li key={id}><strong>{pseudo}</strong> <span>{roundScore} points</span></li>)}</ul>
        <p>Pour réussir Dutch, il faut être seul au score le plus bas. En cas d’égalité ou de score adverse inférieur, l’annonceur reçoit 10 points de pénalité.</p>
      </section>}
      {complete ? <p>Tu peux refaire un exercice ou essayer les gestes dans une partie libre.</p> : null}
      <div className="tutorial-end-actions">
        {!complete && <button className="tutorial-primary" type="button" onClick={nextDrill}>Exercice suivant</button>}
        <button className="tutorial-primary" type="button" onClick={() => navigate(`${tutorialPath}/libre`)}>Jouer une partie libre</button>
        <button type="button" onClick={() => navigate(tutorialPath)}>Choisir un exercice</button>
      </div>
    </main>;
  }

  const power = view?.power;
  const canTry = step?.kind === "prompt" && canPlay;
  const players = view?.players ?? run.state.players.map(({ id, pseudo, cards }) => ({ id, pseudo, cardCount: cards.length }));
  const reaction = view && learner && step?.kind === "prompt" && step.action === "reaction"
    ? { scope: `${run.drill}:${view.reaction.reference}:${learner.handVersion}`, play: (position: number, gesture: TutorialGesture) => {
      const action = { kind: "reaction", position, reference: view.reaction.reference, handVersion: learner.handVersion } as const;
      act(action, gesture);
    } } : undefined;
  const control = view ? { view, canPlay: canTry, act } : null;
  const guideTarget = showGuide ? step.target ?? (isMemory ? {
    playerId: learnerId, position: step.action === "hide" ? run.visible[0] : [0, 1, 2, 3].find((index) => !memorization?.chosen.includes(index)) ?? 0,
  } : undefined) : undefined;

  return <main className="game-screen table-screen tutorial-game" data-hint={showGuide ? step.hint : undefined}>
    <section className="tutorial-coach" aria-label="Consigne du didacticiel">
      <header>
        <button type="button" aria-label="Choisir un exercice" title="Choisir un exercice" onClick={() => navigate(tutorialPath)}>
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <h1>{title} <small>· {run.drill + 1}/{drills.length}</small></h1>
        <button type="button" aria-label="Relire les explications" title="Relire les explications"
          onClick={() => { explanations.current?.showModal(); setReading(true); }}><BookOpen size={17} aria-hidden="true" /></button>
        <button type="button" aria-label="Recommencer cet exercice" title="Recommencer cet exercice" onClick={() => {
          playedDutch.current = -1;
          setHint(false);
          setRun(startDrill(drills, run.drill, run.recaps));
        }}><RotateCcw size={17} aria-hidden="true" /></button>
        <button type="button" aria-label="Indice" title="Indice" aria-pressed={hint} onClick={() => setHint(!hint)}
          disabled={step?.kind !== "prompt"}><Lightbulb size={18} aria-hidden="true" /></button>
      </header>
      <strong>{drill.title}</strong>
      <p role="status">{step?.text}{run.notice && <span className="tutorial-notice">{run.notice}</span>}</p>
    </section>
    <dialog ref={explanations} className="hub-management tutorial-explanations" aria-labelledby="tutorial-explanations-title"
      onClose={() => setReading(false)}>
      <h2 id="tutorial-explanations-title">Explications du didacticiel</h2>
      <p>{chapter.description}</p>
      {drill.steps[0] !== step && <p>{drill.steps[0].text}</p>}
      <p>{step?.text}</p>
      <TutorialRecaps recaps={run.recaps} />
      <form method="dialog"><button type="submit">Reprendre l’exercice</button></form>
    </dialog>
    <GameTable key={run.drill} localPlayerId={learnerId} players={players} members={memberById} memorization={memorization}
      activePlayerId={view?.playerId} playSound={playSound} guideTarget={guideTarget} reaction={reaction}
      cardMotion={view?.cardMotion} drawnCard={view?.drawnCard ?? undefined}
      botDrawingId={view?.hasDrawn && view.playerId !== learnerId ? view.playerId : undefined}
      protectedPlayerId={view?.dutch?.announcerId} exchangeTargets={power?.exchangeTargets}
      dutchControl={view?.canAnnounceDutch && !announcement && step?.kind === "prompt" ? {
        armed: view.dutchArmed, toggle: () => act({ kind: "dutch-intent", enabled: !view.dutchArmed }),
      } : undefined}
      onReplace={canTry && learner && view?.hasDrawn ? (position, gesture) =>
        act({ kind: "replace", position, handVersion: learner.handVersion }, gesture) : undefined}
      onDiscardDrawn={canTry && view?.hasDrawn ? () => act({ kind: "discard" }, "drag") : undefined}
      look={power?.lookTarget ? { target: power.lookTarget, remaining: view?.remainingMs ?? 0 } : undefined}
      power={power?.selection && canTry ? {
        kind: power.kind, selection: power.selection,
        chooseCard: (target) => {
          const hand = view?.players.find(({ id }) => id === target.playerId);
          if (hand) act({ kind: "power-card", target, handVersion: hand.handVersion });
        },
        choosePlayer: (id) => act({ kind: "power-player", playerId: id }, "keyboard"),
        hideCard: () => act({ kind: "power-hide" }),
      } : undefined}
      piles={control ? null : undefined}
      controls={control ? <TurnPanel {...control} remaining={view?.remainingMs ?? 0}
        displayName={(_id, name) => name} dutchAnnouncement={announcement ? "Toi" : undefined}
        piles={<TurnPiles {...control} act={(action) => act(action, action.kind === "power-player" ? "drag" : "tap")}
          feedback={feedback} onGiftSlide={() => playSound("slide")} />} />
        : <strong className="round-panel">Mémorisation</strong>}
    />
  </main>;
}

function TutorialRecaps({ recaps }: { recaps: Run["recaps"] }) {
  if (!recaps.length) return null;
  const latest = recaps.at(-1)!;
  return <section className="tutorial-recaps" aria-label="Récapitulatif des exercices">
    <h2>{latest.title}</h2>
    <p>{latest.text}</p>
    {recaps.length > 1 && <details>
      <summary>Relire les exercices précédents</summary>
      {recaps.slice(0, -1).map(({ title, text }, index) => <p key={`${index}:${title}`}><strong>{title}. </strong>{text}</p>)}
    </details>}
  </section>;
}

export default function TutorialScreen({ section, navigate, playSound, completed, onChapterComplete }: Props) {
  if (section === "libre") return <PracticeRound navigate={navigate} playSound={playSound} />;
  const chapter = tutorialChapters.find(({ id }) => id === section);
  const drills = section === "complet" ? allTutorialDrills : chapter?.drills;
  return drills ? <GuidedRound title={chapter?.title ?? "Parcours complet"} drills={drills} navigate={navigate} playSound={playSound}
    onChapterComplete={onChapterComplete} /> : <TutorialMenu navigate={navigate} completed={completed} unknown={!!section} />;
}
