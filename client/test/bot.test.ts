import assert from "node:assert/strict";
import test from "node:test";
import { getBotStep, playBotStep } from "../src/game/bot.ts";
import type { Card, CardRank } from "../src/game/cards.ts";
import { createRound } from "../src/game/createRound.ts";
import type { GameState, PowerKind } from "../src/game/gameTypes.ts";
import { startNextRound } from "../src/game/roundCycle.ts";
import { finishRound } from "../src/game/hands.ts";
import { beginPlay, getTurnView } from "../src/game/turn.ts";
import { DEFAULT_VARIANTS } from "../src/game/variants.ts";

const members = [
  { id: "bot", pseudo: "Bot 1", totalScore: 0, isBot: true as const, connected: true },
  { id: "alice", pseudo: "Alice", totalScore: 0, connected: true },
  { id: "bob", pseudo: "Bob", totalScore: 0, connected: true },
];
const card = (rank: CardRank, id: string = rank): Card => ({ id, rank, suit: "spades" });

function table(hand: CardRank[], drawn?: CardRank, power?: PowerKind): GameState {
  const state = beginPlay(createRound(members, DEFAULT_VARIANTS, 100), 0, () => 0);
  const hands: CardRank[][] = [hand, ["2", "9"], ["4", "5", "6"]];
  return {
    ...state,
    players: state.players.map((player, index) => ({
      ...player,
      cards: hands[index].map((rank, pos) => card(rank, `${player.id}-${pos}`)),
    })),
    turn: { ...state.turn!, drawnCard: drawn ? card(drawn) : null, power: power ? { kind: power, selected: [] } : null },
  };
}

function step(state: GameState, now = 1_000) {
  return playBotStep(state, getBotStep(state)!, now);
}

test("le bot remplace sa pire carte uniquement si la carte tirée est meilleure que toute la main", () => {
  const take = table(["6", "4", "Q"], "3");
  const better = getBotStep(take)!;
  assert.deepEqual(better.action, { kind: "replace", position: 2, handVersion: 0 });
  assert.ok(better.delay >= 500);
  const played = step(take);
  assert.deepEqual(played.players[0].cards.map(({ rank }) => rank), ["6", "4", "3"]);
  assert.equal(played.discardPile.at(-1)?.rank, "Q");
  assert.deepEqual(getTurnView(played, "bob", 1_001)?.cardMotion?.move,
    { kind: "bot-discard", playerId: "bot", slot: 1, face: { rank: "Q", suit: "spades" } });
  for (const drawn of ["4", "5"] as const) {
    assert.equal(getBotStep(table(["6", "4", "Q"], drawn))?.action.kind, "discard");
  }
});

test("un bot cible le joueur le plus proche de la victoire et apprend seulement les cartes révélées", () => {
  const look = table(["K", "6", "Q"], undefined, "look-other");
  assert.deepEqual(getBotStep(look)?.action, { kind: "power-card", target: { playerId: "alice", position: 0 }, handVersion: 0 });
  const known = step(look);
  assert.deepEqual(known.players[0].botMemory, [{ playerId: "alice", slot: 0, cardId: "alice-0", points: 2 }]);
  assert.equal(known.players[1].botMemory, undefined);
  assert.doesNotMatch(JSON.stringify(getTurnView(known, "bob", 1_001)), /botMemory|alice-0|"rank":"2"/);
  const swing = { ...known, turn: { ...known.turn!, power: { kind: "blind-swap" as const, selected: [] } } };
  const selecting = step(swing, 2_000);
  assert.deepEqual(getBotStep(selecting)?.action,
    { kind: "power-card", target: { playerId: "alice", position: 0 }, handVersion: 0 });
  const swapped = step(selecting, 3_000);
  assert.equal(swapped.players[0].cards[2].rank, "2");
  assert.equal(swapped.players[1].cards[0].rank, "Q");
});

test("le Valet évite un échange défavorable et le Joker vise la main la plus courte", () => {
  const valet = table(["K", "A"], undefined, "look-and-swap");
  const second = step(step(valet));
  assert.equal(getBotStep(second)?.action.kind, "power-pass");
  const joker = table(["Q", "6", "4"], undefined, "give-card");
  assert.deepEqual(getBotStep(joker)?.action, { kind: "power-player", playerId: "alice" });
  assert.equal(step(joker).players[1].cards.length, 3);
});

test("le bot annonce Dutch avec une main faible et une marge sur chaque adversaire", () => {
  const scored = table(["K", "2"], "9");
  assert.deepEqual(getBotStep(scored)?.action, { kind: "dutch-intent", enabled: true });
  const armed = step(scored);
  assert.ok(armed.turn?.dutchArmed);
  assert.equal(getBotStep(armed)?.action.kind, "discard");
  assert.equal(getBotStep(table(["5", "6", "Q"], "4"))?.action.kind, "replace");
  const close = { ...scored, players: scored.players.map((player) =>
    player.id === "alice" ? { ...player, cards: player.cards.slice(0, 1) } : player) };
  const lessRisky = { ...close, turn: { ...close.turn!, drawnCard: card("Q") } };
  assert.deepEqual(getBotStep(lessRisky)?.action, { kind: "dutch-intent", enabled: true });
  const poorLead = { ...lessRisky, players: lessRisky.players.map((player) =>
    player.id === "bot" ? { ...player, cards: [card("4"), card("A")] } : player) };
  assert.equal(getBotStep(poorLead)?.action.kind, "discard");
});

test("les bots réagissent selon la variante puis restent présents à la manche suivante", () => {
  const base = { ...table(["6", "Q", "K"]), currentPlayerId: "bob", discardPile: [card("6", "top")] };
  const adjacent = { ...base, variants: { ...base.variants, plusMinusOne: true } };
  assert.equal(getBotStep(adjacent), null);
  const reacted = step(base);
  assert.equal(reacted.players[0].cards.length, 2);
  assert.equal(reacted.cardMotion?.move.kind, "reaction");
  const result = finishRound(reacted, 1_200);
  const next = startNextRound(result, 1, members, 1_300, () => 0);
  assert.equal(next.players[0].isBot, true);
  assert.equal(next.players[0].cards.length, 4);
});

test("deux bots ne peuvent enchaîner leurs réactions qu’avec Pose infinie", () => {
  const base = table(["6", "K"]);
  const state = {
    ...base,
    currentPlayerId: "bob",
    discardPile: [card("6", "top")],
    players: base.players.map((player) => player.id === "alice"
      ? { ...player, isBot: true as const, cards: [card("6", "second"), ...player.cards] } : player),
  };
  const first = step(state);
  assert.equal(first.reaction.notice?.playerId, "bot");
  assert.equal(getBotStep(first), null);

  const infinite = { ...first, variants: { ...first.variants, infinitePose: true } };
  const second = step(infinite, 2_100);
  assert.equal(second.reaction.notice?.playerId, "alice");
  assert.equal(second.discardPile.at(-1)?.id, "second");
});
