const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require("node:crypto");
const { promisify } = require("node:util");
const { findPlayerHub, guestNameInUse, withPlayerName } = require("./hubManager");

const derive = promisify(scrypt);
const cookie = "ficodutch_account";
const sessionLength = 30 * 24 * 60 * 60 * 1_000;
const namePattern = /^[A-Z][A-Za-z0-9]{4,14}$/;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const hashOptions = { N: 131_072, r: 8, p: 1, maxmem: 144 * 1024 * 1024 };
const dummySalt = randomBytes(16);
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");

function publicAccount(row) {
  return row && { id: row.id, handle: row.handle, name: row.display_name,
    ...(row.avatar_style != null && { avatarStyle: row.avatar_style }),
    ...(row.avatar_photo_id && { avatarPhotoId: row.avatar_photo_id }) };
}

function readAvatarPhoto(data) {
  if (typeof data !== "string" || data.length > 96_000 || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  const png = Buffer.from(data, "base64");
  if (png.length < 45 || !png.subarray(0, 8).equals(pngSignature) || png.readUInt32BE(8) !== 13 ||
      png.toString("ascii", 12, 16) !== "IHDR" || png.readUInt32BE(16) !== 128 || png.readUInt32BE(20) !== 128) return null;
  let hasImage = false;
  for (let offset = 33; offset + 12 <= png.length;) {
    const type = png.toString("ascii", offset + 4, offset + 8);
    const size = png.readUInt32BE(offset);
    offset += 12 + size;
    if (offset > png.length) return null;
    if (type === "IDAT") hasImage ||= size > 0;
    if (type === "IEND") return size === 0 && offset === png.length && hasImage ? png : null;
  }
  return null;
}

function sessionHash(headers) {
  const token = headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(cookie + "="))
    ?.slice(cookie.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? createHash("sha256").update(token).digest("hex") : null;
}

function mountAccounts(app, io, db, acceptsOrigin, broadcastHubs) {
  const secure = Boolean(process.env.RENDER_EXTERNAL_URL || process.env.NODE_ENV === "production");
  const cookieOptions = { httpOnly: true, secure, sameSite: "strict", path: "/" };
  const attempts = new Map();
  let hashing = false;
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, attempt] of attempts) if (attempt.end < now) attempts.delete(ip);
    void db.query("DELETE FROM account_sessions WHERE expires_at <= $1", [now]).catch(() => {});
  }, 10 * 60_000);
  sweep.unref();

  async function readAccount(headers) {
    const token = sessionHash(headers);
    if (!token) return null;
    const { rows } = await db.query(`
      SELECT a.id, a.handle, a.display_name, a.avatar_style, a.avatar_photo_id, s.expires_at FROM account_sessions s
      JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1 AND s.expires_at > $2
    `, [token, Date.now()]);
    return rows[0] ? { account: publicAccount(rows[0]), token, expiresAt: Number(rows[0].expires_at) } : null;
  }

  async function openSession(response, row) {
    const rawToken = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(rawToken).digest("hex");
    await db.query("INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)",
      [hash, row.id, Date.now() + sessionLength]);
    response.cookie(cookie, rawToken, { ...cookieOptions, maxAge: sessionLength });
    response.json({ enabled: true, account: publicAccount(row) });
  }

  function requireOrigin(request, response, next) {
    if (!request.headers.origin || !acceptsOrigin(request.headers.origin)) {
      return response.status(403).json({ error: "Origine non autorisée." });
    }
    next();
  }

  function limited(request, response, next) {
    const now = Date.now();
    const ip = request.ip;
    const current = attempts.get(ip);
    const attempt = current && current.end > now ? current : { count: 0, end: now + 10 * 60_000 };
    if ((!current && attempts.size >= 4_096) || attempt.count >= 24 || hashing) {
      return response.status(429).json({ error: "Réessaie dans un instant." });
    }
    attempt.count++;
    attempts.set(ip, attempt);
    next();
  }

  async function authenticate(request, response, register) {
    const { handle, password } = request.body ?? {};
    if (typeof handle !== "string" || !(register ? namePattern : /^[A-Za-z][A-Za-z0-9]{4,14}$/).test(handle) ||
        typeof password !== "string" || password.length < 5 || password.length > 128) {
      return response.status(400).json({ error: "Identifiant de 5 à 15 caractères et mot de passe de 5 à 128 caractères requis." });
    }

    hashing = true;
    let row;
    try {
      const { rows } = await db.query(
        "SELECT id, handle, display_name, password_hash, avatar_style, avatar_photo_id FROM accounts WHERE lower(handle) = lower($1)", [handle]);
      if (register) {
        if (rows.length) return response.status(409).json({ error: "Ce nom est déjà utilisé." });
        const salt = randomBytes(16);
        const key = await derive(password, salt, 32, hashOptions);
        const id = randomUUID();
        row = await withPlayerName(handle, () => db.transaction(async (tx) => {
          if (guestNameInUse(handle)) return null;
          const { rows: created } = await tx.query(`
            INSERT INTO accounts (id, handle, display_name, password_hash) VALUES ($1, $2, $2, $3)
            RETURNING id, handle, display_name
          `, [id, handle, salt.toString("hex") + ":" + key.toString("hex")]);
          await tx.query("INSERT INTO player_stats (account_id) VALUES ($1)", [id]);
          return created[0];
        }));
        if (!row) return response.status(409).json({ error: "Ce nom est déjà utilisé." });
      } else {
        row = rows.find(({ password_hash }) => password_hash);
        const [salt, expected] = row?.password_hash.split(":") ?? [];
        const key = await derive(password, salt ? Buffer.from(salt, "hex") : dummySalt, 32, hashOptions);
        if (!row || !timingSafeEqual(key, Buffer.from(expected, "hex"))) {
          return response.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
        }
      }
    } catch (error) {
      if (error.code === "23505") return response.status(409).json({ error: "Ce nom est déjà utilisé." });
      throw error;
    } finally {
      hashing = false;
    }
    await openSession(response, row);
  }

  app.get("/api/session", async (request, response) => {
    response.set("Cache-Control", "no-store").json({
      enabled: true, demo: process.env.FICODUTCH_DEMO === "1",
      account: (await readAccount(request.headers))?.account ?? null,
    });
  });
  app.post("/api/accounts", requireOrigin, limited, (request, response) => authenticate(request, response, true));
  app.post("/api/session", requireOrigin, limited, (request, response) => authenticate(request, response, false));
  app.delete("/api/session", requireOrigin, async (request, response) => {
    const token = sessionHash(request.headers);
    if (token) {
      await db.query("DELETE FROM account_sessions WHERE token_hash = $1", [token]);
      io.in("account:" + token).disconnectSockets(true);
    }
    response.clearCookie(cookie, cookieOptions).json({ enabled: true, account: null });
  });
  app.patch("/api/account", requireOrigin, async (request, response) => {
    const session = await readAccount(request.headers);
    if (!session) return response.status(401).json({ error: "Connecte-toi pour modifier ton pseudo." });
    const name = request.body?.name;
    if (typeof name !== "string" || !namePattern.test(name)) {
      return response.status(400).json({ error: "Saisis 5 à 15 lettres ou chiffres, avec une majuscule au début." });
    }
    try {
      const { rows } = await withPlayerName(name, () => guestNameInUse(name) ? { rows: [] } : db.query(`
        UPDATE accounts SET display_name = $1 WHERE id = $2
        AND NOT EXISTS (SELECT 1 FROM accounts WHERE lower(handle) = lower($1) AND id <> $2)
        RETURNING id, handle, display_name, avatar_style, avatar_photo_id
      `, [name, session.account.id]));
      if (rows.length) return response.json({ enabled: true, account: publicAccount(rows[0]) });
    } catch (error) {
      if (error.code !== "23505") throw error;
    }
    response.status(409).json({ error: "Ce nom est déjà utilisé." });
  });

  async function publishAvatar(response, account) {
    let seated = false;
    for (const socket of await io.in("profile:" + account.id).fetchSockets()) {
      if (!socket.data.session) continue;
      socket.data.session.account = account;
      const current = findPlayerHub(socket.id);
      if (current?.player.accountId === account.id) {
        current.player.avatarStyle = account.avatarStyle;
        current.player.avatarPhotoId = account.avatarPhotoId;
        seated = true;
      }
    }
    if (seated) broadcastHubs();
    response.set("Cache-Control", "no-store").json({ enabled: true, account });
  }

  app.patch("/api/account/avatar", requireOrigin, async (request, response) => {
    const session = await readAccount(request.headers);
    if (!session) return response.status(401).json({ error: "Connecte-toi pour modifier ton icône." });
    const style = request.body?.style;
    if (style !== null && (!Number.isInteger(style) || style < 0 || style > 7)) {
      return response.status(400).json({ error: "Choisis une icône proposée." });
    }
    const { rows } = await db.query(`
      UPDATE accounts SET avatar_style = $1 WHERE id = $2
      RETURNING id, handle, display_name, avatar_style, avatar_photo_id
    `, [style, session.account.id]);
    await publishAvatar(response, publicAccount(rows[0]));
  });

  app.put("/api/account/avatar/photo", requireOrigin, async (request, response) => {
    const session = await readAccount(request.headers);
    if (!session) return response.status(401).json({ error: "Connecte-toi pour modifier ta photo." });
    const image = request.body?.image;
    const photo = image === null ? null : readAvatarPhoto(image);
    if (image !== null && !photo) return response.status(400).json({ error: "Envoie une image de profil valide." });
    const { rows } = await db.query(`
      UPDATE accounts SET avatar_photo = $1, avatar_photo_id = $2 WHERE id = $3
      RETURNING id, handle, display_name, avatar_style, avatar_photo_id
    `, [photo, photo ? randomUUID() : null, session.account.id]);
    await publishAvatar(response, publicAccount(rows[0]));
  });

  app.get("/api/avatars/:id", async (request, response) => {
    if (!uuidPattern.test(request.params.id)) return response.sendStatus(404);
    const { rows } = await db.query("SELECT avatar_photo FROM accounts WHERE avatar_photo_id = $1", [request.params.id]);
    if (!rows[0]?.avatar_photo) return response.sendStatus(404);
    response.set({ "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" })
      .type("png").send(Buffer.from(rows[0].avatar_photo));
  });

  io.use((socket, next) => {
    readAccount(socket.request.headers).then((session) => {
      socket.data.session = session;
      if (session) socket.join(["account:" + session.token, "profile:" + session.account.id]);
      next();
    }, next);
  });
  return readAccount;
}

module.exports = { mountAccounts, uuidPattern };
