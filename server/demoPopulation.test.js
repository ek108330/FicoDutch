const assert = require("node:assert/strict");
const test = require("node:test");
const { openDatabase } = require("./database");
const { createMatchStore } = require("./matchStore");
const { seedDemoPopulation } = require("./demoPopulation");

test("la population simule et enregistre 100 parties une seule fois pour 10 bots", async (t) => {
  const db = await openDatabase({ local: "memory://" });
  t.after(() => db.close());
  const store = createMatchStore(db);
  const bots = await seedDemoPopulation(db, store);
  assert.deepEqual(bots.map(({ name }) => name), ["ChaBotté", "BotEnTrain", "HarryBotter", "Botus", "RobinDesBots", "Botman",
    "Botzilla", "JamesBot", "SherlockBot", "ValteriBotAs"]);
  const profileBefore = await store.getProfile(bots[0].id);
  await db.query("UPDATE accounts SET handle = 'BotAtlas', display_name = 'BotAtlas' WHERE id = $1", [bots[0].id]);
  assert.deepEqual(await seedDemoPopulation(db, store), bots);
  const { rows: [totals] } = await db.query("SELECT count(*)::int AS matches FROM matches WHERE ended_at IS NOT NULL");
  assert.equal(totals.matches, 100);
  assert.ok((await store.listBots()).every(({ matches }) => matches > 0));
  const profile = await store.getProfile(bots[0].id);
  assert.deepEqual(profile, profileBefore);
  assert.ok(profile.matches && profile.demoBot && profile.encounters.length);
  assert.equal(await store.nameReserved("chabotte"), true);
});
