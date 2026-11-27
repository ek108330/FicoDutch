import assert from "node:assert/strict";
import test from "node:test";
import { getCardFace } from "../src/game/cards.ts";
import { createRound } from "../src/game/createRound.ts";
import { applyDepartures, beginPlay, DUTCH_GRACE_MS, expireTurn, getTurnView, playTurn, TURN_DURATION_MS } from "../src/game/turn.ts";
import { DEFAULT_VARIANTS } from "../src/game/variants.ts";

const players = [
  { id: "host", pseudo: "Alice", totalScore: 0 },
  { id: "guest", pseudo: "Bob", totalScore: 0 },
];
const beginRound = () => beginPlay(createRound(players, DEFAULT_VARIANTS, 100), 1_000, () => 0);
const draw = { kind: "draw", source: "deck" };

test("le tirage au sort lance le premier tour et fixe son délai", () => {
  const starting = createRound(players, DEFAULT_VARIANTS, 100);
  const state = beginPlay(starting, 10, () => 0.75);
  assert.equal(state.currentPlayerId, "guest");
  assert.equal(state.turn?.deadline, TURN_DURATION_MS + 10);
  assert.equal(state.turn?.number, 1);
  assert.equal(beginPlay(state, 15), state);
});

test("seul le joueur actif peut tirer une carte et en voir la valeur", () => {
  const start = beginRound();
  const expected = start.drawPile.at(-1)!;
  assert.equal(playTurn(start, "guest", 1, draw, 1_100), start);
  assert.equal(playTurn(start, "host", 1, { kind: "draw", source: "discard", reference: 0 }, 1_100), start);
  const state = playTurn(start, "host", 1, draw, 1_100);

  assert.equal(state.drawPile.length, start.drawPile.length - 1);
  assert.equal(state.turn?.drawnCard, expected);
  assert.equal(state.turn?.deadline, start.turn?.deadline);
  assert.equal(playTurn(state, "host", 1, draw, 1_200), state);
  assert.deepEqual(getTurnView(state, "host", 1_200)?.drawnCard, getCardFace(expected));
  const guest = getTurnView(state, "guest", 1_200);
  assert.equal(guest?.drawnCard, null);
  assert.equal(guest?.hasDrawn, true);
  assert.equal(guest?.topDiscard, null);
});

test("la défausse se publie et un remplacement conserve la taille de la main", (t) => {
  t.mock.method(Math, "random", () => 0.999);
  let state = beginRound();
  const expected = state.drawPile.at(-1)!;
  const replaced = state.players[1].cards[0];
  state = playTurn(state, "host", 1, draw, 1_100);
  state = playTurn(state, "host", 1, { kind: "discard" }, 1_200);
  assert.equal(state.discardPile.at(-1), expected);
  assert.deepEqual(getTurnView(state, "guest", 1_200)?.topDiscard, getCardFace(expected));
  state = expireTurn(state, 1, 1_200 + DUTCH_GRACE_MS);
  assert.equal(state.currentPlayerId, "guest");

  assert.equal(playTurn(state, "guest", 2,
    { kind: "draw", source: "discard", reference: state.reaction.reference }, 1_800), state);
  const secondDraw = state.drawPile.at(-1);
  state = playTurn(state, "guest", 2, draw, 1_800);
  assert.deepEqual(state.discardPile, [expected]);
  assert.equal(playTurn(state, "guest", 1, { kind: "replace", position: 0, handVersion: 0 }, 1_900), state);
  assert.equal(playTurn(state, "guest", 2, { kind: "replace", position: 9, handVersion: 0 }, 1_900), state);
  state = playTurn(state, "guest", 2, { kind: "replace", position: 0, handVersion: 0 }, 1_900);

  assert.equal(state.players[1].cards[0], secondDraw);
  assert.equal(state.players[1].cards.length, 4);
  assert.equal(state.discardPile.at(-1), replaced);
  state = expireTurn(state, 2, 1_900 + DUTCH_GRACE_MS);
  assert.equal(state.currentPlayerId, "host");
  assert.equal(state.turn?.number, 3);
  assert.equal(state.turn?.drawnCard, null);
  const allCards = [...state.drawPile, ...state.discardPile, ...state.players.flatMap(({ cards }) => cards)];
  assert.equal(allCards.length, 52);
  assert.equal(new Set(allCards.map(({ id }) => id)).size, 52);
});

test("une pioche épuisée se reforme en laissant visible la dernière défausse", () => {
  const start = beginRound();
  const discarded = start.drawPile.slice(-4);
  const state = { ...start, drawPile: [], discardPile: discarded };
  const redrawn = playTurn(state, "host", 1, draw, 1_100);
  assert.deepEqual(redrawn.discardPile, [discarded[3]]);
  assert.deepEqual(new Set([...redrawn.drawPile, redrawn.turn?.drawnCard]),
    new Set(discarded.slice(0, -1)));
  const exhausted = { ...state, discardPile: [discarded[3]] };
  assert.equal(playTurn(exhausted, "host", 1, draw, 1_100), exhausted);
});

test("à l’expiration, la carte en attente est défaussée et le tour passe", () => {
  const start = beginRound();
  const deadline = 1_000 + TURN_DURATION_MS;
  const drawn = start.drawPile.at(-1);
  assert.equal(expireTurn(start, 1, deadline - 1), start);
  assert.equal(expireTurn(start, 2, deadline), start);
  assert.equal(playTurn(start, "host", 1, draw, deadline), start);

  const skipped = expireTurn(start, 1, deadline);
  assert.equal(expireTurn(skipped, 1, deadline + DUTCH_GRACE_MS).currentPlayerId, "guest");
  assert.equal(skipped.discardPile.length, 0);
  const expired = expireTurn(playTurn(start, "host", 1, draw, deadline - 1), 1, deadline);
  assert.equal(expired.discardPile.at(-1), drawn);
  assert.equal(expired.turn?.deadline, deadline + DUTCH_GRACE_MS);
  const next = expireTurn(expired, 1, expired.turn!.deadline);
  assert.equal(next.currentPlayerId, "guest");
  assert.equal(next.turn?.deadline, deadline + DUTCH_GRACE_MS + TURN_DURATION_MS);
});

test("retirer le joueur actif conserve sa main, défausse sa pioche et passe immédiatement le tour", () => {
  const start = beginPlay(createRound(players, DEFAULT_VARIANTS, 100), 1_000, () => 0.9);
  const drawn = playTurn(start, "guest", 1, draw, 1_100);
  const armed = playTurn(drawn, "guest", 1, { kind: "dutch-intent", enabled: true }, 1_200);
  assert.equal(armed.turn?.dutchArmed, true);

  const after = applyDepartures(armed, new Set(["host"]), 1_300);
  assert.equal(after.players[1].hasLeft, true);
  assert.equal(after.players[1].cards, start.players[1].cards);
  assert.equal(after.discardPile.at(-1), drawn.turn?.drawnCard);
  assert.equal(after.currentPlayerId, "host");
  assert.equal(after.turn?.deadline, TURN_DURATION_MS + 1_300);
  assert.equal(after.dutch, null);
  assert.equal(playTurn(after, "guest", 2, draw, 1_400), after);
});
