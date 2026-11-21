import assert from "node:assert/strict";
import test from "node:test";
import { createRound } from "../src/game/createRound.ts";
import { DEFAULT_VARIANTS } from "../src/game/variants.ts";

const cases = [
  { playerCount: 2, cardsPerPlayer: 4, jokers: 0 },
  { playerCount: 2, cardsPerPlayer: 6, jokers: 0 },
  { playerCount: 6, cardsPerPlayer: 4, jokers: 2 },
  { playerCount: 6, cardsPerPlayer: 6, jokers: 2 },
];

for (const { playerCount, cardsPerPlayer, jokers } of cases) {
  test(`distribution de ${cardsPerPlayer} cartes à ${playerCount} joueurs, ${jokers} jokers`, () => {
    const players = Array.from({ length: playerCount }, (_, i) => ({
      id: `player-${i + 1}`,
      pseudo: `Joueur${i + 1}`,
      totalScore: 0,
    }));
    const round = createRound(players, {
      ...DEFAULT_VARIANTS,
      sixCards: cardsPerPlayer === 6,
      jokerPlus: jokers > 0,
    }, 100);

    assert.equal(round.phase, "memorization");
    assert.equal(round.roundNumber, 1);
    assert.deepEqual(round.players.map(({ id }) => id), players.map(({ id }) => id));
    assert.ok(round.players.every(({ cards }) => cards.length === cardsPerPlayer));
    assert.equal(round.drawPile.length, 52 + jokers - playerCount * cardsPerPlayer);
    assert.deepEqual(round.discardPile, []);

    const allCards = [...round.drawPile, ...round.players.flatMap(({ cards }) => cards)];
    assert.equal(new Set(allCards.map(({ id }) => id)).size, 52 + jokers);
    assert.equal(allCards.filter(({ rank }) => rank === "JOKER").length, jokers);
  });
}
