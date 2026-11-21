import assert from "node:assert/strict";
import test from "node:test";
import { createRound } from "../src/game/createRound.ts";
import { revealMemorizedCards } from "../src/game/memorization.ts";
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
    const selected = revealMemorizedCards(round, "guest", positions, 14_999, deadline);
    assert.deepEqual(selected, positions.map((position) => {
      const { rank, suit } = round.players[1].cards[position];
      return { position, face: { rank, suit } };
    }));
    assert.deepEqual(revealMemorizedCards(round, "guest", [...positions, limit], 14_999, deadline), []);
    assert.deepEqual(revealMemorizedCards(round, "guest", [0, 0], 14_999, deadline), []);
    assert.deepEqual(revealMemorizedCards(round, "guest", [-1], 14_999, deadline), []);
    assert.deepEqual(revealMemorizedCards(round, "guest", [100], 14_999, deadline), []);
    assert.deepEqual(revealMemorizedCards(round, "unknown-player", positions, 14_999, deadline), []);
    assert.deepEqual(revealMemorizedCards(round, "guest", positions, 15_000, deadline), []);
    round.phase = "playing";
    assert.deepEqual(revealMemorizedCards(round, "guest", positions, 14_999, deadline), []);
  });
}
