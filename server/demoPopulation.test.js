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
  assert.equal(bots.length, 10);
  await seedDemoPopulation(db, store);
  const { rows: [totals] } = await db.query("SELECT count(*)::int AS matches FROM matches WHERE ended_at IS NOT NULL");
  assert.equal(totals.matches, 100);
  assert.ok((await store.listBots()).every(({ matches }) => matches > 0));
  const profile = await store.getProfile(bots[0].id);
  assert.ok(profile.matches && profile.demoBot && profile.encounters.length);
});
