import assert from "node:assert/strict";
import test from "node:test";
import { getBotReactionDelay, getBotStep, playBotStep } from "../src/game/bot.ts";
import type { Card, CardRank } from "../src/game/cards.ts";
import { createRound } from "../src/game/createRound.ts";
import { resumeGameClock } from "../src/game/gameClock.ts";
import type { GameState, PowerKind } from "../src/game/gameTypes.ts";
import { presentDiscard } from "../src/game/reactions.ts";
import { startNextRound } from "../src/game/roundCycle.ts";
import { finishRound } from "../src/game/hands.ts";
import { observeCard } from "../src/game/memorization.ts";
import { beginPlay, expireTurn, getTurnView } from "../src/game/turn.ts";
import { DEFAULT_VARIANTS } from "../src/game/variants.ts";

const members = [
  { id: "bot", pseudo: "Bot 1", totalScore: 0, isBot: true as const, connected: true },
  { id: "alice", pseudo: "Alice", totalScore: 0, connected: true },
  { id: "bob", pseudo: "Bob", totalScore: 0, connected: true },
];
const card = (rank: CardRank, id: string = rank): Card => ({ id, rank, suit: "spades" });
const rememberHand = (player: GameState["players"][number]) =>
  ({ ...player, botMemory: player.cards.map((_, position) => observeCard(player, position)) });

function table(hand: CardRank[], drawn?: CardRank, power?: PowerKind): GameState {
  const state = beginPlay(createRound(members, DEFAULT_VARIANTS, 100), 0, () => 0);
  const hands: CardRank[][] = [hand, ["2", "9"], ["4", "5", "6"]];
  return {
    ...state,
    players: state.players.map((player, index) => {
      const dealt = { ...player, cards: hands[index].map((rank, pos) => card(rank, `${player.id}-${pos}`)) };
      return dealt.isBot ? rememberHand(dealt) : dealt;
    }),
    turn: { ...state.turn!, drawnCard: drawn ? card(drawn) : null, power: power ? { kind: power, selected: [] } : null },
  };
}

function nextBot(state: GameState, now = state.reaction.presentedAt ?? 0) {
  return getBotStep(state, now, () => 900);
}

function step(state: GameState, now = 1_000) {
  return playBotStep(state, nextBot(state, now)!, now);
}

test("un bot ne mémorise que les cartes autorisées et ignore les valeurs cachées", () => {
  for (const sixCards of [false, true]) {
    const round = createRound(members, { ...DEFAULT_VARIANTS, sixCards }, 100);
    assert.equal(beginPlay(round, 0).players[0].botMemory?.length, sixCards ? 3 : 2);
  }
  const round = createRound(members, DEFAULT_VARIANTS, 100);
  round.players[0].cards = [card("5"), card("6"), card("K"), card("Q")];
  const started = beginPlay(round, 0, () => 0);
  const state = { ...started, turn: { ...started.turn!, drawnCard: card("3") } };
  const hiddenChanged = { ...state, players: state.players.map((player) => player.id !== "bot" ? player :
    { ...player, cards: [card("5"), card("6"), card("2"), card("A")] }) };
  assert.deepEqual(nextBot(state), nextBot(hiddenChanged));
  const reaction = presentDiscard({ ...state, currentPlayerId: "bob" }, [card("Q", "visible")], 0);
  assert.equal(nextBot(reaction), null);
  const played = step(state);
  assert.ok(played.players[0].botMemory?.some(({ face }) => face.rank === "3"));
});

test("le bot remplace sa pire carte uniquement si la carte tirée est meilleure que toute la main", () => {
  const take = table(["6", "4", "Q"], "3");
  const better = nextBot(take)!;
  assert.deepEqual(better.action, { kind: "replace", position: 2, handVersion: 0 });
  assert.ok(better.delay > 1_000);
  const played = step(take);
  assert.deepEqual(played.players[0].cards.map(({ rank }) => rank), ["6", "4", "3"]);
  assert.equal(played.discardPile.at(-1)?.rank, "Q");
  assert.deepEqual(getTurnView(played, "bob", 1_001)?.cardMotion?.move,
    { kind: "bot-discard", playerId: "bot", slot: 1, face: { rank: "Q", suit: "spades" } });
  for (const drawn of ["4", "5"] as const) {
    assert.equal(nextBot(table(["6", "4", "Q"], drawn))?.action.kind, "discard");
  }
});

test("un bot cible le joueur le plus proche de la victoire et apprend seulement les cartes révélées", () => {
  const look = table(["K", "6", "Q"], undefined, "look-other");
  assert.deepEqual(nextBot(look)?.action, { kind: "power-card", target: { playerId: "alice", position: 0 }, handVersion: 0 });
  const known = step(look);
  assert.deepEqual(known.players[0].botMemory?.filter(({ playerId }) => playerId === "alice"),
    [{ playerId: "alice", slot: 0, cardId: "alice-0", face: { rank: "2", suit: "spades" } }]);
  assert.equal(known.players[1].botMemory, undefined);
  assert.doesNotMatch(JSON.stringify(getTurnView(known, "bob", 1_001)), /botMemory|alice-0|"rank":"2"/);
  const swing = { ...known, turn: { ...known.turn!, power: { kind: "blind-swap" as const, selected: [] } } };
  const selecting = step(swing, 2_000);
  assert.deepEqual(nextBot(selecting)?.action,
    { kind: "power-card", target: { playerId: "alice", position: 0 }, handVersion: 0 });
  const pending = step(selecting, 3_000);
  assert.equal(nextBot(pending, 3_499), null);
  const swapped = expireTurn(pending, 1, 3_500);
  assert.equal(swapped.players[0].cards[2].rank, "2");
  assert.equal(swapped.players[1].cards[0].rank, "Q");
});

test("le Valet évite un échange défavorable et le Joker vise la main la plus courte", () => {
  const valet = table(["K", "A"], undefined, "look-and-swap");
  const second = step(step(valet));
  assert.equal(nextBot(second)?.action.kind, "power-pass");
  const joker = table(["Q", "6", "4"], undefined, "give-card");
  assert.deepEqual(nextBot(joker)?.action, { kind: "power-player", playerId: "alice" });
  assert.equal(step(joker).players[1].cards.length, 3);
  const protectedTable = { ...joker, dutch: { announcerId: "alice", remainingPlayerIds: ["bot", "bob"], announcedAt: 0 } };
  assert.deepEqual(nextBot(protectedTable)?.action, { kind: "power-player", playerId: "bob" });
});

test("le bot annonce Dutch avec une main faible et une marge sur chaque adversaire", () => {
  const scored = table(["K", "2"], "9");
  assert.deepEqual(nextBot(scored)?.action, { kind: "dutch-intent", enabled: true });
  const armed = step(scored);
  assert.ok(armed.turn?.dutchArmed);
  assert.equal(nextBot(armed)?.action.kind, "discard");
  assert.equal(nextBot(table(["5", "6", "Q"], "4"))?.action.kind, "replace");
  const close = { ...scored, players: scored.players.map((player) =>
    player.id === "alice" ? { ...player, cards: player.cards.slice(0, 1) } : player) };
  const lessRisky = { ...close, turn: { ...close.turn!, drawnCard: card("Q") } };
  assert.deepEqual(nextBot(lessRisky)?.action, { kind: "dutch-intent", enabled: true });
  const poorLead = { ...lessRisky, players: lessRisky.players.map((player) =>
    player.id === "bot" ? rememberHand({ ...player, cards: [card("4"), card("A")] }) : player) };
  assert.equal(nextBot(poorLead)?.action.kind, "discard");
});

test("les bots réagissent selon la variante puis restent présents à la manche suivante", () => {
  const base = presentDiscard({ ...table(["6", "Q", "K"]), currentPlayerId: "bob" }, [card("6", "top")], 0);
  const adjacent = { ...base, variants: { ...base.variants, plusMinusOne: true } };
  assert.equal(nextBot(adjacent), null);
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
  const state = presentDiscard({
    ...base,
    currentPlayerId: "bob",
    players: base.players.map((player) => player.id === "alice"
      ? rememberHand({ ...player, isBot: true, cards: [card("6", "second"), ...player.cards] }) : player),
  }, [card("6", "top")], 0);
  const first = step(state);
  assert.equal(first.reaction.notice?.playerId, "bot");
  assert.equal(nextBot(first), null);

  const infinite = { ...first, variants: { ...first.variants, infinitePose: true } };
  const second = step(infinite, 2_100);
  assert.equal(second.reaction.notice?.playerId, "alice");
  assert.equal(second.discardPile.at(-1)?.id, "second");
});

test("les bots tirent chacun un délai entre 0,5 et 4 secondes à partir de la défausse", () => {
  assert.equal(getBotReactionDelay(() => 0), 500);
  assert.equal(getBotReactionDelay(() => 0.5), 2_250);
  assert.equal(getBotReactionDelay(() => 1 - Number.EPSILON), 4_000);
  const base = table(["6", "K"]);
  const state = presentDiscard({
    ...base,
    currentPlayerId: "bob",
    players: base.players.map((player) => player.id === "alice"
      ? rememberHand({ ...player, isBot: true, cards: [card("6", "second"), ...player.cards] }) : player),
  }, [card("6", "top")], 1_000);

  const delayFor = (id: string) => id === "alice" ? 2_400 : 4_000;
  assert.deepEqual(getBotStep(state, 1_500, delayFor), {
    playerId: "alice", delay: 1_900, action: { kind: "reaction", reference: 1, position: 0, handVersion: 0 },
  });
  assert.equal(getBotStep(resumeGameClock(state, 5_000), 6_500, delayFor)?.delay, 1_900);
  assert.equal(getBotStep(state, 5_001, delayFor), null);

  const final = { ...state, turn: { ...state.turn!, finalReaction: true as const, deadline: 4_000 } };
  assert.equal(getBotStep(final, 1_500, delayFor)?.playerId, "alice");
  assert.equal(getBotStep(final, 1_500, () => 3_000), null);
});
