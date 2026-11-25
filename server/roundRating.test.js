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
    const winnerGain = [2, 2.5, 3, 3.5, 4][count - 2];
    closeTo(results[0], 50 + winnerGain);
    closeTo(results.at(-1), 50 - winnerGain);
    closeTo(results.reduce((sum, rating) => sum + rating, 0), 50 * count);
    assert.deepEqual(ratings(players.map((entry) => ({ ...entry, score: 2 }))), Array(count).fill(50));
  }
  assert.deepEqual(ratings([player(0, 50, 1, 10), player(1, 50, 0, 9)]), [48.5, 51.5]);
  assert.deepEqual(ratings([player(0, 98, 0), player(1, 1, 1)]).map(Math.round), [98, 1]);
  assert.deepEqual(ratings([player(0, 98, 0), player(1, 98, 1)]), [99, 97]);
  assert.deepEqual(ratings([player(0, 1, 0), player(1, 1, 1)]), [2, 0]);
});

test("l’écart et les répétitions réduisent symétriquement le gain et la perte de chaque confrontation", () => {
  const expected = 1 / (1 + 10 ** (-0.5));
  const weak = player(1, 40, 10);
  const favourite = player(0, 60, 0);
  const repeated = (prior) => new Map([[0, new Map([[1, prior]])], [1, new Map([[0, prior]])]]);
  for (const [prior, multiplier] of [[4, 1], [5, 0.5], [9, 0.5], [10, 0.2], [14, 0.2], [15, 0]]) {
    const [wins, loses] = ratings([favourite, weak], repeated(prior));
    closeTo(wins, 60 + 4 * (1 - expected) * 0.5 * multiplier);
    closeTo(loses, 40 - 4 * (1 - expected) * 0.5 * multiplier);
  }
  const upset = ratings([{ ...favourite, score: 20 }, weak], repeated(5));
  closeTo(upset[0], 60 - 2 * expected);
  closeTo(upset[1], 40 + 2 * expected);
  const mixed = [player(0, 98, 0, 10), player(1, 0, 1), player(2, 40, 2)];
  closeTo(ratings(mixed).reduce((sum, rating) => sum + rating, 0), 138);
  closeTo(ratings([favourite, weak, player(2, 60, 30)], repeated(15))[0], 61.25);
  assert.deepEqual(ratings([player(0, 50, 0, 0, true), player(1, 50, 13)]), [48, 52]);
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
  assert.equal((await store.getProfile(betty.accountId)).rating, 52);
  await store.addSeat(first, celine);
  const next = round(2, [score(azure, 0, 0, true), score(betty, 4), score(celine, 1)]);
  assert.equal(await store.recordRounds(first, [next], now + 100_000), null);
  await store.recordDeparture(first, azure.id, "left");
  const { results: [result] } = await store.recordRounds(first, [next], now + 100_000);
  assert.ok(result.changes.find(({ id }) => id === azure.id).after < 48);
  const returned = round(3, [score(azure, 2), score(betty, 1), score(celine, 2)]);
  assert.ok((await store.recordRounds(first, [returned], now + 100_000)).results[0].changes
    .some(({ id }) => id === azure.id));
  assert.equal(await store.finish(first, "interrupted"), true);
  assert.equal(await store.recordRounds(first, [round(4, [score(azure, 2), score(betty, 1), score(celine, 2)])], now + 200_000), null);
  const profile = await store.getProfile(azure.accountId);
  assert.equal(profile.ratings.length, 3);
  const rivalry = profile.rivals.find(({ id }) => id === celine.accountId);
  assert.deepEqual([rivalry.played, rivalry.wins, rivalry.losses], [2, 0, 1]);
  assert.equal(profile.rating, profile.ratings.at(-1).rating);
  const week = 7 * 24 * 60 * 60 * 1_000;
  const readAzure = async (at) => (await store.listPlayers("azure", null, 1, at)).players[0];
  assert.equal((await readAzure(now + week)).ratingWeekStart, 50);
  assert.equal((await readAzure(now + week + 1)).ratingWeekStart, profile.ratings[0].rating);
  assert.equal((await readAzure(now + week + 100_001)).ratingWeekStart, null);
  const weekFirstPage = await store.listSortedPlayers("", "week", "desc", 0, 1, now + 100_000);
  assert.ok(weekFirstPage.players[0].rating > weekFirstPage.players[0].ratingWeekStart);
  assert.equal(weekFirstPage.next, "1");
  const weekSecondPage = await store.listSortedPlayers("", "week", "desc", Number(weekFirstPage.next), 3, now + 100_000);
  assert.equal(weekSecondPage.players.at(-1).ratingWeekStart, null);
  assert.ok(weekSecondPage.players.every(({ id }) => id !== weekFirstPage.players[0].id));
  assert.deepEqual((await store.listSortedPlayers("", "name", "asc", 0, 2)).players.map(({ name }) => name), ["Azure", "Betty"]);

  await db.query("UPDATE player_stats SET rn = 50, matches = 4, rounds = 4, round_wins = 1");
  await db.query("UPDATE player_stats SET matches = 6 WHERE account_id = $1", [denis.accountId]);
  await db.query("UPDATE player_stats SET round_wins = 2 WHERE account_id = $1", [celine.accountId]);
  const { players: podium, next: cursor } = await store.listPlayers("", null, 2);
  assert.deepEqual(podium.map(({ name }) => name), ["Denis", "Celine"]);
  assert.equal(podium[1].roundWinRate, 0.5);
  assert.equal(podium[1].rounds, 4);
  assert.ok(cursor);
  assert.equal((await store.listPlayers("", podium[1])).players.length, 2);
  const { players: ranked, next: nextRank } = await store.listSortedPlayers("", "position", "asc", 0, 1);
  assert.deepEqual(ranked.map(({ name, position }) => [name, position]), [["Denis", 1]]);
  const { players: nextRanked } = await store.listSortedPlayers("", "position", "asc", Number(nextRank), 1);
  assert.deepEqual(nextRanked.map(({ name, position }) => [name, position]), [["Celine", 2]]);
  const { players: searched } = await store.listSortedPlayers("cel", "name", "asc", 0);
  assert.deepEqual(searched.map(({ name, position }) => [name, position]), [["Celine", 2]]);
  await db.query("UPDATE player_stats SET rounds = 0, rn = 99 WHERE account_id = $1", [betty.accountId]);
  const { players: ascending } = await store.listSortedPlayers("", "position", "asc", 0);
  assert.deepEqual(ascending.map(({ position }) => position), [1, 2, 3, null]);
  assert.equal(ascending.at(-1).id, betty.accountId);
  const { players: descending } = await store.listSortedPlayers("", "rating", "desc", 0);
  assert.equal(descending.at(-1).id, betty.accountId);
  const { players: olderPage } = await store.listPlayers("", ascending.at(-2), 1);
  assert.equal(olderPage[0].id, betty.accountId);
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
