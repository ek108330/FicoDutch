const assert = require("node:assert/strict");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { openDatabase } = require("./database");
const { createMatchStore, matchId } = require("./matchStore");

test("les bilans sont durables, réservés aux participants et appliqués une seule fois par compte", async (t) => {
  const scratch = resolve(tmpdir());
  const directory = await mkdtemp(join(scratch, "ficodutch-test-"));
  let db = await openDatabase({ local: directory });
  t.after(async () => {
    await db.close();
    if (dirname(resolve(directory)) === scratch) await rm(directory, { recursive: true, force: true });
  });
  const players = ["Alice", "Bobby"].map((pseudo) => ({ id: randomUUID(), accountId: randomUUID(), pseudo }));
  for (const { accountId, pseudo } of players) {
    await db.query("INSERT INTO accounts VALUES ($1, $2, $2, 'test')", [accountId, pseudo]);
    await db.query("INSERT INTO player_stats (account_id) VALUES ($1)", [accountId]);
  }
  let store = createMatchStore(db);
  const hub = { id: randomUUID(), gameNumber: 1, players };
  const id = matchId(hub);
  await store.register(hub);
  assert.equal(await store.hasSeat(id, players[1].accountId), true);
  const stats = {
    rounds: 1,
    players: players.map(({ id: seat }, index) => ({
      id: seat, name: "Ignored", rounds: 1, wins: index === 0 ? 1 : 0, scoreSum: 41 + index, bestScore: 41 + index,
      rank: index + 1, total: 41 + index, eligible: true, reactions: 4,
    })),
    awards: { roisNoirs: [{ players: [players[0].id], value: 1 }] },
  };
  assert.equal(await store.finish(id, "finished", stats), true);
  assert.equal(await store.finish(id, "interrupted", null), true);
  const read = await store.getMatch(id, players[0].accountId);
  assert.equal(read.status, "finished");
  assert.equal(read.players[0].name, "Alice");
  assert.deepEqual(read, await store.getMatch(id, players[1].accountId));
  assert.equal(await store.getMatch(id, randomUUID()), undefined);
  let profile = await store.getProfile(players[0].accountId);
  assert.equal(profile.rating, 1516);
  assert.equal(profile.finished, 1);
  assert.equal(profile.rivals[0].wins, 1);
  assert.equal(profile.encounters[0].opponents[0].name, "Bobby");
  assert.equal(profile.encounters[0].opponents[0].outcome, 1);
  await db.query("UPDATE accounts SET display_name = 'Alice22' WHERE id = $1", [players[0].accountId]);
  await db.close();
  db = await openDatabase({ local: directory });
  store = createMatchStore(db);
  const second = matchId({ ...hub, gameNumber: 2 });
  await store.register({ ...hub, gameNumber: 2 });
  const table = { ...stats, rounds: 2, awards: { shuriken: [{ players: [players[0].id], value: 8 }] } };
  assert.equal(await store.checkpoint(second, 18, stats, table), true);
  assert.equal(await store.checkpoint(second, 15, { ...stats, rounds: 0 }), true);
  await store.finish(second, "interrupted", null);
  const recovered = await store.getMatch(second, players[0].accountId);
  assert.equal(recovered.partial, true);
  assert.equal(recovered.rounds, 1);
  assert.ok(recovered.players.every(({ rank }) => rank === undefined));
  assert.deepEqual(recovered.awards, {});
  profile = await store.getProfile(players[0].accountId);
  assert.equal(profile.name, "Alice22");
  assert.equal(profile.rating, 1516);
  assert.equal(profile.finished, 1);
  assert.equal(profile.interrupted, 1);
  assert.equal(profile.reactions, 8);
  assert.equal(profile.victories, 1);
  assert.equal((await store.listMatches(players[0].accountId)).matches.length, 2);
  const summary = await store.getTableSummary(recovered);
  assert.equal(summary.status, "interrupted");
  assert.equal(summary.rounds, 2);
  assert.equal(summary.awards.shuriken[0].value, 8);
  assert.equal(summary.players[0].rank, 1);
  assert.equal(await store.getMatch(second, randomUUID()), undefined);
  assert.deepEqual((await store.listPlayers("alice", "")).players.map(({ name }) => name), ["Alice22"]);
});
