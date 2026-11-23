const assert = require("node:assert/strict");
const { test } = require("node:test");
const { dealingMs, memorizationMs } = require("../shared/roundTiming.json");
const {
  addHubBot, completeHostResume, createHub, disconnectPlayer, expireHostPause, finishHubGame, getAllHubs, interruptHub, joinHub,
  relayLobbyMessage, removeHubGuest, removePlayer, resolveEncryptedRelay, resolvePeerRelay, restartHubGame, resumeHub, startHubGame, updateHubSettings,
} = require("./hubManager");

function openTable(t, hostSocket, guestSocket) {
  const { hub, session: host } = createHub(hostSocket, "Alice");
  const { session: guest } = joinHub(hub.id, guestSocket, "Bob");
  t.after(() => removePlayer(hostSocket));
  const request = {
    hubId: hub.id,
    cardCounts: { [host.playerId]: 4, [guest.playerId]: 4 },
    variants: hub.variants,
    endThreshold: hub.endThreshold,
  };
  return { hub, host, guest, request };
}

function signal(hubId, recipient, type, senderVersion = 1, recipientVersion = 1) {
  return {
    hubId, recipientId: recipient.playerId, senderVersion, recipientVersion,
    negotiationId: "test", description: { type, sdp: "v=0" },
  };
}

test("seul l’hôte peut ajouter des bots dans les places libres de son Hub", (t) => {
  const { hub } = openTable(t, "bot-host", "bot-guest");
  assert.equal(addHubBot("bot-guest", hub.id), false);
  assert.equal(addHubBot("bot-host", "autre-hub"), false);
  for (let i = 0; i < 4; i++) assert.equal(addHubBot("bot-host", hub.id), true);
  assert.equal(addHubBot("bot-host", hub.id), false);
  assert.equal(joinHub(hub.id, "bot-overflow", "Chloe"), null);
  const full = getAllHubs().find(({ id }) => id === hub.id);
  const bots = full.players.filter(({ isBot }) => isBot);
  assert.deepEqual(bots.map(({ pseudo }) => pseudo), ["Bot 1", "Bot 2", "Bot 3", "Bot 4"]);
  assert.equal(new Set(bots.map(({ id }) => id)).size, 4);
  assert.equal(bots.some((bot) => "token" in bot || "socketId" in bot), false);
  assert.equal(resolvePeerRelay("bot-host", signal(hub.id, { playerId: bots[0].id }, "answer", 1, 0)), null);
  assert.ok(removeHubGuest("bot-host", hub.id, bots[0].id));
  const participants = full.players.filter(({ id }) => id !== bots[0].id);
  const cardCounts = Object.fromEntries(participants.map(({ id }) => [id, 4]));
  assert.ok(startHubGame("bot-host", { hubId: hub.id, cardCounts, variants: hub.variants, endThreshold: hub.endThreshold }).hub);
  assert.equal(addHubBot("bot-host", hub.id), false);
});

test("seul l’hôte peut publier la distribution pour les joueurs et paramètres courants", (t) => {
  const { host, guest, request } = openTable(t, "host", "guest");

  assert.ok(startHubGame("guest", request).error);
  assert.ok(startHubGame("host", { ...request, cardCounts: { [host.playerId]: 4, formerGuest: 4 } }).error);
  assert.ok(startHubGame("host", { ...request, cardCounts: { ...request.cardCounts, [guest.playerId]: 6 } }).error);

  const updated = updateHubSettings("host", {
    ...request,
    variants: { ...request.variants, jokerPlus: true },
  });
  assert.equal(updated.gameStarted, false);
  assert.ok(startHubGame("host", request).error);

  t.mock.method(Date, "now", () => 1_000);
  const result = startHubGame("host", { ...request, variants: updated.variants });
  assert.deepEqual(result.hub, {
    ...updated,
    status: "in-progress",
    gameStarted: true,
    initialCardCounts: request.cardCounts,
    memorizationEndsAt: 1_000 + dealingMs + memorizationMs,
  });
  assert.ok(startHubGame("host", request).error);
});

test("la signalisation WebRTC se limite à l’hôte et à chaque invité de son Hub", (t) => {
  const { hub, host, guest } = openTable(t, "signal-host", "signal-guest");
  const { session: other } = createHub("other-host", "Chloe");
  t.after(() => removePlayer("other-host"));
  const { session: next } = joinHub(hub.id, "next-guest", "Dan");
  const offer = resolvePeerRelay("signal-guest", signal(hub.id, host, "offer"));
  assert.equal(offer.socketId, "signal-host");
  assert.equal(offer.signal.senderId, guest.playerId);
  assert.equal(resolvePeerRelay("signal-host", signal(hub.id, guest, "answer")).socketId, "signal-guest");
  assert.equal(resolvePeerRelay("signal-host", signal(hub.id, guest, "offer")), null);
  assert.equal(resolvePeerRelay("signal-host", signal(hub.id, guest, "cards")), null);
  assert.equal(resolvePeerRelay("signal-guest", signal(hub.id, next, "offer")), null);
  assert.equal(resolvePeerRelay("signal-host", signal(hub.id, other, "answer")), null);
  removePlayer("signal-guest");
  assert.equal(resolvePeerRelay("signal-host", signal(hub.id, guest, "answer")), null);
});

test("un invité retrouve sa place avec son jeton privé et une nouvelle version de connexion", (t) => {
  const { hub, host, guest, request } = openTable(t, "resume-host", "resume-guest");
  startHubGame("resume-host", request);
  disconnectPlayer("resume-guest");
  const publicHub = () => getAllHubs().find(({ id }) => id === hub.id);
  const disconnected = publicHub().players.find(({ id }) => id === guest.playerId);
  assert.equal(disconnected.connected, false);
  assert.equal(publicHub().hostPause, null);
  assert.equal(JSON.stringify(publicHub()).includes(guest.token), false);
  assert.equal(JSON.stringify(publicHub()).includes("resume-guest"), false);
  assert.equal(resumeHub("guest-retry", { ...guest, token: "x".repeat(43) }), null);

  const resumed = resumeHub("guest-retry", guest);
  assert.equal(resumed.session.playerId, guest.playerId);
  assert.equal(resumed.hub.players.find(({ id }) => id === guest.playerId).connectionVersion, 2);
  assert.equal(resumed.hub.players.find(({ id }) => id === guest.playerId).connected, true);
  assert.equal(resolvePeerRelay("resume-guest", signal(hub.id, host, "offer", 2)), null);
  assert.equal(resolvePeerRelay("guest-retry", signal(hub.id, host, "offer")), null);
  assert.equal(resolvePeerRelay("guest-retry", signal(hub.id, host, "offer", 2)).socketId, "resume-host");
  assert.equal(resolvePeerRelay("resume-host", signal(hub.id, guest, "answer")), null);
  removePlayer("guest-retry");
  assert.equal(resumeHub("guest-retry", guest), null);
});

test("le retour de l’hôte valide une nouvelle horloge et une pause expirée ferme la table", (t) => {
  const { hub, host, guest, request } = openTable(t, "pause-host", "pause-guest");
  t.after(() => removePlayer("returned-host"));
  startHubGame("pause-host", request);
  assert.equal(disconnectPlayer("pause-host", 1_000).pauseUntil, 121_000);
  assert.equal(expireHostPause(hub.id, 121_000, 120_999), false);
  assert.equal(resumeHub("returned-host", host, 2_000), null);
  assert.equal(completeHostResume("pause-guest", 2_000), false);

  const resumed = resumeHub("returned-host", { ...host, hasHostState: true }, 3_000);
  assert.deepEqual(resumed.hub.hostPause, { startedAt: 1_000, until: 121_000 });
  assert.equal(resumed.hub.clockVersion, 0);
  assert.equal(completeHostResume("returned-host", 4_000), true);
  const current = getAllHubs().find(({ id }) => id === hub.id);
  assert.equal(current.hostPause, null);
  assert.equal(current.clockVersion, 1);

  assert.equal(disconnectPlayer("returned-host", 5_000).pauseUntil, 125_000);
  assert.equal(expireHostPause(hub.id, 121_000, 125_000), false);
  assert.equal(resumeHub("late-host", { ...host, hasHostState: true }, 125_000), null);
  assert.equal(expireHostPause(hub.id, 125_000, 125_000), true);
  assert.equal(resumeHub("late-guest", guest, 125_000), null);
  assert.equal(getAllHubs().some(({ id }) => id === hub.id), false);
});

test("un Hub en cours réserve des places aux arrivants jusqu’à la limite de six joueurs", (t) => {
  const { hub, request } = openTable(t, "entry-host", "entry-guest");
  assert.equal(finishHubGame("entry-host", hub.gameNumber), false);
  startHubGame("entry-host", request);
  for (const name of ["Chloe", "Dana", "Eli", "Fiona"]) {
    const joined = joinHub(hub.id, name, name);
    assert.equal(joined.hub.gameStarted, true);
    assert.equal(joined.hub.initialCardCounts[joined.session.playerId], undefined);
  }
  assert.equal(joinHub(hub.id, "Gina", "Gina"), null);
  assert.equal(getAllHubs().find(({ id }) => id === hub.id).status, "full");
  assert.equal(removePlayer("Fiona").deleted, false);
  assert.equal(finishHubGame("entry-guest", hub.gameNumber), false);
  assert.equal(finishHubGame("entry-host", hub.gameNumber), true);
  assert.equal(finishHubGame("entry-host", hub.gameNumber), false);
  assert.equal(joinHub(hub.id, "Gina", "Gina"), null);
  assert.equal(getAllHubs().find(({ id }) => id === hub.id).status, "finished");
});

test("seul l’hôte peut relancer une partie terminée, avec les mêmes places et une nouvelle horloge", (t) => {
  const { hub, guest, request } = openTable(t, "restart-host", "restart-guest");
  const replay = { hubId: hub.id, gameNumber: hub.gameNumber, variants: { ...hub.variants, sixCards: true } };
  assert.equal(restartHubGame("restart-host", replay), false);
  assert.ok(startHubGame("restart-host", request).hub);
  assert.equal(restartHubGame("restart-host", replay), false);
  const { session: late } = joinHub(hub.id, "restart-late", "Chloe");
  assert.equal(finishHubGame("restart-host", hub.gameNumber), true);
  assert.equal(restartHubGame("restart-guest", replay), false);
  assert.equal(restartHubGame("restart-host", { ...replay, variants: {} }), false);
  disconnectPlayer("restart-guest");
  disconnectPlayer("restart-late");
  assert.equal(restartHubGame("restart-host", replay), false);
  assert.ok(resumeHub("restart-guest", guest));
  assert.equal(restartHubGame("restart-host", replay), true);
  assert.equal(restartHubGame("restart-host", replay), false);
  assert.equal(finishHubGame("restart-host", hub.gameNumber), false);
  const reopened = getAllHubs().find(({ id }) => id === hub.id);
  assert.equal(reopened.gameNumber, hub.gameNumber + 1);
  assert.equal(reopened.clockVersion, hub.clockVersion + 1);
  assert.equal(reopened.endThreshold, hub.endThreshold);
  assert.equal(reopened.gameFinished, false);
  assert.deepEqual(reopened.variants, replay.variants);
  assert.deepEqual(reopened.initialCardCounts, { [hub.hostId]: 6, [guest.playerId]: 6, [late.playerId]: 6 });
  assert.equal(finishHubGame("restart-host", reopened.gameNumber), true);
  assert.equal(restartHubGame("restart-host", replay), false);
  assert.equal(interruptHub("restart-guest", hub.id), null);
  assert.deepEqual(interruptHub("restart-host", hub.id), ["restart-host", "restart-guest"]);
  assert.equal(getAllHubs().some(({ id }) => id === hub.id), false);
});

test("seul l’hôte peut retirer un invité de son Hub et sa session est révoquée", (t) => {
  const { hub, host, guest, request } = openTable(t, "manage-host", "manage-guest");
  const { session: outsider } = createHub("other-table-host", "Chloe");
  t.after(() => removePlayer("other-table-host"));
  assert.equal(removeHubGuest("manage-guest", hub.id, host.playerId), null);
  assert.equal(removeHubGuest("manage-host", hub.id, host.playerId), null);
  assert.equal(removeHubGuest("manage-host", outsider.hubId, outsider.playerId), null);
  assert.equal(removeHubGuest("other-table-host", hub.id, guest.playerId), null);
  assert.deepEqual(removeHubGuest("manage-host", hub.id, guest.playerId), { socketId: "manage-guest" });
  assert.equal(resumeHub("manage-guest", guest), null);

  const { session: replacement } = joinHub(hub.id, "returning-guest", "Bob");
  startHubGame("manage-host", { ...request, cardCounts: { [host.playerId]: 4, [replacement.playerId]: 4 } });
  disconnectPlayer("returning-guest");
  assert.deepEqual(removeHubGuest("manage-host", hub.id, replacement.playerId), { socketId: null });
  assert.equal(resumeHub("returning-guest", replacement), null);
});

test("seul l’hôte peut interrompre sa partie et fermer le Hub pour tous ses membres", (t) => {
  const { hub, host, guest, request } = openTable(t, "interrupt-host", "interrupt-guest");
  assert.equal(interruptHub("interrupt-host", hub.id), null);
  startHubGame("interrupt-host", request);
  const { session: waiting } = joinHub(hub.id, "interrupt-waiting", "Chloe");
  assert.equal(interruptHub("interrupt-guest", hub.id), null);
  assert.equal(interruptHub("interrupt-host", "autre-hub"), null);
  assert.deepEqual(interruptHub("interrupt-host", hub.id), ["interrupt-host", "interrupt-guest", "interrupt-waiting"]);
  assert.equal(getAllHubs().some(({ id }) => id === hub.id), false);
  for (const session of [host, guest, waiting]) assert.equal(resumeHub("interrupted", session), null);
  assert.equal(interruptHub("interrupt-host", hub.id), null);
});

test("le chat du lobby identifie l’auteur et ne relaie qu’aux membres du Hub avant la partie", (t) => {
  const { hub, guest, request } = openTable(t, "chat-host", "chat-guest");
  const { hub: otherHub } = createHub("chat-other", "Camille");
  t.after(() => removePlayer("chat-other"));
  const text = { hubId: hub.id, kind: "text", text: "  Salut tout le monde !  ", pseudo: "Alice" };
  assert.equal(relayLobbyMessage("chat-other", text, 1_000).status, "unavailable");
  assert.equal(relayLobbyMessage("chat-guest", { ...text, hubId: otherHub.id }, 1_000).status, "unavailable");
  assert.equal(relayLobbyMessage("chat-guest", { ...text, text: "   " }, 1_000).status, "invalid");
  assert.equal(relayLobbyMessage("chat-guest", { ...text, text: "x".repeat(201) }, 1_000).status, "invalid");

  const message = relayLobbyMessage("chat-guest", text, 1_000);
  assert.equal(message.status, "ok");
  assert.deepEqual(message.socketIds, ["chat-host", "chat-guest"]);
  assert.equal(message.message.playerId, guest.playerId);
  assert.equal(message.message.pseudo, "Bob");
  assert.equal(message.message.text, "Salut tout le monde !");
  assert.equal(JSON.stringify(getAllHubs()).includes("Salut tout le monde !"), false);

  const emoji = { hubId: hub.id, kind: "emoji", emoji: "clap" };
  assert.equal(relayLobbyMessage("chat-guest", emoji, 1_300).status, "slow");
  assert.equal(relayLobbyMessage("chat-guest", { ...emoji, emoji: "toString" }, 2_000).status, "invalid");
  assert.equal(relayLobbyMessage("chat-guest", emoji, 2_000).message.emoji, "clap");
  startHubGame("chat-host", request);
  assert.equal(relayLobbyMessage("chat-guest", text, 3_000).status, "unavailable");
  assert.equal(relayLobbyMessage("chat-guest", emoji, 3_000).status, "unavailable");
});

test("le relais chiffré vérifie les identités et ne transmet que l’enveloppe autorisée", (t) => {
  const { hub, host, guest } = openTable(t, "encrypted-host", "encrypted-guest");
  const offer = { ...signal(hub.id, host, "offer"), body: { type: "offer", publicKey: "A".repeat(87) + "=" } };
  const exchange = resolveEncryptedRelay("encrypted-guest", offer);
  assert.equal(exchange.socketId, "encrypted-host");
  assert.equal(exchange.signal.senderId, guest.playerId);
  assert.equal(resolveEncryptedRelay("encrypted-host", { ...offer, recipientId: guest.playerId }), null);

  const ciphertext = "A".repeat(32);
  const data = { ...offer, body: { type: "data", sequence: 0, ciphertext, gameState: "cartes privées" } };
  const relay = resolveEncryptedRelay("encrypted-guest", data);
  assert.deepEqual(relay.signal.body, { type: "data", sequence: 0, ciphertext });
  assert.equal(resolveEncryptedRelay("encrypted-guest", { ...data, senderVersion: 2 }), null);
  assert.equal(resolveEncryptedRelay("encrypted-guest", { ...data, recipientVersion: 2 }), null);
  assert.equal(resolveEncryptedRelay("encrypted-guest", { ...data, hubId: "autre-hub" }), null);
  assert.equal(resolveEncryptedRelay("encrypted-guest", { ...data, body: { ...data.body, ciphertext: "du texte" } }), null);
  removePlayer("encrypted-guest");
  assert.equal(resolveEncryptedRelay("encrypted-guest", data), null);
});
