const assert = require("node:assert/strict");
const test = require("node:test");
const { openDatabase } = require("./database");
const { createMatchStore } = require("./matchStore");
const { seedDemoPopulation } = require("./demoPopulation");

test("les 15 bots conservent leur historique et les six profils demandés jouent sur plusieurs jours", async (t) => {
  const db = await openDatabase({ local: "memory://" });
  t.after(() => db.close());
  const store = createMatchStore(db);
  const bots = await seedDemoPopulation(db, store);
  assert.deepEqual(bots.map(({ name }) => name), ["ChaBotté", "BotEnTrain", "HarryBotter", "Botus", "RobinDesBots", "Botman",
    "Botzilla", "James Bot", "SherlockBot", "ValteriBotAs", "Bottin", "BotRoyal", "Bipbipbot", "Bottine", "Bot27Lieues"]);
  const profileBefore = await store.getProfile(bots[0].id);
  await db.query("UPDATE accounts SET handle = 'BotAtlas', display_name = 'BotAtlas' WHERE id = $1", [bots[0].id]);
  assert.deepEqual(await seedDemoPopulation(db, store), bots);
  const { rows: [totals] } = await db.query("SELECT count(*)::int AS matches FROM matches WHERE ended_at IS NOT NULL");
  assert.equal(totals.matches, 142);
  const { rows: days } = await db.query(`
    SELECT s.account_id, count(DISTINCT floor(m.started_at / 86400000.0))::int AS days
    FROM match_seats s JOIN matches m ON m.id = s.match_id
    WHERE m.id >= 'f1c0d002-0000-4000-8000-000000000101:1'
    GROUP BY s.account_id
  `);
  assert.deepEqual(new Set(days.map(({ account_id }) => account_id)), new Set([bots[7], ...bots.slice(10)].map(({ id }) => id)));
  assert.ok(days.every((entry) => entry.days >= 7));
  const { players: [james] } = await store.listSortedPlayers("jamesbot", "name", "asc", 0);
  assert.equal(james.id, bots[7].id);
  assert.equal(james.name, "James Bot");
  assert.ok((await store.listBots()).every(({ matches }) => matches > 0));
  const profile = await store.getProfile(bots[0].id);
  assert.deepEqual(profile, profileBefore);
  assert.ok(profile.matches && profile.demoBot && profile.encounters.length);
  assert.equal(await store.nameReserved("chabotte"), true);
});
