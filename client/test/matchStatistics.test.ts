import assert from "node:assert/strict";
import test from "node:test";
import { createRound } from "../src/game/createRound.ts";
import { journalCard, logDeal, logMatch, matchEntries, type MatchEvent } from "../src/game/matchJournal.ts";
import { matchStatistics } from "../src/game/matchStatistics.ts";
import { beginPlay, getTurnView, playTurn } from "../src/game/turn.ts";
import { DEFAULT_VARIANTS } from "../src/game/variants.ts";

const players = ["alice", "bob", "chloe"].map((id) => ({ id, pseudo: id, accountId: id + "-account", totalScore: 0 }));
const card = (id: string, points: number, blackKing = false) => ({ id, points, blackKing });
const black = card("clubs-K", 0, true);
const red = card("hearts-K", 13);
const fit = card("spades-5", 5);
const hand = (playerId: string, selected: typeof black) => ({ playerId, card: selected });

function sample(events: { at: number; event: MatchEvent }[], twoRounds = false) {
  const initial = createRound(players, DEFAULT_VARIANTS, 50);
  let state = logMatch({ ...initial, matchId: "a-match" }, 0, {
    kind: "deal", players: [{ id: "alice", name: "Alice", cards: [black] },
      { id: "bob", name: "Bob", cards: [red] }, { id: "chloe", name: "Chloe", cards: [fit] }],
  });
  for (const { at, event } of events) state = logMatch(state, at, event);
  if (twoRounds) state = logMatch({ ...state, roundNumber: 2 }, 2_000, {
    kind: "deal", players: [{ id: "alice", name: "Alice", cards: [black] },
      { id: "bob", name: "Bob", cards: [] }, { id: "chloe", name: "Chloe", cards: [] }],
  });
  return state;
}

test("les actions validées établissent les treize statistiques et les égalités", () => {
  const completed = sample([
    { at: 100, event: { kind: "discard", playerId: "alice", card: fit, reference: 1 } },
    { at: 420, event: { kind: "reaction", playerId: "bob", card: fit, reference: 1, openedAt: 100 } },
    { at: 810, event: { kind: "reaction", playerId: "chloe", card: fit, reference: 2, openedAt: 420 } },
    { at: 900, event: { kind: "incorrect", playerId: "chloe", card: fit, reference: 3 } },
    { at: 900, event: { kind: "penalty", playerId: "chloe", card: red } },
    { at: 950, event: { kind: "swap", playerId: "chloe", cards: [hand("alice", black), hand("bob", red)] } },
    { at: 960, event: { kind: "swap", playerId: "bob", cards: [hand("alice", red), hand("bob", black)] } },
    { at: 970, event: { kind: "gift", playerId: "bob", recipient: "alice", card: red } },
    { at: 975, event: { kind: "dutch", playerId: "alice" } },
    { at: 999, event: {
      kind: "round-result", announcer: "alice", dutchPenalty: true, winners: ["bob"],
      scores: [
        { id: "alice", base: 40, score: 50, total: 50, left: false },
        { id: "bob", base: 3, score: 3, total: 3, left: false },
        { id: "chloe", base: 40, score: 40, total: 40, left: false },
      ],
    } },
  ], true);
  const report = matchStatistics(completed.journal, "finished");
  const { awards } = report;
  assert.equal(Object.keys(awards).length, 13);
  assert.deepEqual(awards.shuriken, [{ players: ["bob"], value: 1, extra: 5 }, { players: ["chloe"], value: 1, extra: 5 }]);
  assert.deepEqual(awards.luckyLuke, [{ players: ["bob"], value: 320 }]);
  assert.deepEqual(awards.boulet, [{ players: ["chloe"], value: 1, extra: 13 }]);
  assert.deepEqual(awards.cible, [{ players: ["alice"], value: 3, extra: 2 }]);
  assert.deepEqual(awards.pyromane, [{ players: ["alice"], value: 2 }]);
  assert.equal(awards.roisNoirs?.find(({ players }) => players[0] === "alice")?.value, 1);
  assert.deepEqual(awards.distributeur, [{ players: ["bob"], value: 1, extra: 13 }]);
  assert.equal(awards.victime?.length, 3);
  assert.deepEqual(awards.rivalite, [{ players: ["alice", "bob"], value: 2 }]);
  assert.equal(awards.meilleur?.[0].value, 13);
  assert.equal(awards.pire?.[0].value, 13);
  assert.deepEqual(awards.voleur, [{ players: ["bob"], value: 1 }]);
  assert.equal(awards.bourreau?.length, 2);
  assert.equal(report.players.find(({ id }) => id === "bob")?.rank, 1);
});

test("les actions au milieu d’une manche restent distinctes du résultat et des données de secours", () => {
  const state = sample([
    { at: 121, event: { kind: "dutch", playerId: "alice" } },
    { at: 211, event: { kind: "power", playerId: "alice", power: "blind-swap", stage: "start" } },
    { at: 230, event: { kind: "penalty", playerId: "bob", card: red } },
    { at: 240, event: { kind: "gift", playerId: "alice", recipient: "bob", card: red } },
  ]);
  const report = matchStatistics(state.journal, "interrupted");
  assert.equal(report.rounds, 0);
  assert.ok(report.players.every(({ rank, dutchWon, wins }) => rank === undefined && dutchWon === 0 && wins === 0));
  assert.equal(report.players.find(({ id }) => id === "alice")?.dutch, 1);
  assert.deepEqual(report.unfinished, { round: 1, reactions: 0, penalties: 1, exchanges: 0, gifts: 1 });
  assert.equal(report.awards.meilleur, undefined);
  assert.equal(report.awards.bourreau, undefined);
  assert.equal(report.awards.boulet?.[0].extra, 13);
  const partial = matchStatistics(state.journal, "interrupted", true);
  assert.equal(partial.partial, true);
  assert.equal(partial.awards.roisNoirs, undefined);
  assert.equal(partial.awards.distributeur?.[0].extra, undefined);
  assert.equal(partial.awards.distributeur?.[0].value, 1);
  assert.deepEqual(matchStatistics(undefined, "interrupted").awards, {});
});

test("le moteur journalise une réaction acceptée, refuse une version périmée et ne projette jamais le journal", () => {
  const round = createRound(players, DEFAULT_VARIANTS, 50);
  const [first, second] = round.players;
  first.cards = [{ id: "clubs-5", rank: "5", suit: "clubs" }, ...first.cards.slice(1)];
  second.cards = [{ id: "hearts-5", rank: "5", suit: "hearts" }, ...second.cards.slice(1)];
  const state = beginPlay(logDeal({ ...round, matchId: "game1" }, 0), 10, () => 0);
  const drawn = playTurn(state, "alice", 1, { kind: "draw", source: "deck" }, 50);
  const discard = playTurn(drawn, "alice", 1, { kind: "replace", position: 0, handVersion: 0 }, 100);
  const rejected = playTurn(discard, "bob", 2, { kind: "reaction", reference: 1, position: 0, handVersion: 1 }, 200);
  assert.equal(rejected, discard);
  const reacted = playTurn(discard, "bob", 2, { kind: "reaction", reference: 1, position: 0, handVersion: 0 }, 420);
  const last = matchEntries(reacted.journal).at(-1);
  assert.equal(last?.kind, "reaction");
  assert.equal(last?.accountId, "bob-account");
  assert.equal(last?.matchId, "game1");
  assert.deepEqual(matchStatistics(reacted.journal, "interrupted").awards.luckyLuke, [{ players: ["bob"], value: 320 }]);
  assert.ok(!("journal" in getTurnView(reacted, "chloe", 421)!));
  assert.deepEqual(journalCard({ id: "spades-K", rank: "K", suit: "spades" }), card("spades-K", 0, true));
});
