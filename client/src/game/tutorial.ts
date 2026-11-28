import type { Card, CardRank, Suit } from "./cards.ts";
import { createRound } from "./createRound.ts";
import type { CardTarget, GameState } from "./gameTypes.ts";
import { beginPlay, DUTCH_GRACE_MS, expireTurn, playTurn, type TurnAction } from "./turn.ts";
import { DEFAULT_VARIANTS, type GameVariants } from "./variants.ts";

export const learnerId = "apprenti";
const nora = "nora";
const milo = "milo";
export const practicePlayers = [
  { id: learnerId, pseudo: "Toi", totalScore: 0 },
  { id: nora, pseudo: "Nora", totalScore: 0, isBot: true },
  { id: milo, pseudo: "Milo", totalScore: 0, isBot: true },
] satisfies Parameters<typeof createRound>[0];

export type TutorialGesture = "tap" | "drag" | "triple-tap" | "keyboard";
type Prompt = {
  kind: "prompt";
  text: string;
  action: TurnAction["kind"] | "memorize" | "hide";
  hint?: "draw" | "drawn" | "discard" | "discard-drag" | "dutch" | "swap" | "pass" | "gift";
  target?: CardTarget;
  gesture?: TutorialGesture;
  timed?: true;
};
type Automatic = {
  kind: "wait";
  text: string;
  delay: number;
  operation?: "draw" | "discard" | "expire";
};
type Step = Prompt | Automatic;
type Drill = {
  title: string;
  steps: Step[];
  deck?: CardRank[];
  hand?: CardRank[];
  botFirst?: true;
  variants?: Partial<GameVariants>;
  memory?: true;
};
type Chapter = { id: string; title: string; description: string; drills: Drill[] };

const own = (position: number): CardTarget => ({ playerId: learnerId, position });
const noraCard: CardTarget = { playerId: nora, position: 0 };
const prompt = (text: string, action: Prompt["action"], options: Omit<Prompt, "kind" | "text" | "action"> = {}): Prompt =>
  ({ kind: "prompt", text, action, ...options });
const wait = (text: string, delay: number, operation?: Automatic["operation"]): Automatic =>
  ({ kind: "wait", text, delay, operation });
const draw = (text = "Touche la pioche pour prendre une carte."): Prompt => prompt(text, "draw", { hint: "draw" });
const discard = (text: string, gesture?: TutorialGesture) => prompt(text, "discard", {
  hint: gesture === "drag" ? "discard-drag" : "discard", gesture,
});
const select = (text: string, target: CardTarget) => prompt(text, "power-card", { target });
const finish = (text: string, delay = 800) => wait(text, Math.max(delay, Math.min(3_500, 550 + text.split(/\s+/).length * 130)));
const introducePower = (rank: string): Step[] => [
  draw(), discard(`Pose ${rank} sur la défausse pour activer son pouvoir.`),
];
const reaction = (text: string, position: number, gesture?: TutorialGesture) =>
  prompt(text, "reaction", { target: own(position), gesture });
const botTurn = (): Step[] => [
  wait("Nora pioche.", 650, "draw"),
  wait("Nora va poser une carte. Observe la défausse.", 950, "discard"),
];
const goodReaction = (gesture: TutorialGesture): Drill => ({
  title: gesture === "drag" ? "Glisser vers le centre" : "Trois appuis rapides",
  botFirst: true,
  deck: ["6"],
  hand: ["6", "A", "3", "2"],
  steps: [
    ...botTurn(),
    reaction(gesture === "drag"
      ? "Nora a posé un 6. Glisse ton 6 (carte 1) vers le centre."
      : "Nora a posé un 6. Touche ta carte 1 trois fois rapidement. C’est aussi un 6.", 0, gesture),
    finish("Ta carte rejoint la défausse. Au clavier, sélectionne ta carte puis appuie sur R.", 1_200),
  ],
});
const look = (rank: "8" | "9", target: CardTarget): Drill => ({
  title: rank === "8" ? "8 · Regarder chez soi" : "9 · Regarder chez un autre",
  deck: [rank],
  steps: [
    ...introducePower(rank === "8" ? "le 8" : "le 9"),
    select(rank === "8" ? "Touche ta carte 1 pour la regarder." : "Touche la carte 1 de Nora pour la regarder.", target),
    prompt("Toi seul vois la valeur. Touche la carte retournée pour la cacher et terminer le pouvoir.", "power-hide", { target }),
    finish("En partie, une carte consultée avec le 8 ou le 9 se cache au bout de 10 secondes."),
  ],
});
const valet = (swap: boolean): Drill => ({
  title: swap ? "Valet · Confirmer l’échange" : "Valet · Annuler l’échange",
  deck: ["J"],
  steps: [
    ...introducePower("le Valet"),
    select("Choisis d’abord ta carte 1.", own(0)),
    select("Choisis la carte 1 de Nora. La valeur des deux cartes est révélée pour toi.", noraCard),
    swap ? prompt("Touche les flèches pour échanger les deux cartes.", "power-swap", { hint: "swap" })
      : prompt("Touche la croix pour laisser les deux cartes en place.", "power-pass", { hint: "pass" }),
    finish(swap ? "Les cartes voyagent face cachée. Les autres voient les deux emplacements." : "Les cartes se retournent et restent à leur place.", swap ? 1_200 : 650),
  ],
});

export const tutorialChapters: Chapter[] = [
  {
    id: "memorisation", title: "Mémorisation", description: "Regarder et retourner deux cartes.",
    drills: [{
      title: "Découvrir ta main", memory: true,
      steps: [
        prompt("Le score le plus bas gagne. Pour commencer, touche une de tes quatre cartes.", "memorize"),
        prompt("Choisis une deuxième carte. Pendant la mémorisation, tu peux revoir les deux cartes choisies.", "memorize"),
        prompt("Touche l’une des cartes visibles pour la retourner face cachée.", "hide"),
        prompt("Retourne la dernière carte visible. La manche peut commencer dès que les joueurs ont terminé.", "hide"),
        finish("Tu connais maintenant deux cartes. Avec la variante 6 cartes, tu peux en mémoriser trois."),
      ],
    }],
  },
  {
    id: "poser", title: "Piocher et poser", description: "Remplacer ou défausser, en touchant ou en glissant.",
    drills: [
      { title: "Remplacer en glissant", deck: ["A"], steps: [
        draw(), prompt("Glisse l’As pioché sur ta carte 1. La carte remplacée va dans la défausse.", "replace",
          { target: own(0), hint: "drawn", gesture: "drag" }),
        finish("Tu gardes l’As, qui vaut 1 point."),
      ] },
      { title: "Remplacer en touchant", deck: ["2"], steps: [
        draw(), prompt("Touche directement ta carte 1. Le 2 pioché prendra sa place.", "replace", { target: own(0), gesture: "tap" }),
        finish("Toucher la carte à remplacer produit le même résultat que glisser la carte piochée."),
      ] },
      { title: "Défausser en glissant", deck: ["Q"], steps: [
        draw(), discard("Glisse la Dame piochée vers la défausse pour la jeter.", "drag"),
        finish("Ta main reste telle quelle. La Dame vaut 12 points."),
      ] },
      { title: "Défausser en touchant", deck: ["Q"], steps: [
        draw(), discard("Touche directement la défausse pour y poser la Dame.", "tap"),
        finish("Tu pioches toujours dans la pioche. La défausse sert à recevoir les cartes."),
      ] },
    ],
  },
  {
    id: "reactions", title: "Réagir à la défausse", description: "Trois appuis, glisser, et comprendre les pénalités.",
    drills: [
      goodReaction("triple-tap"), goodReaction("drag"),
      { title: "Reconnaître une erreur", botFirst: true, deck: ["6", "Q"], hand: ["2", "6", "A", "4"], steps: [
        ...botTurn(),
        reaction("Pour voir la pénalité, tente la réaction avec ta carte 1 (un 2) sur le 6.", 0),
        finish("Ton 2 reste en main et une carte de pénalité s’ajoute. La première réaction valide prime. Elle ne déclenche aucun pouvoir.", 1_250),
      ] },
    ],
  },
  {
    id: "visions", title: "8 et 9", description: "Consulter une carte puis la retourner.",
    drills: [look("8", own(0)), look("9", noraCard), { title: "Passer un pouvoir", deck: ["8"], steps: [
      ...introducePower("le 8"), prompt("Avant de choisir une carte, touche la croix pour passer ce pouvoir.", "power-pass", { hint: "pass" }),
      finish("Tu peux passer un pouvoir quand tu n’en as pas besoin."),
    ] }],
  },
  {
    id: "echanges", title: "10 et Valet", description: "Échanger à l’aveugle, regarder, confirmer ou annuler.",
    drills: [
      { title: "10 · Échanger face cachée", deck: ["10"], steps: [
        ...introducePower("le 10"), select("Choisis ta carte 1. Les autres voient le surlignage.", own(0)),
        select("Choisis la carte 1 de Nora. Le 10 échange les deux cartes sans les montrer.", noraCard),
        wait("Les deux cartes sont sélectionnées.", 500, "expire"), finish("Les autres voient l’échange. Tu peux aussi échanger deux cartes d’une même main.", 1_250),
      ] },
      valet(true), valet(false),
    ],
  },
  {
    id: "joker", title: "Joker+", description: "Ajouter une carte face cachée à un adversaire.",
    drills: [{ title: "Donner une carte", variants: { jokerPlus: true }, deck: ["JOKER", "5"], steps: [
      ...introducePower("le Joker"),
      prompt("Glisse la carte de la pioche vers Nora pour lui donner une carte.", "power-player",
        { hint: "gift", target: noraCard, gesture: "drag" }),
    finish("Nora reçoit une carte face cachée qui comptera dans son score. Au clavier, choisis le nom du destinataire.", 1_400),
    ] }],
  },
  {
    id: "variantes", title: "+1/−1 et Pose infinie", description: "S’entraîner aux deux variantes de réaction.",
    drills: [
      { title: "+1/−1 · Le rang voisin", botFirst: true, variants: { plusMinusOne: true }, deck: ["6"], hand: ["7", "6", "A", "2"], steps: [
        ...botTurn(), reaction("Nora pose un 6. Réagis avec ton 7 (carte 1). Avec cette variante, un autre 6 donne une pénalité.", 0),
        finish("Le 5 et le 7 sont les voisins du 6. La suite est circulaire entre le Roi et l’As."),
      ] },
      { title: "Pose infinie · Enchaîner", botFirst: true, variants: { infinitePose: true }, deck: ["6"], hand: ["6", "6", "A", "2"], steps: [
        ...botTurn(), reaction("Réagis au 6 avec ton premier 6 (carte 1).", 0),
        reaction("Le 6 que tu viens de poser devient la nouvelle référence. Réagis avec ton deuxième 6, maintenant carte 1.", 0),
        finish("Pose infinie permet de poursuivre la chaîne, même pour le même joueur."),
      ] },
    ],
  },
  {
    id: "dutch", title: "Annoncer Dutch", description: "Armer Dutch, essayer les 0,5 s et lire le score final.",
    drills: [
      { title: "Annoncer pendant ton tour", deck: ["Q"], steps: [
        draw(), prompt("Touche le mégaphone à côté de ton nom pour armer Dutch.", "dutch-intent", { hint: "dutch" }),
        discard("Défausse la Dame. L’annonce se déclenche à la fin du tour."),
        finish("Dutch est annoncé. Les autres joueurs ont chacun un dernier tour.", 2_850),
      ] },
      { title: "Repérer l’icône après la défausse", deck: ["Q"], steps: [
        draw(), discard("Défausse la Dame. Repère l’icône Dutch près de ton nom."),
        prompt("Touche le mégaphone maintenant. Cette répétition suspend le chrono.", "dutch-intent", { hint: "dutch" }),
        wait("Ton annonce est prête.", DUTCH_GRACE_MS, "expire"),
        finish("En partie, tu as 0,5 s après ton tour pour activer Dutch.", 2_850),
      ] },
      { title: "Défi Dutch · 0,5 seconde", deck: ["Q", "3", "4"], hand: ["K", "A", "2", "3"], steps: [
        draw(), discard("Défausse la Dame, puis touche immédiatement le mégaphone. Tu auras 0,5 s."),
        prompt("Touche le mégaphone maintenant !", "dutch-intent", { hint: "dutch", timed: true }),
        wait("Ton annonce est prête.", DUTCH_GRACE_MS, "expire"),
        wait("Dutch ! Les deux bots ont encore un tour. Tu es protégé des échanges et du Joker+.", 2_850),
        wait("Nora pioche pour son dernier tour.", 650, "draw"), wait("Nora défausse.", 900, "discard"),
        wait("Milo pioche pour son dernier tour.", 650, "draw"), wait("Milo défausse.", 900, "discard"),
        wait("La dernière défausse reste réactive trois secondes.", 3_000, "expire"),
      ] },
    ],
  },
];

export const allTutorialDrills = tutorialChapters.flatMap(({ drills }) => drills);
const suits: Suit[] = ["spades", "hearts", "clubs", "diamonds"];
const makeCards = (ranks: CardRank[], prefix: string, offset = 0): Card[] =>
  ranks.map((rank, index) => ({ id: `${prefix}-${index}`, rank, suit: rank === "JOKER" ? undefined : suits[(index + offset) % 4] }));

export function setupDrill(drill: Drill) {
  const round = createRound(practicePlayers, { ...DEFAULT_VARIANTS, ...drill.variants }, null);
  const fixed: GameState = {
    ...round,
    players: round.players.map((player, index) => ({
      ...player, cards: makeCards(index === 0 ? drill.hand ?? ["Q", "5", "3", "A"]
        : index === 1 ? ["8", "Q", "5", "A"] : ["9", "8", "4", "2"], player.id, index),
    })),
    drawPile: [...makeCards(["2", "3", "4", "5"], "reserve"), ...makeCards(drill.deck ?? [], "draw").reverse()],
    openingPlayerId: drill.botFirst ? nora : learnerId,
  };
  return drill.memory ? fixed : beginPlay(fixed, 0);
}

export function tickDrill(state: GameState, step: Automatic, now: number): GameState {
  if (!step.operation || !state.turn || !state.currentPlayerId) return state;
  if (step.operation === "expire") return expireTurn(state, state.turn.number, now);
  return playTurn(state, state.currentPlayerId, state.turn.number,
    step.operation === "draw" ? { kind: "draw", source: "deck" } : { kind: "discard" }, now);
}

export function isExpectedAction(step: Step, action: TurnAction, gesture?: TutorialGesture): boolean {
  if (step.kind !== "prompt" || step.action !== action.kind ||
      (step.gesture && step.gesture !== gesture && gesture !== "keyboard")) return false;
  if (!step.target || action.kind === "power-hide") return true;
  if (action.kind === "power-card") return action.target.position === step.target.position && action.target.playerId === step.target.playerId;
  if (action.kind === "power-player") return action.playerId === step.target.playerId;
  return (action.kind === "reaction" || action.kind === "replace") && action.position === step.target.position;
}
