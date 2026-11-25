const names = ["ChaBotté", "BotEnTrain", "HarryBotter", "Botus", "RobinDesBots", "Botman",
  "Botzilla", "James Bot", "SherlockBot", "ValteriBotAs", "Bottin", "BotRoyal", "Bipbipbot", "Bottine", "Bot27Lieues"];
const accountId = (index) => `f1c0d001-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const hubId = (index) => `f1c0d002-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const legacyBotCount = 10;
const legacyMatchCount = 100;
const recentDays = 7;
const gamesPerDay = 6;
const dayMs = 86_400_000;
const recentOffset = (index) => Math.floor(index / gamesPerDay) * dayMs + (index % gamesPerDay) * 3_600_000;

async function seedDemoPopulation(db, store) {
  const { getBotStep, playBotStep } = await import("../client/src/game/bot.ts");
  const { createRound } = await import("../client/src/game/createRound.ts");
  const { logDeal } = await import("../client/src/game/matchJournal.ts");
  const { matchStatistics } = await import("../client/src/game/matchStatistics.ts");
  const { startNextRound } = await import("../client/src/game/roundCycle.ts");
  const { beginPlay, expireTurn, playTurn } = await import("../client/src/game/turn.ts");
  const bots = await db.transaction(async (tx) => {
    for (const [index, name] of names.entries()) {
      const handle = name.normalize("NFD").replace(/\p{M}| /gu, "");
      await tx.query(`
        INSERT INTO accounts (id, handle, display_name, password_hash, is_demo_bot)
        SELECT $1, $2::text, $3::text, '', true
        WHERE NOT EXISTS (
          SELECT 1 FROM accounts WHERE id <> $1 AND
            (lower(handle) IN (lower($2), lower($3)) OR lower(display_name) IN (lower($2), lower($3)))
        )
        ON CONFLICT (id) DO UPDATE SET handle = EXCLUDED.handle, display_name = EXCLUDED.display_name
        WHERE accounts.is_demo_bot AND (accounts.handle <> EXCLUDED.handle OR accounts.display_name <> EXCLUDED.display_name)
      `, [accountId(index), handle, name]);
    }
    const { rows } = await tx.query("SELECT id, display_name AS name FROM accounts WHERE is_demo_bot ORDER BY id");
    for (const { id } of rows) {
      await tx.query("INSERT INTO player_stats (account_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
    }
    return rows;
  });
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const legacy = names.slice(0, legacyBotCount).map((_, index) => byId.get(accountId(index))).filter(Boolean);
  const recent = [byId.get(accountId(names.indexOf("James Bot"))),
    ...names.slice(legacyBotCount).map((_, index) => byId.get(accountId(legacyBotCount + index)))].filter(Boolean);
  if (legacy.length < 6) throw Error("Profils de démonstration insuffisants.");
  const ids = Array.from({ length: legacyMatchCount + (recent.length >= 2 ? recentDays * gamesPerDay : 0) },
    (_, index) => hubId(index) + ":1");
  const { rows } = await db.query("SELECT id, started_at, ended_at FROM matches WHERE id = ANY($1::text[])", [ids]);
  const existing = new Map(rows.map((entry) => [entry.id, entry]));
  const origin = Date.now() - recentDays * dayMs;
  const firstRecent = existing.get(ids[legacyMatchCount]);
  const recentOrigin = firstRecent ? Number(firstRecent.started_at) : origin;

  for (const [index, id] of ids.entries()) {
    const previous = existing.get(id);
    if (previous && previous.ended_at !== null) continue;
    const isRecent = index >= legacyMatchCount;
    const pool = isRecent ? recent : legacy;
    const game = isRecent ? index - legacyMatchCount : index;
    const first = game % pool.length;
    const roster = [...pool.slice(first), ...pool.slice(0, first)]
      .slice(0, 2 + Math.floor(game / pool.length) % 5)
      .map((bot) => ({ id: bot.id, accountId: bot.id, pseudo: bot.name, connected: true, isBot: true, totalScore: 0 }));
    const variants = {
      sixCards: index % 3 === 0, infinitePose: index % 2 === 0, plusMinusOne: index % 3 === 1, jokerPlus: index % 2 === 1,
    };
    const startedAt = previous ? Number(previous.started_at)
      : isRecent ? recentOrigin + recentOffset(game) : origin + index * 1_800_000;
    let now = 0;
    let state = beginPlay(logDeal({ ...createRound(roster, variants, 50), matchId: id }, now), now);
    for (let stepNumber = 0; stepNumber < 8_000 && !state.result?.gameWinnerIds.length; stepNumber++) {
      if (state.phase === "results") {
        now += 5_000;
        state = startNextRound(state, state.roundNumber, roster, now);
        now += 15_000;
        state = beginPlay({ ...state, phase: "memorization" }, now);
        continue;
      }
      const turn = state.turn;
      if (!turn) break;
      const step = getBotStep(state, now);
      if (turn.number >= 36 && turn.drawnCard && !turn.dutchArmed && !state.dutch && state.currentPlayerId) {
        state = playTurn(state, state.currentPlayerId, turn.number, { kind: "dutch-intent", enabled: true }, now);
      }
      if (step && now + step.delay < turn.deadline) {
        now += step.delay;
        const next = playBotStep(state, step, now);
        if (next !== state) { state = next; continue; }
      }
      now = turn.deadline;
      state = expireTurn(state, turn.number, now);
    }
    if (!state.result?.gameWinnerIds.length) throw Error("Partie de démonstration inachevée.");
    const report = matchStatistics(state.journal, "finished");
    for (const player of report.players) player.eligible = true;
    await store.register({ id: hubId(index), gameNumber: 1, players: roster }, startedAt);
    if (!await store.finish(id, "finished", report, startedAt + now)) throw Error("Bilan de démonstration invalide.");
  }
  return bots;
}

module.exports = { seedDemoPopulation };
