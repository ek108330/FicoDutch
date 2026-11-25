import assert from "node:assert/strict";
import test from "node:test";
import type { Card, CardRank } from "../src/game/cards.ts";
import { createRound } from "../src/game/createRound.ts";
import { getRoundResultView } from "../src/game/hands.ts";
import { beginPlay, expireTurn, FINAL_REACTION_MS, getTurnView, playTurn, TURN_DURATION_MS } from "../src/game/turn.ts";
import { DEFAULT_VARIANTS } from "../src/game/variants.ts";
import type { GameState, PowerKind } from "../src/game/gameTypes.ts";

const players = ["alice", "bob", "charlie"].map((id) => ({ id, pseudo: id, totalScore: 0 }));
const card = (rank: CardRank, id: string): Card => ({ rank, id, suit: "spades" });

function setup(ranks: [CardRank[], CardRank[], CardRank[]], drawRanks: CardRank[] = ["3", "2", "4"]) {
  const start = beginPlay(createRound(players, DEFAULT_VARIANTS, 100), 0, () => 0);
  return {
    ...start,
    players: start.players.map((player, index) => ({
      ...player,
      cards: ranks[index].map((rank, position) => card(rank, `${player.id}-${position}`)),
    })),
    drawPile: drawRanks.map((rank, position) => card(rank, `deck-${position}`)),
  };
}

function act(state: GameState, playerId: string, action: unknown, now: number) {
  return playTurn(state, playerId, state.turn?.number, action, now);
}

function discardFromDeck(state: GameState, playerId: string, now: number) {
  const drawn = act(state, playerId, { kind: "draw", source: "deck" }, now);
  return act(drawn, playerId, { kind: "discard" }, now + 1);
}

function armDutch(state: GameState) {
  return act(state, "alice", { kind: "dutch-intent", enabled: true }, 500);
}

test("Dutch est annoncé en fin de tour et laisse exactement un dernier tour à chacun", () => {
  const start = setup([["A"], ["6"], ["7"]]);
  const wrongPlayer = act(start, "bob", { kind: "dutch-intent", enabled: true }, 500);
  assert.equal(wrongPlayer, start);
  const armed = armDutch(start);
  assert.equal(armed.dutch, null);
  assert.equal(getTurnView(armed, "alice", 500)?.dutchArmed, true);
  assert.equal(getTurnView(armed, "bob", 500)?.dutchArmed, false);
  const cancelled = act(armed, "alice", { kind: "dutch-intent", enabled: false }, 550);
  assert.equal(discardFromDeck(cancelled, "alice", 600).dutch, null);

  const announced = discardFromDeck(armed, "alice", 600);
  assert.deepEqual(announced.dutch, { announcerId: "alice", remainingPlayerIds: ["bob", "charlie"], announcedAt: 601 });
  assert.equal(announced.currentPlayerId, "bob");
  assert.equal(getTurnView(announced, "alice", 650)?.topDiscard?.rank, "4");
  assert.equal(announced.reaction.presentedAt, 3_401);
  assert.equal(announced.turn?.deadline, 3_401 + TURN_DURATION_MS);
  assert.ok(getTurnView(announced, "bob", 650)!.dutch!.announcementMs > 2_000);
  assert.equal(getTurnView(announced, "charlie", 3_500)?.dutch?.announcementMs, 0);
  assert.equal(act(announced, "bob", { kind: "dutch-intent", enabled: true }, 700), announced);
  assert.equal(act(announced, "bob", { kind: "draw", source: "deck" }, 800), announced);
  assert.equal(act(announced, "alice", { kind: "reaction", position: 0, reference: announced.reaction.reference, handVersion: 0 }, 800), announced);
  const last = discardFromDeck(announced, "bob", 3_401);
  assert.equal(last.currentPlayerId, "charlie");
  assert.equal(getTurnView(last, "charlie", 3_450)?.dutch?.lastTurns, 1);

  const results = expireTurn(last, last.turn!.number, last.turn!.deadline);
  assert.equal(results.turn, null);
  assert.equal(results.phase, "results");
  assert.equal(results.result?.dutchPenalty, false);
  assert.deepEqual(results.result?.winnerIds, ["alice"]);
});

test("une égalité au plus bas donne dix points à l’annonceur", () => {
  const start = setup([["4"], ["4"], ["7"]]);
  const announced = discardFromDeck(armDutch(start), "alice", 600);
  const bob = discardFromDeck(announced, "bob", 3_500);
  const pending = discardFromDeck(bob, "charlie", 3_700);
  const result = expireTurn(pending, pending.turn!.number, 3_701 + FINAL_REACTION_MS);
  assert.equal(result.result?.dutchPenalty, true);
  assert.deepEqual(result.players.map(({ roundScore, totalScore }) => [roundScore, totalScore]),
    [[14, 14], [4, 4], [7, 7]]);
  assert.deepEqual(result.result?.winnerIds, ["bob"]);
});

test("la dernière défausse laisse une fenêtre de réaction fixe de trois secondes avant les scores", () => {
  const start = setup([["A", "3"], ["4"], ["7"]]);
  const announced = discardFromDeck(armDutch(start), "alice", 600);
  const bob = discardFromDeck(announced, "bob", 3_500);
  const closing = discardFromDeck(bob, "charlie", 3_700);
  const deadline = 3_701 + FINAL_REACTION_MS;
  assert.equal(closing.turn?.deadline, deadline);
  assert.equal(getTurnView(closing, "charlie", 3_701)?.finalReaction, true);
  assert.equal(act(closing, "charlie", { kind: "draw", source: "deck" }, 4_000), closing);
  assert.equal(expireTurn(closing, closing.turn!.number, deadline - 1), closing);
  const action = { kind: "reaction", position: 1, reference: closing.reaction.reference, handVersion: 0 };
  assert.equal(act(closing, "alice", action, deadline), closing);
  const reacted = act(closing, "alice", action, deadline - 1);
  assert.equal(reacted.players[0].cards.length, 1);
  assert.equal(reacted.turn?.deadline, deadline);
  assert.equal(expireTurn(reacted, reacted.turn!.number, deadline).players[0].roundScore, 1);
});

test("l’annonce attend la résolution du pouvoir du joueur", () => {
  const start = setup([["2"], ["6"], ["7"]], ["8"]);
  const power = discardFromDeck(armDutch(start), "alice", 600);
  assert.equal(power.dutch, null);
  assert.equal(power.turn?.power?.kind, "look-own");
  const announced = act(power, "alice", { kind: "power-pass" }, 900);
  assert.equal(announced.dutch?.announcerId, "alice");
  assert.equal(announced.currentPlayerId, "bob");
});

function withPower(state: GameState, kind: PowerKind): GameState {
  return { ...state, turn: { ...state.turn!, power: { kind, selected: [] } } };
}

function choose(state: GameState, playerId: string) {
  const handVersion = state.players.find(({ id }) => id === playerId)?.handVersion;
  return act(state, "bob", { kind: "power-card", target: { playerId, position: 0 }, handVersion }, 3_600);
}

test("Dutch protège des échanges du 10 et du Valet, tout en laissant la consultation possible", () => {
  const start = setup([["2"], ["6"], ["7"]]);
  const announced = discardFromDeck(armDutch(start), "alice", 600);
  const ten = withPower(announced, "blind-swap");
  assert.equal(choose(ten, "alice"), ten);
  const jack = withPower(announced, "look-and-swap");
  const preview = choose(choose(jack, "alice"), "bob");
  const selection = getTurnView(preview, "bob", 3_650)?.power?.selection;
  assert.equal(selection?.revealed.length, 2);
  assert.equal(selection?.canSwap, false);
  assert.equal(act(preview, "bob", { kind: "power-swap" }, 3_690), preview);
  assert.equal(act(preview, "bob", { kind: "power-pass" }, 3_700).currentPlayerId, "charlie");

  const nine = withPower(announced, "look-other");
  const seen = choose(nine, "alice");
  assert.equal(getTurnView(seen, "bob", 3_650)?.power?.selection?.revealed[0]?.face.rank, "2");
});

test("vider sa main pendant Dutch arrête les derniers tours et applique la règle du zéro", () => {
  const start = setup([["4"], ["K"], ["7"]]);
  const announced = discardFromDeck(armDutch(start), "alice", 600);
  const result = act(announced, "alice", {
    kind: "reaction", position: 0, reference: announced.reaction.reference, handVersion: 0,
  }, 3_500);
  const view = getRoundResultView(result);
  assert.equal(view?.emptyHandPlayerId, "alice");
  assert.equal(view?.dutchPenalty, true);
  assert.equal(view?.players[0].roundScore, 10);
  assert.deepEqual(view?.winnerIds, ["bob"]);
  assert.equal(result.turn, null);
});
