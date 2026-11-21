import assert from "node:assert/strict";
import test from "node:test";
import { createRound } from "../src/game/createRound.ts";
import { getMemorizedCards, memorizeCard } from "../src/game/memorization.ts";
import { DEFAULT_VARIANTS } from "../src/game/variants.ts";

const players = [
  { id: "host", pseudo: "Alice", totalScore: 0 },
  { id: "guest", pseudo: "Bob", totalScore: 0 },
];

for (const sixCards of [false, true]) {
  const limit = sixCards ? 3 : 2;
  test(`un joueur ne reçoit que ${limit} de ses cartes pendant la mémorisation`, () => {
    const round = createRound(players, { ...DEFAULT_VARIANTS, sixCards }, 100);
    const positions = Array.from({ length: limit }, (_, index) => index);
    const deadline = 15_000;
    const checked = positions.reduce((state, position) => memorizeCard(state, "guest", position, 14_999, deadline), round);
    assert.deepEqual(getMemorizedCards(checked, "guest"), positions.map((position) => {
      const { rank, suit } = round.players[1].cards[position];
      return { position, face: { rank, suit } };
    }));
    assert.deepEqual(getMemorizedCards(checked, "host"), []);
    assert.equal(memorizeCard(checked, "guest", limit, 14_999, deadline), checked);
    assert.equal(memorizeCard(checked, "guest", 0, 14_999, deadline), checked);
    assert.equal(memorizeCard(round, "guest", -1, 14_999, deadline), round);
    assert.equal(memorizeCard(round, "guest", 100, 14_999, deadline), round);
    assert.equal(memorizeCard(round, "guest", [0, 1], 14_999, deadline), round);
    assert.equal(memorizeCard(round, "unknown-player", 0, 14_999, deadline), round);
    assert.equal(memorizeCard(round, "guest", 0, 15_000, deadline), round);
    assert.deepEqual(getMemorizedCards({ ...checked, phase: "playing" }, "guest"), []);
  });
}
