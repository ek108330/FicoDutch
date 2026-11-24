const DAY = 86_400_000;
const { dealingMs, memorizationMs } = require("../shared/roundTiming.json");
const minimumRoundMs = dealingMs + memorizationMs;

function repetitionFactor(count) {
  if (count <= 5) return 1;
  if (count <= 10) return 0.5;
  return count <= 15 ? 0.2 : 0;
}

function calculateRatings(players, encounters) {
  if (players.length < 2) return [];
  const participation = 1 + 0.1 * (players.length - 2);
  return players.map((player) => {
    const { accountId, rating, ratedRounds, score, forfeited } = player;
    const coefficient = (ratedRounds < 10 ? 12 : 8) * participation;
    let total = 0;
    for (const opponent of players) {
      if (opponent === player) continue;
      const difference = rating - opponent.rating;
      const expected = 1 / (1 + 10 ** (-difference / 40));
      const order = forfeited === opponent.forfeited
        ? (forfeited ? 0 : opponent.score - score)
        : forfeited ? -1 : 1;
      const actual = order > 0 ? 1 : order < 0 ? 0 : 0.5;
      const change = coefficient * (actual - expected);
      const count = (encounters.get(accountId)?.get(opponent.accountId) ?? 0) + 1;
      total += change > 0
        ? change * repetitionFactor(count) / (1 + (Math.max(0, difference) / 20) ** 2)
        : change;
    }
    return { id: player.id, accountId, before: rating, after: Math.min(99, Math.max(0, rating + total / (players.length - 1))) };
  });
}

function cleanRound(round, seats, previous) {
  if (!Array.isArray(round?.scores) || round.scores.length < 2 || round.scores.length > 6) return null;
  const scores = [...round.scores].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  const ids = new Set();
  for (const { id, score, base, left } of scores.filter(Boolean)) {
    const seat = seats.get(id);
    if (!seat || ids.has(id) || !Number.isInteger(base) || base < 0 || base > 702 || !Number.isInteger(score) ||
        typeof left !== "boolean" || (left && !seat.departure)) return null;
    if (previous ? previous.some((entry) => entry.id === id && entry.left) : !seat.starting) return null;
    ids.add(id);
  }
  if (ids.size !== scores.length) return null;
  const { announcer, emptyHand } = round;
  if ((announcer !== null && !ids.has(announcer)) || (emptyHand !== null && !ids.has(emptyHand))) return null;
  const dutch = scores.find(({ id }) => id === announcer);
  const empty = scores.find(({ id }) => id === emptyHand);
  if (empty && empty.base !== 0) return null;
  const failedDutch = dutch && scores.some((other) => other !== dutch && other.base <= dutch.base);
  const failedEmpty = empty && scores.some((other) => other !== empty && other.base === 0);
  if (scores.some((entry) => entry.score !== entry.base +
      (entry === dutch && failedDutch || entry === empty && failedEmpty ? 10 : 0))) return null;
  const required = previous ? previous.filter(({ left }) => !left).map(({ id }) => id) :
    [...seats.values()].filter(({ starting }) => starting).map(({ seat_id }) => seat_id);
  if (required.some((id) => !ids.has(id) && !(previous && seats.get(id)?.departure))) return null;
  return scores.map(({ id, score, left }) => ({ id, score, left }));
}

async function recordRatedRounds(db, matchId, rounds, referenceTime) {
  if (!Array.isArray(rounds) || !rounds.length || rounds.length > 20) return null;
  return db.transaction(async (tx) => {
    const { rows: [match] } = await tx.query("SELECT started_at, ended_at FROM matches WHERE id = $1 FOR UPDATE", [matchId]);
    if (!match) return null;
    const { rows: registered } = await tx.query("SELECT seat_id, account_id, starting, departure FROM match_seats WHERE match_id = $1", [matchId]);
    const seats = new Map(registered.map((seat) => [seat.seat_id, seat]));
    const { rows: [last] } = await tx.query(
      "SELECT number, scores FROM rated_rounds WHERE match_id = $1 ORDER BY number DESC LIMIT 1", [matchId]);
    let number = last?.number ?? 0;
    let previous = last?.scores;
    const validated = [];
    for (const round of rounds) {
      if (!Number.isSafeInteger(round?.number) || round.number < 1 || round.number > 1_000_000) return null;
      if (round.number <= number && round.number <= (last?.number ?? 0)) continue;
      if (match.ended_at !== null || round.number !== number + 1) return null;
      if ((referenceTime ?? Date.now()) + 1_000 < Number(match.started_at) + round.number * minimumRoundMs) return null;
      const scores = cleanRound(round, seats, previous);
      if (!scores) return null;
      validated.push({ number: ++number, scores });
      previous = scores;
    }
    const results = [];
    if (validated.length) {
      await tx.query("SELECT account_id FROM player_stats WHERE account_id = ANY($1::uuid[]) ORDER BY account_id FOR UPDATE",
        [registered.flatMap(({ account_id }) => account_id ? [account_id] : [])]);
    }
    for (const round of validated) {
      const players = round.scores.flatMap((score) => {
        const { account_id: accountId, departure } = seats.get(score.id);
        return accountId && !(score.left && departure === "removed")
          ? [{ ...score, accountId, forfeited: score.left }] : [];
      });
      const ids = players.map(({ accountId }) => accountId);
      const { rows: stats } = await tx.query(`
        SELECT account_id, rn, rn_rounds, registered_at FROM player_stats JOIN accounts ON accounts.id = account_id
        WHERE account_id = ANY($1::uuid[])
      `, [ids]);
      const at = referenceTime ?? Date.now();
      const encounters = new Map(ids.map((id) => [id, new Map()]));
      const byAccount = new Map(players.map((player) => [player.accountId, player.forfeited ? 713 : player.score]));
      const registeredAt = new Map(stats.map(({ account_id, registered_at }) => [account_id, registered_at]));
      const flags = [];
      if (ids.length >= 2) {
        const { rows: pairs } = await tx.query(`
          SELECT a.account_id AS player, b.account_id AS opponent, count(*)::int AS common,
            (array_agg(sign(b.result_score - a.result_score)::int
              ORDER BY a.at DESC, a.match_id DESC, a.number DESC))[1:7] AS outcomes
          FROM round_rating_entries a JOIN round_rating_entries b USING (match_id, number)
          WHERE a.account_id = ANY($1::uuid[]) AND b.account_id = ANY($1::uuid[])
            AND a.account_id < b.account_id AND a.at > $2 AND a.at <= $3
          GROUP BY a.account_id, b.account_id
        `, [ids, at - DAY, at]);
        for (const { player, opponent, common, outcomes } of pairs) {
          encounters.get(player).set(opponent, common);
          encounters.get(opponent).set(player, common);
          if (common + 1 >= 16) flags.push([player, opponent, "frequent"]);
          const outcome = Math.sign(byAccount.get(opponent) - byAccount.get(player));
          if (!outcome) continue;
          const [winner, loser] = outcome > 0 ? [player, opponent] : [opponent, player];
          if (outcomes.length >= 7 && outcomes.every((value) => value === outcome)) flags.push([winner, loser, "winning-streak"]);
          if (Number(registeredAt.get(loser)) > at - 7 * DAY && common >= 4 && outcomes.every((value) => value === outcome)) {
            flags.push([winner, loser, "recent-account-losses"]);
          }
        }
      }
      const snapshot = new Map(stats.map(({ account_id, rn, rn_rounds }) =>
        [account_id, { rating: rn, ratedRounds: rn_rounds }]));
      const changes = calculateRatings(players.map((player) => ({ ...player, ...snapshot.get(player.accountId) })), encounters);
      await tx.query("INSERT INTO rated_rounds VALUES ($1, $2, $3)", [matchId, round.number, JSON.stringify(round.scores)]);
      if (changes.length) {
        const affected = changes.map(({ accountId }) => accountId);
        const after = changes.map((change) => change.after);
        await tx.query(`
          UPDATE player_stats s SET rn = result.rn, rn_rounds = s.rn_rounds + 1
          FROM unnest($1::uuid[], $2::float8[]) AS result(id, rn) WHERE s.account_id = result.id
        `, [affected, after]);
        await tx.query(`
          INSERT INTO round_rating_entries (match_id, number, at, account_id, before_rn, after_rn, result_score)
          SELECT $1, $2, $3, result.* FROM unnest($4::uuid[], $5::float8[], $6::float8[], $7::smallint[]) result
        `, [matchId, round.number, at, affected, changes.map(({ before }) => before), after,
          affected.map((id) => byAccount.get(id))]);
      }
      if (flags.length) {
        await tx.query(`
          INSERT INTO rating_flags (account_id, opponent_id, kind, last_seen)
          SELECT signals.*, $1 FROM unnest($2::uuid[], $3::uuid[], $4::text[]) signals
          ON CONFLICT (account_id, opponent_id, kind) DO UPDATE SET last_seen = EXCLUDED.last_seen
        `, [at, flags.map(([id]) => id), flags.map(([, id]) => id), flags.map(([, , kind]) => kind)]);
      }
      results.push({ number: round.number, changes });
    }
    return { through: number, results };
  });
}

module.exports = { calculateRatings, recordRatedRounds };
