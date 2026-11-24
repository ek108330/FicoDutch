import { expect, test } from "@playwright/test";
import { io } from "socket.io-client";
import { discardDrawn, closeSettings, drawDeck, fixDeckOrder, openLobby, openSettings, expectLocalTurn } from "./tableFlow";

test("la signalisation accepte l’origine autorisée et refuse une autre origine", async ({ request, baseURL }) => {
  const handshake = "http://127.0.0.1:15300/socket.io/?EIO=4&transport=polling";
  const allowed = await request.get(handshake, { headers: { Origin: baseURL! } });
  expect(allowed.ok()).toBe(true);
  expect(allowed.headers()["access-control-allow-origin"]).toBe(baseURL);
  const blocked = await request.get(handshake, { headers: { Origin: "https://example.invalid" } });
  expect(blocked.status()).toBe(403);
});

test("la version affiche le commit et le serveur signale un onglet ancien", async ({ page }) => {
  await openLobby(page, "HoteVersion");
  await expect(page.getByText("Version 0.1.0+abcdef0", { exact: true })).toBeVisible();

  const oldClient = io("http://127.0.0.1:15300", { autoConnect: false, reconnection: false });
  try {
    const warning = new Promise<string>((resolve, reject) => {
      oldClient.once("hub:error", resolve);
      oldClient.once("connect_error", reject);
    });
    oldClient.connect().emit("hub:create", { pseudo: "AncienClient" });
    await expect(warning).resolves.toContain("Une version plus récente de FicoDutch est en ligne (abcdef0)");
    await expect(page.getByText("Hub de AncienClient", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Créer un Hub" }).click();
    await expect(page.getByRole("heading", { name: "Hub de HoteVersion" })).toBeVisible();
    await expect(page.getByText("Version 0.1.0+abcdef0", { exact: true })).toBeVisible();
  } finally {
    oldClient.disconnect();
  }
});

test("l’aperçu du Hub et les sons de jeu avec commande de coupure", async ({
  page: host, browser, baseURL,
}, testInfo) => {
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    await guest.addInitScript(() => {
      const tune = AudioParam.prototype.setValueAtTime;
      AudioParam.prototype.setValueAtTime = function (value, time) {
        if (value === 880) {
          const { dataset } = document.documentElement;
          dataset.testTurnTones = String(Number(dataset.testTurnTones ?? 0) + 1);
        }
        return tune.call(this, value, time);
      };
      const create = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const root = document.documentElement;
        root.dataset.testTones = String(Number(root.dataset.testTones ?? 0) + 1);
        return create.call(this);
      };
    });
    await Promise.all([openLobby(host, "AliceApercu"), openLobby(guest, "BobApercu")]);
    const sound = guest.getByRole("dialog", { name: "Paramètres du jeu" }).getByRole("button", { name: "Sons de jeu" });
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    await host.getByRole("button", { name: "6 cartes", exact: true }).click();
    await guest.getByRole("button", { name: "Aperçu du Hub de AliceApercu" }).tap();
    const preview = guest.getByRole("dialog", { name: "Hub de AliceApercu" });
    await expect(preview).toContainText("1/6 joueurs");
    await expect(preview).toContainText("6 cartes");
    await guest.screenshot({ path: testInfo.outputPath("apercu-hub.png") });
    await preview.getByRole("button", { name: "Rejoindre" }).tap();
    await host.getByRole("button", { name: "Lancer la partie" }).click();

    await expectLocalTurn(guest, 20_000);
    const deck = guest.locator(".deck-slot");
    await expect(deck).toHaveCSS("animation-name", "turn-draw-pulse");
    await expect(host.locator(".deck-slot")).not.toHaveAttribute("data-turn-draw");
    await expect(guest.locator("html")).toHaveAttribute("data-test-turn-tones", "1");
    await guest.screenshot({ path: testInfo.outputPath("pioche-tour-actif.png") });
    await expect(guest.locator("html")).toHaveAttribute("data-test-tones", /^[1-9]\d*$/);
    await guest.setViewportSize({ width: 390, height: 844 });
    const settingsBox = (await guest.locator(".game-actions .settings-trigger").boundingBox())!;
    const opponentName = (await guest.locator(".position-top .player-name").boundingBox())!;
    expect(settingsBox.y + settingsBox.height).toBeLessThan(opponentName.y);
    await openSettings(guest);
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    await closeSettings(guest);
    const tones = Number(await guest.locator("html").getAttribute("data-test-tones"));
    await drawDeck(guest).click();
    await expect(deck).not.toHaveAttribute("data-turn-draw");
    await expect(guest.locator("html")).toHaveAttribute("data-test-turn-tones", "1");
    await expect(guest.locator(".feedback-draw")).toHaveCount(1);
    await expect(guest.locator("html")).toHaveAttribute("data-test-tones", String(tones + 1));
    await openSettings(guest);
    await sound.click();
    await closeSettings(guest);
    await discardDrawn(guest);
    await expect(guest.locator(".card-feedback:not(.feedback-draw)")).toHaveCount(1);
    await expect(guest.locator("html")).toHaveAttribute("data-test-tones", String(tones + 1));
  } finally {
    await guest.close();
  }
});
