const { uuidPattern } = require("./accounts");
const { createHash } = require("node:crypto");
const seatHash = (token) => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
  ? createHash("sha256").update(token).digest("hex") : null;

const matchId = (hub) => `${hub.id}:${hub.gameNumber}`;
const matchPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:[1-9][0-9]{0,8}$/;
const awardIds = [
  "shuriken", "luckyLuke", "boulet", "cible", "pyromane", "roisNoirs", "distributeur",
  "victime", "rivalite", "meilleur", "pire", "voleur", "bourreau",
];
const privateAwards = new Set(["roisNoirs", "meilleur", "pire"]);
const integer = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
const count = (value) => integer(value) ? value : 0;
const cardIdPattern = /^(?:(?:hearts|diamonds|clubs|spades)-(?:[2-9]|10|[AJQK])|joker-[12])$/;

function cleanReport(raw, seats, status, partial) {
  if (!Array.isArray(raw?.players) || raw.players.length > seats.length || !integer(raw.rounds)) return null;
  const roster = new Map(seats.map((row) => [row.seat_id, row]));
  const players = [];
  const ids = new Set();
  for (const entry of raw.players) {
    const seat = roster.get(entry?.id);
    if (!seat || ids.has(seat.seat_id)) return null;
    ids.add(seat.seat_id);
    players.push({
      id: seat.seat_id, name: seat.name, ...(seat.account_id && { accountId: seat.account_id }),
      rounds: Math.min(count(entry.rounds), raw.rounds), wins: Math.min(count(entry.wins), raw.rounds),
      scoreSum: count(entry.scoreSum), bestScore: integer(entry.bestScore) ? entry.bestScore : null,
      dutch: Math.min(count(entry.dutch), raw.rounds + (status === "interrupted" ? 1 : 0)),
      dutchWon: Math.min(count(entry.dutchWon), raw.rounds),
      reactions: count(entry.reactions), penalties: count(entry.penalties), exchanges: count(entry.exchanges),
      ...(status === "finished" && integer(entry.rank) && entry.rank > 0 && entry.rank <= raw.players.length &&
        integer(entry.total) && { rank: entry.rank, total: entry.total, eligible: entry.eligible === true }),
    });
  }
  if (status === "finished" && (!raw.rounds || !players.some(({ rank }) => rank === 1))) return null;
  const awards = {};
  for (const key of awardIds) {
    const candidates = raw.awards?.[key];
    if (!Array.isArray(candidates) || (partial && privateAwards.has(key))) continue;
    const arity = key === "victime" || key === "rivalite" ? 2 : 1;
    const clean = candidates.slice(0, seats.length * 6).flatMap((award) => {
      if (!Array.isArray(award?.players) || award.players.length !== arity ||
          new Set(award.players).size !== arity || !award.players.every((id) => ids.has(id)) ||
          !Number.isFinite(award.value) || award.value < 0 || award.value > 1_000_000_000) return [];
      const hiddenValue = partial && (key === "boulet" || key === "distributeur");
      const exchange = key === "pire" && award.exchange;
      const validExchange = exchange && ids.has(exchange.opponentId) && exchange.opponentId !== award.players[0] &&
        [exchange.given, exchange.received].every((card) => typeof card === "string" && cardIdPattern.test(card));
      return [{ players: award.players, value: award.value, ...(!hiddenValue && integer(award.extra) && { extra: award.extra }),
        ...(validExchange && { exchange: { opponentId: exchange.opponentId, given: exchange.given, received: exchange.received } }) }];
    });
    if (clean.length) awards[key] = clean;
  }
  const unfinished = status === "interrupted" && raw.unfinished?.round === raw.rounds + 1 ? {
    round: raw.unfinished.round, reactions: count(raw.unfinished.reactions), penalties: count(raw.unfinished.penalties),
    exchanges: count(raw.unfinished.exchanges), gifts: count(raw.unfinished.gifts),
  } : undefined;
  return { status, partial, rounds: raw.rounds, players, awards, ...(unfinished && { unfinished }) };
}

function ratingUpdates(players, ratings) {
  const changes = new Map();
  if (players.length < 2) return changes;
  for (const player of players) {
    const rating = ratings.get(player.accountId);
    const delta = players.reduce((sum, opponent) => {
      if (opponent === player) return sum;
      const expected = 1 / (1 + 10 ** ((ratings.get(opponent.accountId) - rating) / 400));
      const actual = player.rank < opponent.rank ? 1 : player.rank === opponent.rank ? 0.5 : 0;
      return sum + actual - expected;
    }, 0);
    changes.set(player.accountId, Math.max(0, Math.round(rating + 32 * delta / (players.length - 1))));
  }
  return changes;
}

function createMatchStore(db) {
  async function addSeat(source, id, seat, starting = false) {
    await source.query(`
      INSERT INTO match_seats (match_id, seat_id, account_id, name, starting, guest_token_hash) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (match_id, seat_id) DO NOTHING
    `, [id, seat.id, seat.accountId ?? null, seat.pseudo, starting, seat.accountId ? null : seatHash(seat.token)]);
  }

  async function register(hub, now = Date.now()) {
    const id = matchId(hub);
    return db.transaction(async (tx) => {
      await tx.query("INSERT INTO matches (id, started_at, checkpoint_at) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING", [id, now]);
      for (const seat of hub.players) await addSeat(tx, id, seat, true);
    });
  }

  async function hasSeat(id, accountId) {
    const { rows } = await db.query("SELECT 1 FROM match_seats WHERE match_id = $1 AND account_id = $2", [id, accountId]);
    return rows.length > 0;
  }

  async function nameReserved(name) {
    const { rows } = await db.query("SELECT 1 FROM accounts WHERE lower(handle) = lower($1) OR lower(display_name) = lower($1) LIMIT 1", [name]);
    return rows.length > 0;
  }

  async function getSeats(source, id) {
    const { rows } = await source.query("SELECT seat_id, account_id, name, starting FROM match_seats WHERE match_id = $1", [id]);
    return rows;
  }

  async function cleanTable(source, id, raw, partial) {
    if (!raw) return null;
    const { rows } = await source.query(`
      SELECT DISTINCT ON (s.seat_id) s.seat_id, s.account_id, s.name
      FROM match_seats s JOIN matches m ON m.id = s.match_id
      WHERE m.id LIKE $1 ORDER BY s.seat_id, m.started_at DESC, m.id DESC
    `, [id.split(":")[0] + ":%"]);
    return cleanReport(raw, rows, "interrupted", partial);
  }

  async function checkpoint(id, sequence, raw, table) {
    if (!integer(sequence) || sequence < 1) return false;
    const report = cleanReport(raw, await getSeats(db, id), "interrupted", true);
    if (!report) return false;
    const summary = await cleanTable(db, id, table, true);
    if (summary) report.table = summary;
    await db.query(`
      UPDATE matches SET sequence = $2, checkpoint = $3, checkpoint_at = $4
      WHERE id = $1 AND ended_at IS NULL AND sequence < $2
    `, [id, sequence, report, Date.now()]);
    return true;
  }

  async function updateProfiles(tx, id, report, now) {
    const people = report.players.filter(({ accountId }) => accountId).sort((a, b) => a.accountId.localeCompare(b.accountId));
    if (!people.length) return;
    const ranked = people.filter(({ eligible, rank }) => eligible && rank !== undefined);
    const opponents = people.filter(({ rank }) => rank !== undefined);
    const { rows } = await tx.query(`
      SELECT account_id, rating FROM player_stats WHERE account_id = ANY($1::uuid[]) ORDER BY account_id FOR UPDATE
    `, [people.map(({ accountId }) => accountId)]);
    const changes = ratingUpdates(ranked, new Map(rows.map(({ account_id, rating }) => [account_id, rating])));
    const finished = report.status === "finished" ? 1 : 0;
    for (const entry of people) {
      const rating = changes.get(entry.accountId) ?? null;
      await tx.query(`
        UPDATE player_stats SET rating = COALESCE($2, rating), matches = matches + 1,
          finished = finished + $3, interrupted = interrupted + $4, victories = victories + $5,
          rounds = rounds + $6, round_wins = round_wins + $7, score_sum = score_sum + $8,
          best_score = LEAST(best_score, $9), dutch = dutch + $10, dutch_won = dutch_won + $11,
          reactions = reactions + $12, penalties = penalties + $13, exchanges = exchanges + $14
        WHERE account_id = $1
      `, [entry.accountId, rating, finished, 1 - finished, entry.rank === 1 ? 1 : 0,
        entry.rounds, entry.wins, entry.scoreSum, entry.bestScore, entry.dutch, entry.dutchWon,
        entry.reactions, entry.penalties, entry.exchanges]);
      const encounters = entry.rank === undefined ? [] : opponents.filter((other) => other !== entry)
        .map((other) => ({ id: other.accountId, outcome: Math.sign(other.rank - entry.rank) }));
      await tx.query(`
        INSERT INTO account_matches (account_id, match_id, ended_at, status, rating, opponents) VALUES ($1, $2, $3, $4, $5, $6)
      `, [entry.accountId, id, now, report.status, rating, JSON.stringify(encounters)]);
    }
    if (opponents.length < 2) return;
    await tx.query(`
      WITH people AS (SELECT * FROM unnest($1::uuid[], $2::int[]) AS people(id, rank))
      INSERT INTO rivalries (account_id, rival_id, played, wins, losses)
      SELECT a.id, b.id, 1, (a.rank < b.rank)::int, (a.rank > b.rank)::int FROM people a CROSS JOIN people b WHERE a.id <> b.id
      ON CONFLICT (account_id, rival_id) DO UPDATE SET played = rivalries.played + 1,
        wins = rivalries.wins + EXCLUDED.wins, losses = rivalries.losses + EXCLUDED.losses
    `, [opponents.map(({ accountId }) => accountId), opponents.map(({ rank }) => rank)]);
  }

  async function finish(id, status, raw, now = Date.now(), table) {
    return db.transaction(async (tx) => {
      const { rows } = await tx.query("SELECT ended_at, checkpoint, report FROM matches WHERE id = $1 FOR UPDATE", [id]);
      const match = rows[0];
      if (!match) return false;
      if (match.ended_at !== null) return true;
      let report;
      if (raw) {
        report = cleanReport(raw, await getSeats(tx, id), status, false);
        if (!report) return false;
        const summary = await cleanTable(tx, id, table, false);
        if (summary) report.table = summary;
      } else if (status === "interrupted") {
        report = match.checkpoint ?? {
          status, partial: true, rounds: 0, awards: {}, players: (await getSeats(tx, id)).filter((seat) => seat.starting).map((seat) => ({
            id: seat.seat_id, name: seat.name, ...(seat.account_id && { accountId: seat.account_id }),
            rounds: 0, wins: 0, scoreSum: 0, bestScore: null, dutch: 0, dutchWon: 0, reactions: 0, penalties: 0, exchanges: 0,
          })),
        };
      }
      if (!report) return false;
      await updateProfiles(tx, id, report, now);
      await tx.query("UPDATE matches SET ended_at = $2, report = $3, checkpoint = NULL WHERE id = $1", [id, now, report]);
      return true;
    });
  }

  async function getMatch(id, accountId, guestToken) {
    const { rows } = await db.query(`
      SELECT m.report, m.started_at, m.ended_at FROM matches m JOIN match_seats s ON s.match_id = m.id
      WHERE m.id = $1 AND (s.account_id = $2 OR s.guest_token_hash = $3) AND m.ended_at IS NOT NULL LIMIT 1
    `, [id, accountId ?? null, seatHash(guestToken)]);
    const row = rows[0];
    return row && { id, ...row.report, startedAt: Number(row.started_at), endedAt: Number(row.ended_at) };
  }

  async function getTableSummary(match) {
    const { rows } = await db.query(`
      SELECT m.id, m.started_at, m.report->>'status' AS status, m.report->'players' AS players,
        m.report->'rounds' AS rounds, m.report ? 'unfinished' AS unfinished
      FROM matches m WHERE m.id LIKE $1 AND m.ended_at IS NOT NULL AND m.started_at <= $2
      ORDER BY m.started_at DESC, m.id DESC
    `, [match.id.split(":")[0] + ":%", match.startedAt]);
    const { table, ...report } = match;
    const summary = table ? { ...report, ...table, status: report.status } : report;
    const official = rows.find(({ status }) => status === "finished");
    const playerKey = ({ accountId, id }) => accountId ?? id;
    const ranks = new Map(official?.players.filter(({ rank }) => rank !== undefined).map((player) => [playerKey(player), player]));
    const players = summary.players.map((player) => {
      const key = playerKey(player);
      const ranked = ranks.get(key);
      ranks.delete(key);
      return ranked ? { ...player, rank: ranked.rank, total: ranked.total } : player;
    });
    return { ...summary, players: [...players, ...ranks.values()],
      startedAt: Number(rows.at(-1)?.started_at ?? report.startedAt),
      games: rows.length,
      totalRounds: rows.reduce((total, { rounds, unfinished }) => total + rounds + Number(unfinished), 0),
      playerCount: new Set(rows.flatMap(({ players }) => players.map(playerKey))).size,
      scopeIncomplete: rows.length > 1 && !table };
  }

  async function listPlayers(query, cursor = null) {
    const { rows } = await db.query(`
      SELECT a.id, a.display_name AS name, a.is_demo_bot AS "demoBot", s.matches, s.rating,
        a.avatar_style AS "avatarStyle", a.avatar_photo_id AS "avatarPhotoId"
      FROM accounts a JOIN player_stats s ON a.id = s.account_id
      WHERE lower(a.display_name) LIKE $1 AND
        ($2::int IS NULL OR s.rating < $2 OR (s.rating = $2 AND a.id > $3::uuid))
      ORDER BY s.rating DESC, s.account_id LIMIT 31
    `, [query + "%", cursor?.rating ?? null, cursor?.id ?? null]);
    const players = rows.slice(0, 30);
    const last = players.at(-1);
    return { players, next: rows.length > players.length ? `${last.rating}/${last.id}` : null };
  }

  async function getProfile(id) {
    const { rows } = await db.query(`
      SELECT a.display_name, a.is_demo_bot, a.avatar_style, a.avatar_photo_id, s.*
      FROM player_stats s JOIN accounts a ON a.id = s.account_id WHERE a.id = $1
    `, [id]);
    const row = rows[0];
    if (!row) return null;
    const [history, encounters, rivalry] = await Promise.all([
      db.query(`
        SELECT rating, ended_at FROM account_matches WHERE account_id = $1 AND rating IS NOT NULL ORDER BY ended_at DESC LIMIT 30
      `, [id]),
      db.query(`
        WITH recent AS (
          SELECT match_id, ended_at, opponents FROM account_matches WHERE account_id = $1 AND status = 'finished'
          ORDER BY ended_at DESC LIMIT 12
        )
        SELECT recent.ended_at, jsonb_agg(jsonb_build_object('id', a.id, 'name', a.display_name, 'outcome', rival.outcome)
          ORDER BY a.display_name) AS opponents FROM recent
        CROSS JOIN LATERAL jsonb_to_recordset(recent.opponents) AS rival(id uuid, outcome int)
        JOIN accounts a ON a.id = rival.id GROUP BY recent.match_id, recent.ended_at ORDER BY recent.ended_at DESC
      `, [id]),
      db.query(`
        WITH top AS (
          (SELECT * FROM rivalries WHERE account_id = $1 ORDER BY played DESC, rival_id LIMIT 12)
          UNION (SELECT * FROM rivalries WHERE account_id = $1 AND wins > losses ORDER BY played DESC, rival_id LIMIT 8)
          UNION (SELECT * FROM rivalries WHERE account_id = $1 AND losses > wins ORDER BY played DESC, rival_id LIMIT 8)
        ) SELECT a.id, a.display_name AS name, played, wins, losses FROM top
          JOIN accounts a ON a.id = top.rival_id ORDER BY played DESC, name
      `, [id]),
    ]);
    return {
      id, name: row.display_name, demoBot: row.is_demo_bot, rating: row.rating, matches: row.matches, finished: row.finished, interrupted: row.interrupted,
      ...(row.avatar_style != null && { avatarStyle: row.avatar_style }),
      ...(row.avatar_photo_id && { avatarPhotoId: row.avatar_photo_id }),
      victories: row.victories, rounds: row.rounds, roundWins: row.round_wins, scoreSum: Number(row.score_sum),
      bestScore: row.best_score, dutch: row.dutch, dutchWon: row.dutch_won, reactions: row.reactions, penalties: row.penalties,
      exchanges: row.exchanges, rivals: rivalry.rows,
      ratings: history.rows.reverse().map(({ rating, ended_at }) => ({ rating, date: Number(ended_at) })),
      encounters: encounters.rows.map(({ opponents, ended_at }) => ({ opponents, date: Number(ended_at) })),
    };
  }

  async function listMatches(accountId, cursor) {
    const { rows } = await db.query(`
      SELECT match_id AS id, ended_at, status FROM account_matches WHERE account_id = $1
      AND ($2::bigint IS NULL OR (ended_at, match_id) < ($2, $3))
      ORDER BY ended_at DESC, match_id DESC LIMIT 31
    `, [accountId, cursor?.date ?? null, cursor?.id ?? null]);
    const matches = rows.slice(0, 30).map(({ id, ended_at, status }) => ({ id, date: Number(ended_at), status }));
    const last = matches.at(-1);
    return { matches, next: rows.length > matches.length ? `${last.date}/${last.id}` : null };
  }

  async function staleMatches(before, active) {
    const { rows } = await db.query(`
      SELECT id FROM matches WHERE ended_at IS NULL AND checkpoint_at <= $1 AND NOT (id = ANY($2::text[]))
      ORDER BY checkpoint_at LIMIT 100
    `, [before, active]);
    return rows.map(({ id }) => id);
  }

  async function listBots() {
    const { rows } = await db.query(`
      SELECT a.id, a.display_name AS name, s.matches FROM accounts a JOIN player_stats s ON a.id = s.account_id
      WHERE a.is_demo_bot ORDER BY a.display_name
    `);
    return rows;
  }

  return { register, addSeat: (id, seat) => addSeat(db, id, seat), hasSeat, nameReserved, checkpoint, finish,
    getMatch, getTableSummary, getProfile, listPlayers, listMatches, listBots, staleMatches };
}

function mountMatchRoutes(app, store, readAccount) {
  app.get("/api/matches/recent", async (request, response) => {
    const session = await readAccount(request.headers);
    response.set("Cache-Control", "no-store");
    if (!session) return response.status(401).json({ error: "Connecte-toi pour retrouver tes parties." });
    const before = request.query.before;
    const cursor = typeof before === "string" ? before.split("/") : [];
    if (before !== undefined && (cursor.length !== 2 || !/^\d{1,15}$/.test(cursor[0]) || !matchPattern.test(cursor[1]))) {
      return response.status(400).json({ error: "Page d’historique invalide." });
    }
    response.json(await store.listMatches(session.account.id, cursor.length ? { date: Number(cursor[0]), id: cursor[1] } : null));
  });
  app.get("/api/matches/:id", async (request, response) => {
    const session = await readAccount(request.headers);
    const guestToken = request.get("X-FicoDutch-Seat");
    response.set("Cache-Control", "no-store");
    if (!session && !seatHash(guestToken)) return response.status(401).json({ error: "Connecte-toi pour consulter ce bilan." });
    const match = matchPattern.test(request.params.id) && await store.getMatch(request.params.id, session?.account.id, guestToken);
    if (!match) return response.status(404).json({ error: "Ce bilan est introuvable ou n’est pas encore disponible." });
    if (request.query.table === "1") {
      return response.json(await store.getTableSummary(match));
    }
    const { table: _table, ...report } = match;
    response.json(report);
  });
  app.get("/api/demo-bots", async (_request, response) => {
    response.set("Cache-Control", "public, max-age=30").json(await store.listBots());
  });
  app.get("/api/players", async (request, response) => {
    const { q = "", after = "" } = request.query;
    if (typeof q !== "string" || !/^[\p{L}0-9]{0,15}$/u.test(q)) {
      return response.status(400).json({ error: "Saisis au plus 15 lettres ou chiffres." });
    }
    const [rating, id, extra] = typeof after === "string" ? after.split("/") : [];
    if (after !== "" && (!/^\d{1,10}$/.test(rating ?? "") || Number(rating) > 2_147_483_647 || !uuidPattern.test(id ?? "") || extra !== undefined)) {
      return response.status(400).json({ error: "Page de classement invalide." });
    }
    response.set("Cache-Control", "public, max-age=30").json(await store.listPlayers(q.toLowerCase(),
      after ? { rating: Number(rating), id } : null));
  });
  app.get("/api/players/:id", async (request, response) => {
    const profile = uuidPattern.test(request.params.id) && await store.getProfile(request.params.id);
    if (!profile) return response.status(404).json({ error: "Ce profil est introuvable." });
    response.set("Cache-Control", "public, max-age=30").json(profile);
  });
}

module.exports = { createMatchStore, mountMatchRoutes, matchId };
