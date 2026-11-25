import assert from "node:assert/strict";
import test from "node:test";
import { GAME_CONFIG } from "../src/config/gameConfig.ts";
import type { CardRank } from "../src/game/cards.ts";
import { createRound } from "../src/game/createRound.ts";
import { resumeGameClock } from "../src/game/gameClock.ts";
import { finishRound, getRoundLeaders, getRoundResultView, rankPlayers } from "../src/game/hands.ts";
import { advanceRoundSetup, startNextRound, toggleNextVariant } from "../src/game/roundCycle.ts";
import { beginPlay, playTurn } from "../src/game/turn.ts";
import { DEFAULT_VARIANTS } from "../src/game/variants.ts";

const ids = ["alice", "bob", "charlie"];
const onlineMembers = (...playerIds: string[]) => playerIds.map((id) => ({ id, pseudo: id, connected: true }));
const members = onlineMembers(...ids);
const finishedAt = 1_000;

function completedRound(totals: number[], ranks: CardRank[], threshold: number | null) {
  const players = ids.map((id, index) => ({ id, pseudo: id, totalScore: totals[index] }));
  const state = beginPlay(createRound(players, DEFAULT_VARIANTS, threshold), 0, () => 0);
  return finishRound({
    ...state,
    players: state.players.map((player, index) => ({
      ...player, cards: [{ id: player.id, rank: ranks[index], suit: "hearts" }],
    })),
  }, finishedAt);
}

test("au seuil exact, le plus petit total remporte la partie et les égalités sont conservées", () => {
  const result = completedRound([22, 49, 21], ["A", "A", "2"], 50);
  assert.deepEqual(result.result?.gameWinnerIds, ["alice", "charlie"]);
  assert.equal(result.phaseDeadline, null);
  assert.deepEqual(getRoundResultView(result)?.players.map(({ totalScore }) => totalScore), [23, 50, 23]);
  const observerView = getRoundResultView(result, false);
  assert.deepEqual(observerView?.players.map(({ roundScore, totalScore, cards }) => ({ roundScore, totalScore, cards })), [
    { roundScore: 1, totalScore: 23, cards: [] },
    { roundScore: 1, totalScore: 50, cards: [] },
    { roundScore: 2, totalScore: 23, cards: [] },
  ]);
  assert.deepEqual(rankPlayers(result.players).map(({ player, rank }) => [player.id, rank]),
    [["alice", 1], ["charlie", 1], ["bob", 3]]);
  assert.equal(startNextRound(result, 1, members, 1_100), result);
  const nextVariants = toggleNextVariant(result, 1, "sixCards");
  assert.equal(nextVariants.result?.nextVariants.sixCards, true);
  assert.equal(nextVariants.variants.sixCards, false);
  assert.deepEqual(nextVariants.result?.gameWinnerIds, result.result?.gameWinnerIds);
  assert.equal(finishRound(result, 1_100), result);
});

test("les couronnes distinguent tous les joueurs à égalité en tête à partir de la deuxième manche", () => {
  const result = completedRound([22, 29, 21], ["A", "A", "2"], 100);
  assert.deepEqual(getRoundLeaders(result), []);
  const next = startNextRound(result, 1, members, 1_100);
  assert.deepEqual(getRoundLeaders(next), ["alice", "charlie"]);
  const withDeparture = { ...next, players: next.players.map((player) =>
    player.id === "alice" ? { ...player, hasLeft: true } : player) };
  assert.deepEqual(getRoundLeaders(withDeparture), ["charlie"]);
});

test("en illimité les résultats durent soixante secondes et les variantes s'appliquent à la manche suivante", () => {
  const result = completedRound([110, 120, 130], ["2", "2", "5"], null);
  const deadline = finishedAt + GAME_CONFIG.round.resultsMs;
  assert.ok(!result.result?.gameWinnerIds.length);
  assert.equal(result.phaseDeadline, deadline);
  assert.equal(toggleNextVariant(result, 2, "sixCards"), result);
  const sixCards = toggleNextVariant(result, 1, "sixCards");
  const jokers = toggleNextVariant(sixCards, 1, "jokerPlus");
  assert.equal(jokers.variants.sixCards, false);
  assert.equal(jokers.result?.nextVariants.sixCards, true);
  assert.equal(advanceRoundSetup(jokers, 1, members, deadline - 1), jokers);
  assert.equal(advanceRoundSetup(jokers, 1, onlineMembers("alice"), deadline), jokers);
  const next = advanceRoundSetup(jokers, 1, members, deadline);
  assert.equal(next.roundNumber, 2);
  assert.equal(next.phase, "dealing");
  assert.equal(next.phaseDeadline, deadline + GAME_CONFIG.round.dealingMs);
  assert.equal(next.openingPlayerId, "bob");
  assert.equal(next.endThreshold, null);
  assert.deepEqual(next.players.map(({ cards, roundScore, totalScore, scoreHistory }) =>
    [cards.length, roundScore, totalScore, scoreHistory]), [
    [6, 0, 112, [112]], [6, 0, 122, [122]], [6, 0, 135, [135]],
  ]);
  const cards = [...next.drawPile, ...next.players.flatMap((player) => player.cards)];
  assert.equal(cards.filter(({ rank }) => rank === "JOKER").length, 2);
  assert.equal(new Set(cards.map(({ id }) => id)).size, 54);
});

test("l'hôte peut démarrer la distribution et la mémorisation commence à son terme", () => {
  const result = completedRound([5, 5, 0], ["2", "2", "6"], 100);
  const next = startNextRound(result, 1, members, 1_200, () => 0.999);
  assert.equal(next.openingPlayerId, "bob");
  const dealingDeadline = 1_200 + GAME_CONFIG.round.dealingMs;
  assert.equal(advanceRoundSetup(next, 2, members, dealingDeadline - 1), next);
  assert.equal(advanceRoundSetup(next, 1, members, dealingDeadline), next);
  const memorization = advanceRoundSetup(next, 2, members, dealingDeadline);
  assert.equal(memorization.phase, "memorization");
  assert.equal(memorization.phaseDeadline, dealingDeadline + GAME_CONFIG.round.memorizationMs);
  const playing = beginPlay(memorization, memorization.phaseDeadline!, () => 0);
  assert.equal(playing.currentPlayerId, "bob");
  const secondResult = finishRound(playing, 40_000);
  assert.deepEqual(secondResult.players[1].scoreHistory, [7, secondResult.players[1].totalScore]);
});

test("la manche suivante conserve la place d’un joueur déconnecté et retire celui qui a quitté", () => {
  const result = completedRound([5, 5, 0], ["2", "2", "6"], 100);
  const next = startNextRound(result, 1, onlineMembers("alice", "bob"), 1_200);
  assert.deepEqual(next.players.map(({ id }) => id), ids);
  assert.equal(next.players[2].cards.length, 4);
  assert.equal(next.players[2].totalScore, result.players[2].totalScore);

  const afterLeave = {
    ...result,
    players: result.players.map((player) => player.id === "charlie" ? { ...player, hasLeft: true } : player),
  };
  const afterDeparture = startNextRound(afterLeave, 1, onlineMembers("alice", "bob"), 1_200);
  assert.deepEqual(afterDeparture.players.map(({ id }) => id), ["alice", "bob"]);
  const finishedSecond = finishRound({ ...afterDeparture, phase: "playing" }, 10_000);
  const rejoined = startNextRound(finishedSecond, 2, members, 10_100);
  const charlie = rejoined.players.find(({ id }) => id === "charlie")!;
  assert.equal(charlie.totalScore, result.players[2].totalScore);
  assert.deepEqual(charlie.scoreHistory, result.players[2].scoreHistory);
});

test("la manche suivante admet les nouveaux joueurs en ligne au plus haut total de la manche écoulée", () => {
  const result = completedRound([5, 25, 0], ["2", "5", "6"], 100);
  const roster = [
    ...onlineMembers("alice", "dana", "eli"),
    { id: "bob", pseudo: "bob", connected: false },
    { id: "fiona", pseudo: "fiona", connected: false },
  ];
  const state = {
    ...result,
    players: result.players.map((player) => player.id === "charlie" ? { ...player, hasLeft: true } : player),
  };
  const next = advanceRoundSetup(state, 1, roster, result.phaseDeadline!);
  assert.equal(next.openingPlayerId, "alice");
  assert.deepEqual(next.players.map(({ previousRank }) => previousRank), [2, 3, undefined, undefined]);
  assert.deepEqual(next.players.map(({ id, totalScore, scoreHistory, cards }) => ({
    id, totalScore, scoreHistory, count: cards.length,
  })), [
    { id: "alice", totalScore: 7, scoreHistory: [7], count: 4 },
    { id: "bob", totalScore: 30, scoreHistory: [30], count: 4 },
    { id: "dana", totalScore: 30, scoreHistory: [30], count: 4 },
    { id: "eli", totalScore: 30, scoreHistory: [30], count: 4 },
  ]);
});

test("la reprise décale les échéances et conserve la carte déjà piochée", () => {
  const results = completedRound([5, 5, 0], ["2", "2", "6"], 100);
  assert.equal(resumeGameClock(results, 5_000).phaseDeadline, results.phaseDeadline! + 5_000);
  const final = completedRound([49, 5, 0], ["A", "2", "6"], 50);
  assert.equal(resumeGameClock(final, 5_000).phaseDeadline, null);

  const players = ids.map((id) => ({ id, pseudo: id, totalScore: 0 }));
  const playing = beginPlay(createRound(players, DEFAULT_VARIANTS, 100), 1_000, () => 0);
  const drawn = playTurn(playing, "alice", playing.turn!.number, { kind: "draw", source: "deck" }, 2_000);
  assert.ok(drawn.turn?.drawnCard);
  const resumed = resumeGameClock(drawn, 5_000);
  assert.equal(resumed.turn?.deadline, drawn.turn.deadline + 5_000);
  assert.equal(resumed.turn?.drawnCard, drawn.turn.drawnCard);
  assert.equal(resumed.currentPlayerId, drawn.currentPlayerId);
});
