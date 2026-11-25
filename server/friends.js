const { uuidPattern } = require("./accounts");

const pair = "first_id = LEAST($1::uuid, $2::uuid) AND second_id = GREATEST($1::uuid, $2::uuid)";
const otherAccount = "CASE WHEN first_id = $1 THEN second_id ELSE first_id END";
const profileRoom = (id) => "profile:" + id;
const relationship = (row, id) => !row ? "none" : row.accepted ? "friends" : row.requester_id === id ? "sent" : "received";

async function acceptedFriends(db, id, candidates) {
  if (!db || !id || !candidates.length) return new Set();
  const { rows } = await db.query(`
    SELECT ${otherAccount} AS id FROM friendships
    WHERE accepted AND ((first_id = $1 AND second_id = ANY($2::uuid[]))
      OR (second_id = $1 AND first_id = ANY($2::uuid[])))
  `, [id, candidates]);
  return new Set(rows.map((friend) => friend.id));
}

function mountFriends(app, io, db, readAccount, acceptsOrigin) {
  const online = (id) => (io.sockets.adapter.rooms.get(profileRoom(id))?.size ?? 0) > 0;

  async function signedIn(request, response, next) {
    response.set("Cache-Control", "no-store");
    const session = await readAccount(request.headers);
    if (!session) return response.status(401).json({ error: "Connecte-toi pour retrouver tes amis." });
    response.locals.playerId = session.account.id;
    next();
  }

  function validatePlayer(request, response, next) {
    const id = request.params.id.toLowerCase();
    if (!uuidPattern.test(id) || id === response.locals.playerId) {
      return response.status(400).json({ error: "Ce profil ne peut pas être ajouté aux amis." });
    }
    response.locals.otherId = id;
    next();
  }

  function requireOrigin(request, response, next) {
    if (!request.headers.origin || !acceptsOrigin(request.headers.origin)) {
      return response.status(403).json({ error: "Origine non autorisée." });
    }
    next();
  }

  async function getRelationship(id, otherId) {
    const { rows } = await db.query(`SELECT accepted, requester_id FROM friendships WHERE ${pair}`, [id, otherId]);
    return relationship(rows[0], id);
  }

  app.get("/api/friends", signedIn, async (_request, response) => {
    const { playerId } = response.locals;
    const { rows } = await db.query(`
      SELECT a.id, a.display_name AS name, a.avatar_style AS "avatarStyle", a.avatar_photo_id AS "avatarPhotoId",
        s.rn AS rating, f.accepted
      FROM friendships f JOIN accounts a ON a.id = ${otherAccount}
      JOIN player_stats s ON s.account_id = a.id
      WHERE (f.first_id = $1 OR f.second_id = $1) AND (f.accepted OR f.requester_id <> $1)
      ORDER BY a.display_name, a.id
    `, [playerId]);
    const friends = rows.filter(({ accepted }) => accepted).map(({ accepted: _accepted, ...player }) =>
      ({ ...player, online: online(player.id) }));
    const incoming = rows.filter(({ accepted }) => !accepted).map(({ accepted: _accepted, ...player }) => player);
    response.json({ friends, incoming });
  });

  app.get("/api/friends/:id", signedIn, validatePlayer, async (_request, response) => {
    const { playerId, otherId } = response.locals;
    response.json({ relationship: await getRelationship(playerId, otherId) });
  });

  app.post("/api/friends/:id", requireOrigin, signedIn, validatePlayer, async (request, response) => {
    const { playerId, otherId } = response.locals;
    const action = request.body?.action;
    if (action !== "request" && action !== "accept") {
      return response.status(400).json({ error: "Action d’amitié inconnue." });
    }
    const ids = [playerId, otherId];
    const { rows } = action === "request"
      ? await db.query(`
          INSERT INTO friendships (first_id, second_id, requester_id)
          SELECT LEAST($1::uuid, a.id), GREATEST($1::uuid, a.id), $1
          FROM accounts a WHERE a.id = $2 AND NOT a.is_demo_bot
          ON CONFLICT DO NOTHING RETURNING accepted, requester_id
        `, ids)
      : await db.query(`
          UPDATE friendships SET accepted = true
          WHERE ${pair} AND requester_id = $2 AND NOT accepted
          RETURNING accepted, requester_id
        `, ids);
    if (rows.length) io.to(ids.map(profileRoom)).emit("friends:changed");
    const state = rows.length ? relationship(rows[0], playerId) : await getRelationship(...ids);
    if (action === "request" && state === "none") return response.status(404).json({ error: "Ce joueur est indisponible." });
    if (action === "accept" && state !== "friends") {
      return response.status(409).json({ error: "Cette demande n’est plus disponible." });
    }
    response.json({ relationship: state });
  });

  app.delete("/api/friends/:id", requireOrigin, signedIn, validatePlayer, async (_request, response) => {
    const { playerId, otherId } = response.locals;
    const { rows } = await db.query(`DELETE FROM friendships WHERE ${pair} RETURNING first_id`, [playerId, otherId]);
    if (rows.length) io.to([profileRoom(playerId), profileRoom(otherId)]).emit("friends:changed");
    response.json({ relationship: "none" });
  });

  async function publishPresence(id) {
    try {
      const { rows } = await db.query(`
        SELECT ${otherAccount} AS id FROM friendships WHERE (first_id = $1 OR second_id = $1) AND accepted
      `, [id]);
      if (rows.length) io.to(rows.map((friend) => profileRoom(friend.id))).emit("friends:presence", { id, online: online(id) });
    } catch (error) {
      console.error("Présence des amis indisponible :", error.code ?? error.name);
    }
  }

  io.on("connection", (socket) => {
    const id = socket.data.session?.account.id;
    if (!id) return;
    if (io.sockets.adapter.rooms.get(profileRoom(id))?.size === 1) void publishPresence(id);
    socket.on("disconnect", () => {
      if (!online(id)) void publishPresence(id);
    });
  });
}

module.exports = { mountFriends, acceptedFriends };
