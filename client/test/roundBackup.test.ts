import assert from "node:assert/strict";
import test from "node:test";
import { createRound } from "../src/game/createRound.ts";
import { logDeal, matchEntries } from "../src/game/matchJournal.ts";
import { decodeRoundBackup, encodeRoundBackup, importRoundKey, newRoundKey } from "../src/game/roundBackup.ts";
import { beginPlay, playTurn } from "../src/game/turn.ts";

test("une sauvegarde chiffrée conserve les cartes et le journal et rebascule les horloges", async () => {
  const players = ["host", "successor"].map((id) => ({ id, pseudo: id, totalScore: 0 }));
  const variants = { sixCards: false, infinitePose: false, plusMinusOne: false, jokerPlus: false };
  const state = beginPlay(logDeal({ ...createRound(players, variants, null), matchId: "table:1" }, 100), 500, () => 0.99);
  const draw = playTurn(state, "successor", 1, { kind: "draw", source: "deck" }, 600);
  const round = { hubId: "table", gameNumber: 1, state: draw, previousGames: [state.journal!] };
  const key = await importRoundKey(newRoundKey());
  const backup = await encodeRoundBackup(round, key, 1_000);
  const bytes = Uint8Array.from(backup).buffer;
  const restored = await decodeRoundBackup("table", 1, bytes, key, () => 10_000);
  assert.deepEqual(restored.state.players, draw.players);
  assert.deepEqual(restored.state.turn!.drawnCard, draw.turn!.drawnCard);
  assert.equal(restored.state.turn!.deadline, draw.turn!.deadline + 9_000);
  assert.equal(JSON.stringify(matchEntries(restored.state.journal)), JSON.stringify(matchEntries(draw.journal)));
  assert.equal(JSON.stringify(matchEntries(restored.previousGames![0])), JSON.stringify(matchEntries(state.journal)));
  await assert.rejects(() => decodeRoundBackup("table", 2, bytes, key, () => 10_000));
  const otherKey = await importRoundKey(newRoundKey());
  await assert.rejects(() => decodeRoundBackup("table", 1, bytes, otherKey, () => 10_000));
});
