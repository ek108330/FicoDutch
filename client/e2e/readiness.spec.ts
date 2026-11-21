import { expect, test } from "@playwright/test";
import { activeTurn, drawDeck, fixDeckOrder, openLobby } from "./tableFlow";

test("la signalisation accepte l’origine autorisée et refuse une autre origine", async ({ request, baseURL }) => {
  const handshake = "http://127.0.0.1:15300/socket.io/?EIO=4&transport=polling";
  const allowed = await request.get(handshake, { headers: { Origin: baseURL! } });
  expect(allowed.ok()).toBe(true);
  expect(allowed.headers()["access-control-allow-origin"]).toBe(baseURL);
  const blocked = await request.get(handshake, { headers: { Origin: "https://example.invalid" } });
  expect(blocked.status()).toBe(403);
});

test("l’aperçu du Hub et les sons de jeu avec commande de coupure", async ({
  page: host, browser, baseURL,
}, testInfo) => {
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  try {
    await guest.addInitScript(() => {
      const create = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const root = document.documentElement;
        root.dataset.testTones = String(Number(root.dataset.testTones ?? 0) + 1);
        return create.call(this);
      };
    });
    await Promise.all([openLobby(host, "AliceApercu"), openLobby(guest, "BobApercu")]);
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    await host.getByRole("button", { name: "6 cartes", exact: true }).click();
    await guest.getByRole("button", { name: "Aperçu du Hub de AliceApercu" }).click();
    const preview = guest.getByRole("dialog", { name: "Hub de AliceApercu" });
    await expect(preview).toContainText("1/6 joueurs");
    await expect(preview).toContainText("6 cartes");
    await guest.screenshot({ path: testInfo.outputPath("apercu-hub.png") });
    await preview.getByRole("button", { name: "Rejoindre" }).click();
    await host.getByRole("button", { name: "Lancer la partie" }).click();

    await expect(activeTurn(guest)).toHaveText("À toi de jouer", { timeout: 20_000 });
    await guest.setViewportSize({ width: 390, height: 844 });
    const optionsBox = (await guest.locator(".table-options").boundingBox())!;
    const opponentName = (await guest.locator(".position-top .player-name").boundingBox())!;
    expect(optionsBox.y + optionsBox.height).toBeLessThan(opponentName.y);
    const sound = guest.getByRole("button", { name: "Sons de jeu" });
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await sound.click();
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    await drawDeck(guest).click();
    await expect(guest.locator(".feedback-draw")).toHaveCount(1);
    await expect(guest.locator("html")).toHaveAttribute("data-test-tones", "1");
    await sound.click();
    await guest.getByRole("button", { name: "Défausser la carte tirée" }).click();
    await expect(guest.locator(".card-feedback:not(.feedback-draw)")).toHaveCount(1);
    await expect(guest.locator("html")).toHaveAttribute("data-test-tones", "1");
  } finally {
    await guest.close();
  }
});
