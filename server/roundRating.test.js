const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const test = require("node:test");
const { openDatabase } = require("./database");
const { createMatchStore, matchId } = require("./matchStore");
const { calculateRatings } = require("./roundRating");

const player = (id, rating, score, ratedRounds = 0, forfeited = false) =>
  ({ id, accountId: id, rating, score, ratedRounds, forfeited });
const ratings = (players, encounters = new Map()) => calculateRatings(players, encounters).map(({ after }) => after);
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test("le RN utilise les scores simultanés, les égalités et la taille de la table", () => {
  for (let count = 2; count <= 6; count++) {
    const players = Array.from({ length: count }, (_, id) => player(id, 50, id));
    const results = ratings(players);
    closeTo(results[0], 50 + 6 * (1 + 0.1 * (count - 2)));
    closeTo(results.at(-1), 50 - 6 * (1 + 0.1 * (count - 2)));
    assert.deepEqual(ratings(players.map((entry) => ({ ...entry, score: 2 }))), Array(count).fill(50));
  }
  assert.deepEqual(ratings([player(0, 50, 1, 10), player(1, 50, 0, 9)]), [46, 56]);
  assert.deepEqual(ratings([player(0, 98, 0), player(1, 1, 1)]).map(Math.round), [98, 1]);
  assert.deepEqual(ratings([player(0, 98, 0), player(1, 98, 1)]), [99, 92]);
  assert.deepEqual(ratings([player(0, 1, 0), player(1, 1, 1)]), [7, 0]);
});

test("l’écart et les répétitions ne réduisent que le gain contre l’adversaire concerné", () => {
  const expected = 1 / (1 + 10 ** (-0.5));
  const weak = player(1, 40, 10);
  const favourite = player(0, 60, 0);
  const repeated = (prior) => new Map([[0, new Map([[1, prior]])], [1, new Map([[0, prior]])]]);
  for (const [prior, multiplier] of [[4, 1], [5, 0.5], [9, 0.5], [10, 0.2], [14, 0.2], [15, 0]]) {
    const [wins, loses] = ratings([favourite, weak], repeated(prior));
    closeTo(wins, 60 + 12 * (1 - expected) * 0.5 * multiplier);
    closeTo(loses, 40 - 12 * (1 - expected));
  }
  closeTo(ratings([{ ...favourite, score: 20 }, weak], repeated(15))[0], 60 - 12 * expected);
  closeTo(ratings([favourite, weak, player(2, 60, 30)], repeated(15))[0], 63.3);
  assert.deepEqual(ratings([player(0, 50, 0, 0, true), player(1, 50, 13)]), [44, 56]);
});

test("le serveur valide les manches et les forfaits, mémorise le RN et départage le podium", async (t) => {
  const db = await openDatabase({ local: "memory://" });
  t.after(() => db.close());
  const store = createMatchStore(db);
  const players = ["Azure", "Betty", "Celine", "Denis"].map((pseudo) => ({ id: randomUUID(), accountId: randomUUID(), pseudo }));
  for (const { accountId, pseudo } of players) {
    await db.query("INSERT INTO accounts (id, handle, display_name, password_hash) VALUES ($1, $2, $2, 'test')", [accountId, pseudo]);
    await db.query("INSERT INTO player_stats (account_id) VALUES ($1)", [accountId]);
  }
  const now = 1_000_000_000;
  const hub = { id: randomUUID(), gameNumber: 1, players: players.slice(0, 2) };
  const first = matchId(hub);
  await store.register(hub, now - 60_000);
  const round = (number, scores, announcer = null) => ({ number, scores, announcer, emptyHand: null });
  const score = (p, base, points = base, left = false) => ({ id: p.id, base, score: points, left });
  const [azure, betty, celine, denis] = players;
  const scores = [score(azure, 3, 13), score(betty, 3)];
  assert.equal(await store.recordRounds(first, [round(2, scores, azure.id)], now), null);
  assert.equal(await store.recordRounds(first, [round(1, scores)], now), null);
  assert.equal(await store.recordRounds(first, [round(1, [score(azure, 3), score(celine, 4)])], now), null);
  const dutch = round(1, scores, azure.id);
  const [saved, duplicate] = await Promise.all([store.recordRounds(first, [dutch], now), store.recordRounds(first, [dutch], now)]);
  assert.equal(saved.results.length + duplicate.results.length, 1);
  assert.equal((await store.getProfile(betty.accountId)).rating, 56);
  await store.addSeat(first, celine);
  const next = round(2, [score(azure, 0, 0, true), score(betty, 4), score(celine, 1)]);
  assert.equal(await store.recordRounds(first, [next], now + 100_000), null);
  await store.recordDeparture(first, azure.id, "left");
  const { results: [result] } = await store.recordRounds(first, [next], now + 100_000);
  assert.ok(result.changes.find(({ id }) => id === azure.id).after < 44);
  assert.equal(await store.finish(first, "interrupted"), true);
  assert.equal(await store.recordRounds(first, [round(3, [score(betty, 1), score(celine, 2)])], now + 200_000), null);
  const profile = await store.getProfile(azure.accountId);
  assert.equal(profile.ratings.length, 2);
  assert.equal(profile.rating, profile.ratings.at(-1).rating);

  await db.query("UPDATE player_stats SET rn = 50, matches = 4, rounds = 4, round_wins = 1");
  await db.query("UPDATE player_stats SET matches = 6 WHERE account_id = $1", [denis.accountId]);
  await db.query("UPDATE player_stats SET round_wins = 2 WHERE account_id = $1", [celine.accountId]);
  const { players: podium, next: cursor } = await store.listPlayers("", null, 2);
  assert.deepEqual(podium.map(({ name }) => name), ["Denis", "Celine"]);
  assert.equal(podium[1].roundWinRate, 0.5);
  assert.ok(cursor);
  assert.equal((await store.listPlayers("", podium[1])).players.length, 2);
  await store.reportHistory(denis.accountId, azure.accountId, now);
  await store.reportHistory(denis.accountId, azure.accountId, now + 100);
  const { rows: reports } = await db.query("SELECT reported_at FROM rating_reports");
  assert.deepEqual(reports.map(({ reported_at }) => Number(reported_at)), [now]);

  const repeatedHub = { id: randomUUID(), gameNumber: 1, players: [denis, celine] };
  const repeatedId = matchId(repeatedHub);
  const start = now + 200_000;
  await store.register(repeatedHub, start);
  await db.query("UPDATE accounts SET registered_at = $1 WHERE id = $2", [start, celine.accountId]);
  for (let number = 1; number <= 16; number++) {
    const { results: [record] } = await store.recordRounds(repeatedId,
      [round(number, [score(denis, 1), score(celine, 3)])], start + number * 20_000);
    const win = record.changes.find(({ id }) => id === denis.id);
    if (number === 16) assert.equal(win.before, win.after);
  }
  const { rows: flags } = await db.query("SELECT kind FROM rating_flags ORDER BY kind");
  assert.deepEqual(flags.map(({ kind }) => kind), ["frequent", "recent-account-losses", "winning-streak"]);
  const { results: [afterWindow] } = await store.recordRounds(repeatedId,
    [round(17, [score(denis, 1), score(celine, 3)])], start + 86_800_000);
  const winner = afterWindow.changes.find(({ id }) => id === denis.id);
  assert.ok(winner.after > winner.before);
});
