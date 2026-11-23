import { expect, test, type Page } from "@playwright/test";
import { activeTurn, discard, discardDrawn, drawDeck, drawnCard, expectTableFits, fixDeckOrder, openTwoPlayerHub,
  expectLocalTurn, expectClockFromTop } from "./tableFlow";

const announce = (page: Page) => page.getByRole("button", { name: "Annoncer Dutch en fin de tour" });

test("annonce Dutch, protection du Valet et scores", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(50_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceDutch", "BobDutch");
    await start.click();
    await expectLocalTurn(guest, 20_000);
    await drawDeck(guest).click();
    await expect(drawnCard(guest)).toHaveAccessibleName("Carte tirée, 5 de pique");
    await announce(guest).click();
    await expect(announce(guest)).toHaveAttribute("aria-pressed", "true");
    await expect(host.getByRole("img", { name: "BobDutch a annoncé Dutch" })).toHaveCount(0);
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("01-annonce-preparee.png") });
    await discardDrawn(guest);

    for (const page of [host, guest]) {
      await expect(page.getByRole("alert").filter({ hasText: "Dutch !" })).toHaveText("Dutch !BobDutch");
      await expect(page.locator(".player-name").getByRole("img", { name: "BobDutch a annoncé Dutch" })).toBeVisible();
      await expect(announce(page)).toHaveCount(0);
    }
    await expectLocalTurn(host);
    await expect(drawDeck(guest)).toBeDisabled();
    await expect(guest.locator(".position-bottom [data-reactable]")).toHaveCount(4);

    await host.setViewportSize({ width: 390, height: 844 });
    await expectTableFits(host);
    await host.screenshot({ path: testInfo.outputPath("02-dernier-tour-portrait.png") });
    await drawDeck(host).click();
    await host.getByRole("button", { name: "Remplacer la carte 2", exact: true }).click();
    await expect(host.getByRole("heading", { name: "Pouvoir du Valet" })).toBeVisible();
    await host.getByRole("button", { name: "Choisir la carte 1 de BobDutch" }).click();
    await host.getByRole("button", { name: "Choisir la carte 1 de AliceDutch" }).click();
    await expect(host.locator(".position-top .face-up")).toHaveAttribute("aria-label", "Carte 1 Dame de pique");
    await expect(host.getByRole("button", { name: "Échanger les cartes" })).toBeDisabled();
    await expect(host.getByRole("button", { name: "Échanger les cartes" })).toHaveCSS("color", "rgb(84, 69, 43)");
    await expect(host.getByRole("button", { name: "Annuler l’échange" })).toHaveCSS("color", "rgb(36, 25, 12)");
    await expect(host.getByText("La protection Dutch empêche l’échange.")).toHaveCSS("color", "rgb(36, 25, 12)");
    await expect(host.getByText("La protection Dutch empêche l’échange.")).toBeVisible();
    await expect(guest.locator(".player-cards .face-up")).toHaveCount(0);
    await expectTableFits(host);
    await host.screenshot({ path: testInfo.outputPath("03-protection-valet.png") });
    await host.locator(".power-heading").getByRole("button", { name: "Annuler l’échange" }).click();

    for (const page of [host, guest]) {
      await expect(page.getByRole("heading", { name: "Manche 1", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de AliceDutch" }).getByRole("img", { name: "Manche remportée" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de BobDutch" }).getByRole("img", { name: "Annonce Dutch, pénalité de 10 points" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de AliceDutch" }).locator(".result-points")).toHaveText("20");
      await expect(page.getByRole("region", { name: "Main de BobDutch" }).getByText("36 +10", { exact: true })).toBeVisible();
    }
    await guest.setViewportSize({ width: 844, height: 390 });
    await guest.screenshot({ path: testInfo.outputPath("04-resultats-dutch-paysage.png"), fullPage: true });
  } finally {
    await guest.close();
  }
});

test("glisser la carte, annoncer Dutch et réagir après le dernier tour", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(45_000);
  await fixDeckOrder(host);
  await host.setViewportSize({ width: 390, height: 844 });
  await host.addInitScript(() => {
    localStorage.setItem("ficodutch-game-sound", "on");
    const startTone = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when) {
      const data = document.documentElement.dataset;
      if (this.type === "sawtooth") data.dutchNotes = String(Number(data.dutchNotes ?? 0) + 1);
      return startTone.call(this, when);
    };
  });
  const guest = await browser.newPage({ baseURL, hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceGeste", "BobGeste");
    await host.getByRole("button", { name: "+1 / -1", exact: true }).click();
    await expect(guest.getByRole("button", { name: "+1 / -1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await start.click();
    await expectLocalTurn(guest, 20_000);
    await drawDeck(guest).click();
    const cdp = await guest.context().newCDPSession(guest);
    try {
      const card = drawnCard(guest);
      await card.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const from = (await card.boundingBox())!;
      const to = (await guest.locator(".discard-slot").boundingBox())!;
      const origin = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
      const target = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [origin] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 35, y: 150 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(card).toBeVisible();
      await expect(discard(guest)).toHaveAccessibleName("Défausse vide");
      await card.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished));
      });
      const dutch = guest.locator(".position-bottom .player-name").getByRole("button", { name: "Annoncer Dutch en fin de tour" });
      await dutch.tap();
      await expect(dutch).toHaveAttribute("aria-pressed", "true");
      await expect(guest.getByRole("button", { name: "Défausser la carte tirée" })).toHaveCount(0);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [origin] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [target] });
      await expect(guest.locator(".discard-slot")).toHaveAttribute("data-drop-target", "true");
      await guest.screenshot({ path: testInfo.outputPath("01-glisser-vers-defausse.png") });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await cdp.detach();
    }
    const announced = host.getByRole("img", { name: "BobGeste a annoncé Dutch" });
    await expect(announced).toBeVisible();
    await expect(announced).toHaveCSS("animation-name", "dutch-announcement");
    await expect(host.locator("html")).toHaveAttribute("data-dutch-notes", "3");
    const banner = host.getByRole("alert").filter({ hasText: "Dutch !" });
    await expect(banner).toHaveText("Dutch !BobGeste");
    await expect(banner.locator("svg")).toHaveCSS("animation-name", "dutch-megaphone");
    await banner.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await host.screenshot({ path: testInfo.outputPath("02-annonce-dutch.png") });
    await expectLocalTurn(host);
    await drawDeck(host).click();
    const drawn = drawnCard(host);
    await drawn.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const from = (await drawn.boundingBox())!;
    const to = (await host.getByRole("button", { name: "Remplacer la carte 4", exact: true }).boundingBox())!;
    await host.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await host.mouse.down();
    await host.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await expect(host.getByRole("button", { name: "Remplacer la carte 4", exact: true })).toHaveAttribute("data-drop-target", "true");
    await host.mouse.up();
    await expect(activeTurn(guest)).toHaveText("Dernières réactions");
    await expect(banner).toHaveCount(0);
    await expect(guest.getByRole("progressbar", { name: "Temps pour réagir" })).toHaveAttribute("aria-valuemax", "3");
    await expectClockFromTop(guest.getByRole("progressbar", { name: "Temps pour réagir" }));
    await expect(discard(guest)).toHaveAccessibleName("Défausse, 7 de pique");
    await guest.locator('.position-bottom [data-hand-slot="3"]').click({ clickCount: 3 });
    await expect(discard(host)).toHaveAccessibleName("Défausse, 6 de pique");
    await expect(guest.locator(".position-bottom .playing-card")).toHaveCount(3);
    await guest.screenshot({ path: testInfo.outputPath("03-derniere-reaction.png") });
    await expect(guest.getByRole("region", { name: "Main de BobGeste" })).toContainText("30 +10");
  } finally {
    await guest.close();
  }
});
