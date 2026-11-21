import assert from "node:assert/strict";
import test from "node:test";
import type { Card, CardRank, Suit } from "../src/game/cards.ts";
import { createRound } from "../src/game/createRound.ts";
import type { GameState, PowerKind } from "../src/game/gameTypes.ts";
import { getRoundResultView } from "../src/game/hands.ts";
import { matchesDiscard, presentDiscard } from "../src/game/reactions.ts";
import { beginPlay, expireTurn, getTurnView, playTurn } from "../src/game/turn.ts";
import { DEFAULT_VARIANTS, type GameVariants } from "../src/game/variants.ts";

const players = ["alice", "bob", "charlie"].map((id) => ({ id, pseudo: id, totalScore: 0 }));
const card = (id: string, rank: CardRank, suit: Suit = "spades"): Card => ({ id, rank, suit });

function setup(hands: Card[][], reference: Card, deck: Card[], variants: Partial<GameVariants> = {}) {
  const state = beginPlay(createRound(players, { ...DEFAULT_VARIANTS, ...variants }, 100), 0, () => 0);
  return presentDiscard({
    ...state,
    drawPile: deck,
    players: state.players.map((player, index) => ({ ...player, cards: hands[index] })),
  }, [reference]);
}

function attempt(state: GameState, playerId: string, position: number, reference = state.reaction.reference) {
  const handVersion = state.players.find(({ id }) => id === playerId)?.handVersion;
  return playTurn(state, playerId, state.turn?.number, { kind: "reaction", reference, position, handVersion }, 1_000);
}

function withPower(state: GameState, kind: PowerKind): GameState {
  return { ...state, turn: { ...state.turn!, power: { kind, selected: [] } } };
}

function choose(state: GameState, playerId: string, position: number, handVersion?: number) {
  return playTurn(state, "alice", state.turn?.number, {
    kind: "power-card",
    target: { playerId, position },
    handVersion: handVersion ?? state.players.find(({ id }) => id === playerId)?.handVersion,
  }, 1_000);
}

test("la variante +1/-1 gère As et Roi et garde le Joker hors de la suite", () => {
  assert.equal(matchesDiscard("A", "K", false), false);
  assert.equal(matchesDiscard("A", "K", true), true);
  assert.equal(matchesDiscard("K", "A", true), true);
  assert.equal(matchesDiscard("Q", "K", true), true);
  assert.equal(matchesDiscard("J", "K", true), false);
  assert.equal(matchesDiscard("JOKER", "A", true), false);
  assert.equal(matchesDiscard("JOKER", "JOKER", false), true);
});

test("la première réaction valide remplace la référence et bloque les tentatives concurrentes", () => {
  const start = setup(
    [[card("a-a", "A")], [card("b-8", "8"), card("b-2", "2")], [card("c-8", "8")]],
    card("top", "8"), [card("pen", "7")]
  );
  const winner = attempt(start, "bob", 0);
  assert.equal(winner.discardPile.at(-1)?.id, "b-8");
  assert.equal(winner.turn?.power, null);
  assert.equal(winner.currentPlayerId, "alice");
  assert.equal(winner.reaction.reference, start.reaction.reference + 1);
  assert.equal(attempt(winner, "charlie", 0, start.reaction.reference), winner);
  assert.equal(attempt(winner, "alice", 0, start.reaction.reference), winner);
  assert.equal(winner.drawPile.length, 1);
});

test("la carte de référence reste visible après un recyclage de la défausse", () => {
  const start = setup(
    [[card("a-a", "A")], [card("b-8", "8"), card("b-2", "2")], [card("c-8", "8")]],
    card("top", "8"), []
  );
  const attempt = { kind: "reaction", position: 0, reference: start.reaction.reference, handVersion: 0 };
  const changed = playTurn(start, "bob", 1, attempt, 1_000);
  assert.deepEqual(playTurn(start, "bob", 1, attempt, 61_000), changed);
  assert.equal(changed.discardPile.at(-1)?.id, "b-8");
  assert.equal(playTurn(changed, "alice", 1,
    { kind: "draw", source: "discard", reference: start.reaction.reference }, 1_001), changed);
  const drawn = playTurn(changed, "alice", 1, { kind: "draw", source: "deck" }, 1_001);
  assert.equal(drawn.turn?.drawnCard?.id, "top");
  assert.equal(drawn.reaction.reference, changed.reaction.reference);
  assert.equal(drawn.discardPile.at(-1)?.id, "b-8");
});

test("une tentative incorrecte garde la carte et donne une seule pénalité cachée", () => {
  const start = setup(
    [[card("a-2", "2")], [card("b-4", "4")], [card("c-7", "7")]],
    card("top", "4"), []
  );
  const hidden = card("hidden-penalty", "J", "hearts");
  const state = { ...start, discardPile: [hidden, ...start.discardPile] };
  const penalized = attempt(state, "alice", 0);
  assert.deepEqual(penalized.players[0].cards, [state.players[0].cards[0], hidden]);
  assert.equal(penalized.discardPile.at(-1)?.id, "top");
  assert.equal(penalized.reaction.reference, state.reaction.reference);
  assert.equal(penalized.phase, "playing");
  assert.equal(penalized.reaction.notice?.outcome, "penalty");
  assert.deepEqual(getTurnView(penalized, "bob", 1_001)?.cardMotion?.move,
    { kind: "penalty", target: { playerId: "alice", position: 1 } });
  assert.doesNotMatch(JSON.stringify(getTurnView(penalized, "alice", 1_001)), /hidden-penalty|"rank":"J"/);
  assert.equal(playTurn(penalized, "alice", 1,
    { kind: "reaction", position: 0, reference: penalized.reaction.reference, handVersion: 0 }, 1_005), penalized);
  assert.equal(attempt(penalized, "alice", 0).reaction.notice?.outcome, "empty-pile");
});

test("retirer une carte conserve les emplacements et la pénalité réutilise la place libre", () => {
  const start = setup([
    [card("a-2", "2"), card("a-4", "4"), card("a-6", "6"), card("a-8", "8")],
    [card("b-4", "4")], [card("c-7", "7")],
  ], card("top", "4"), [card("first-penalty", "3"), card("second-penalty", "10")], { infinitePose: true });
  const removed = attempt(start, "alice", 1);
  assert.deepEqual(removed.players[0].handLayout, { columns: 2, slots: [0, 1, 3] });
  const filled = attempt(removed, "alice", 0);
  assert.deepEqual(filled.players[0].handLayout, { columns: 2, slots: [0, 1, 3, 2] });
  const expanded = attempt(filled, "alice", 0);
  assert.deepEqual(expanded.players[0].handLayout, { columns: 3, slots: [0, 1, 3, 2, 4] });
});

test("la pose infinie autorise deux réussites consécutives du même joueur", () => {
  const start = setup(
    [[card("a-7", "7")], [card("b-6", "6"), card("b-7", "7"), card("b-2", "2")], [card("c-7", "7")]],
    card("top", "5"), [], { plusMinusOne: true }
  );
  const once = attempt(start, "bob", 0);
  assert.equal(once.discardPile.at(-1)?.rank, "6");
  assert.equal(attempt(once, "bob", 0), once);
  const infinite = { ...once, variants: { ...once.variants, infinitePose: true } };
  const twice = attempt(infinite, "bob", 0);
  assert.equal(twice.discardPile.at(-1)?.rank, "7");
  assert.equal(twice.players[1].cards.length, 1);
  const reset = presentDiscard(once, [...once.discardPile, card("normal", "8")]);
  assert.equal(getTurnView(reset, "bob", 1_000)?.reaction.canAttempt, true);
});

test("une réaction prioritaire retire une cible en attente et invalide la position affichée", () => {
  const start = withPower(setup(
    [[card("a-4", "4")], [card("b-10", "10"), card("b-2", "2")], [card("c-3", "3")]],
    card("top", "10"), []
  ), "blind-swap");
  const firstTarget = choose(start, "bob", 0);
  const reacted = attempt(firstTarget, "bob", 0);
  assert.equal(getTurnView(reacted, "alice", 1_001)?.power?.selection?.remaining, 2);
  assert.equal(choose(reacted, "bob", 0, 0), reacted);
  const retargeted = choose(choose(reacted, "bob", 0), "alice", 0);
  assert.equal(retargeted.players[0].cards[0].id, "b-2");
  assert.equal(retargeted.players[1].cards[0].id, "a-4");
  assert.equal(retargeted.discardPile.at(-1)?.id, "b-10");
});

test("un Valet aux deux cibles validées garde la priorité sur ces cartes", () => {
  const start = withPower(setup(
    [[card("a-2", "2")], [card("b-j1", "J"), card("b-j2", "J"), card("b-3", "3")], [card("c-4", "4")]],
    card("top", "J"), []
  ), "look-and-swap");
  const locked = choose(choose(start, "alice", 0), "bob", 1);
  assert.equal(attempt(locked, "bob", 1), locked);
  const unrelated = attempt(locked, "bob", 0);
  assert.equal(unrelated.discardPile.at(-1)?.id, "b-j1");
  const swapped = playTurn(unrelated, "alice", 1, { kind: "power-swap" }, 1_001);
  assert.equal(swapped.players[0].cards[0].id, "b-j2");
  assert.equal(swapped.players[1].cards[0].id, "a-2");
});

test("la dernière carte met fin à la manche et un autre score nul gagne", () => {
  const start = setup(
    [[card("black-king", "K", "clubs")], [card("emptying", "K", "hearts")], [card("queen", "Q")]],
    card("top", "K", "diamonds"), []
  );
  const result = attempt(start, "bob", 0);
  assert.equal(result.phase, "results");
  assert.equal(result.turn, null);
  assert.equal(expireTurn(result, 1, 60_000), result);
  assert.equal(getTurnView(result, "alice", 1_001), null);
  assert.deepEqual(result.players.map(({ roundScore, totalScore }) => [roundScore, totalScore]),
    [[0, 0], [10, 10], [12, 12]]);
  assert.deepEqual(getRoundResultView(result)?.winnerIds, ["alice"]);
});
