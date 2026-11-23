import assert from "node:assert/strict";
import test from "node:test";
import { getCardFace, type Card, type CardRank } from "../src/game/cards.ts";
import { createRound } from "../src/game/createRound.ts";
import type { CardTarget, GameState } from "../src/game/gameTypes.ts";
import { BLIND_SWAP_PREVIEW_MS, LOOK_DURATION_MS, POWER_DURATION_MS } from "../src/game/powers.ts";
import { beginPlay, expireTurn, getCardMotionView, getTurnView, playTurn } from "../src/game/turn.ts";
import { DEFAULT_VARIANTS } from "../src/game/variants.ts";

const players = ["alice", "bob", "charlie"].map((id) => ({ id, pseudo: id, totalScore: 0 }));
const own = { playerId: "alice", position: 0 };
const other = { playerId: "bob", position: 1 };

function startWithCard(rank: CardRank, jokerPlus = false) {
  const start = beginPlay(createRound(players, { ...DEFAULT_VARIANTS, jokerPlus }, 100), 0, () => 0);
  const card: Card = { id: "power-card", rank, suit: rank === "JOKER" ? undefined : "spades" };
  return { ...start, drawPile: [...start.drawPile.slice(0, -1), card] };
}

function activate(state: GameState) {
  const drawn = playTurn(state, "alice", 1, { kind: "draw", source: "deck" }, 900);
  return playTurn(drawn, "alice", 1, { kind: "discard" }, 1_000);
}

function choose(state: GameState, target: CardTarget) {
  const handVersion = state.players.find(({ id }) => id === target.playerId)?.handVersion;
  return playTurn(state, "alice", 1, { kind: "power-card", target, handVersion }, 1_100);
}

for (const [rank, valid, invalid, ownerIndex] of [["8", own, other, 0], ["9", other, own, 1]] as const) {
  test(`le ${rank} révèle une seule carte de la main autorisée au joueur actif`, () => {
    const power = activate(startWithCard(rank));
    assert.equal(power.turn?.deadline, 1_000 + POWER_DURATION_MS);
    assert.equal(power.discardPile.at(-1)?.rank, rank);
    assert.equal(choose(power, invalid), power);
    assert.equal(choose(power, { ...valid, position: 99 }), power);
    assert.equal(playTurn(power, "alice", 1, { kind: "draw", source: "deck" }, 1_100), power);
    assert.equal(playTurn(power, "bob", 1, { kind: "power-card", target: valid, handVersion: 0 }, 1_100), power);

    const selected = choose(power, valid);
    const deadline = 1_100 + LOOK_DURATION_MS;
    assert.equal(selected.turn?.deadline, deadline);
    assert.deepEqual(getTurnView(selected, "alice", 1_200)?.power?.selection?.revealed,
      [{ target: valid, face: getCardFace(power.players[ownerIndex].cards[valid.position]) }]);
    assert.equal(getTurnView(selected, "bob", 1_200)?.power?.selection, null);
    assert.deepEqual(getTurnView(selected, "bob", 1_200)?.power?.lookTarget, valid);
    assert.equal(getTurnView(selected, "alice", deadline)?.power?.selection, null);
    assert.equal(choose(selected, { ...valid, position: 2 }), selected);
    assert.equal(playTurn(selected, "alice", 1, { kind: "power-pass" }, 1_200), selected);
    assert.equal(playTurn(selected, "alice", 1, { kind: "power-hide" }, 1_200).currentPlayerId, "bob");
    assert.equal(expireTurn(selected, 1, deadline).currentPlayerId, "bob");
  });
}

test("le 10 surligne les deux cibles pendant 500 ms puis échange sans révéler de carte", () => {
  const initial = activate(startWithCard("10"));
  const first = choose(initial, own);
  assert.deepEqual(getTurnView(first, "alice", 1_100)?.power?.selection?.revealed, []);
  assert.equal(getTurnView(first, "bob", 1_100)?.power?.selection, null);
  assert.deepEqual(getTurnView(first, "bob", 1_100)?.power?.exchangeTargets, [own]);
  assert.equal(choose(first, own), first);
  const second = { ...own, position: 1 };
  const highlighted = choose(first, second);
  const deadline = 1_100 + BLIND_SWAP_PREVIEW_MS;
  assert.equal(highlighted.turn?.deadline, 1_600);
  assert.equal(highlighted.players, initial.players);
  assert.equal(highlighted.cardMotion, undefined);
  assert.deepEqual(getTurnView(highlighted, "bob", 1_100)?.power?.exchangeTargets, [own, second]);
  assert.deepEqual(getTurnView(highlighted, "alice", 1_100)?.power?.selection?.revealed, []);
  assert.equal(getTurnView(highlighted, "bob", 1_100)?.power?.selection, null);
  assert.equal(playTurn(highlighted, "alice", 1, { kind: "power-pass" }, 1_200), highlighted);
  assert.equal(expireTurn(highlighted, 1, deadline - 1), highlighted);
  const result = expireTurn(highlighted, 1, deadline);
  assert.equal(result.players[0].cards[0], initial.players[0].cards[1]);
  assert.equal(result.players[0].cards[1], initial.players[0].cards[0]);
  assert.equal(result.currentPlayerId, "bob");
  assert.equal(result.turn?.power, null);
  assert.deepEqual(getTurnView(result, "charlie", deadline)?.cardMotion?.move,
    { kind: "swap", targets: [own, second] });
  assert.equal(getTurnView(result, "charlie", 3_000)?.cardMotion, null);
});

test("le Valet révèle ses deux cibles puis permet de garder les cartes ou de les échanger", () => {
  const initial = activate(startWithCard("J"));
  const first = choose(initial, own);
  assert.deepEqual(getTurnView(first, "alice", 1_100)?.power?.selection?.revealed, []);
  assert.equal(playTurn(first, "alice", 1, { kind: "power-swap" }, 1_200), first);
  const preview = choose(first, other);
  assert.equal(preview.players, initial.players);
  assert.equal(getTurnView(preview, "bob", 1_200)?.cardMotion, null);
  assert.deepEqual(getTurnView(preview, "alice", 1_200)?.power?.selection?.revealed, [
    { target: own, face: getCardFace(initial.players[0].cards[0]) },
    { target: other, face: getCardFace(initial.players[1].cards[1]) },
  ]);
  assert.equal(getTurnView(preview, "bob", 1_200)?.power?.selection, null);
  assert.deepEqual(getTurnView(preview, "bob", 1_200)?.power?.exchangeTargets, [own, other]);

  const kept = playTurn(preview, "alice", 1, { kind: "power-pass" }, 1_200);
  assert.equal(kept.players, initial.players);
  assert.equal(kept.currentPlayerId, "bob");
  assert.equal(getTurnView(kept, "bob", 1_200)?.cardMotion, null);
  const swapped = playTurn(preview, "alice", 1, { kind: "power-swap" }, 1_200);
  assert.equal(swapped.players[0].cards[0], initial.players[1].cards[1]);
  assert.equal(swapped.players[1].cards[1], initial.players[0].cards[0]);
  assert.equal(swapped.currentPlayerId, "bob");
  const publicMotion = getTurnView(swapped, "charlie", 1_200)?.cardMotion;
  assert.deepEqual(publicMotion?.move, { kind: "swap", targets: [own, other] });
  assert.deepEqual(getTurnView(swapped, "alice", 1_200)?.cardMotion, publicMotion);
});

test("l’échange du dernier tour est publié même quand la manche se termine", () => {
  const playing = startWithCard("10");
  const finalTurn = { ...playing, dutch: { announcerId: "charlie", remainingPlayerIds: ["alice"] } };
  const highlighted = choose(choose(activate(finalTurn), own), other);
  const deadline = highlighted.turn!.deadline;
  const state = expireTurn(highlighted, 1, deadline);
  assert.equal(state.turn?.finalReaction, true);
  assert.equal(expireTurn(state, 1, state.turn!.deadline).phase, "results");
  assert.deepEqual(getCardMotionView(state, deadline)?.move, { kind: "swap", targets: [own, other] });
  assert.equal(getCardMotionView(state, 3_000), null);
});

test("le Joker+ donne une carte cachée à un adversaire dont la main est encore sur la table", () => {
  assert.equal(activate(startWithCard("JOKER")).turn?.power, null);
  const state = startWithCard("JOKER", true);
  const gift = state.drawPile[0];
  const before = {
    ...state,
    drawPile: state.drawPile.slice(-1),
    discardPile: [gift],
    players: state.players.map((player) => player.id === "bob" ? { ...player, hasLeft: true } : player),
  };
  const power = activate(before);
  assert.equal(power.turn?.power?.kind, "give-card");
  assert.equal(playTurn(power, "alice", 1, { kind: "power-player", playerId: "alice" }, 1_200), power);
  assert.equal(playTurn(power, "alice", 1, { kind: "power-player", playerId: "absent" }, 1_200), power);
  const result = playTurn(power, "alice", 1, { kind: "power-player", playerId: "bob" }, 1_200);
  assert.equal(result.players[1].cards.at(-1), gift);
  assert.equal(result.players[1].cards.length, 5);
  assert.equal(result.discardPile.at(-1)?.rank, "JOKER");
  assert.equal(result.currentPlayerId, "charlie");
  const view = getTurnView(result, "bob", 1_200);
  assert.deepEqual(view?.players[1], {
    id: "bob", pseudo: "bob", cardCount: 5, handVersion: 1, handLayout: { columns: 3, slots: [0, 2, 1, 3, 4] },
  });
  assert.equal(view?.drawnCard, null);
  assert.equal(view?.power, null);
  assert.deepEqual(view?.cardMotion?.move, { kind: "gift", target: { playerId: "bob", position: 4 } });
});

test("l’expiration du pouvoir masque les cartes et conserve la défausse sans échanger", () => {
  const initial = activate(startWithCard("J"));
  const selected = choose(choose(initial, own), other);
  const end = 1_000 + POWER_DURATION_MS;
  assert.equal(getTurnView(selected, "alice", end)?.power?.selection, null);
  assert.equal(playTurn(selected, "alice", 1, { kind: "power-swap" }, end), selected);
  const expired = expireTurn(selected, 1, end);
  assert.equal(expired.currentPlayerId, "bob");
  assert.equal(expired.players, initial.players);
  assert.equal(expired.discardPile.at(-1)?.rank, "J");
  assert.equal(expired.turn?.power, null);
});
