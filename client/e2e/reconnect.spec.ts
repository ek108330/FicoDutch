import { expect, test, type Page } from "@playwright/test";
import { discardDrawn, activeTurn, drawDeck, drawnCard, expectTableFits, fixDeckOrder, openTwoPlayerHub, turnClock, expectLocalTurn } from "./tableFlow";

async function setConnection(page: Page, online: boolean) {
  if (!online) await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.context().setOffline(!online);
  if (online) await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

async function secondsLeft(page: Page) {
  const clock = turnClock(page);
  return await clock.isVisible() ? Number(await clock.getAttribute("aria-valuenow"))
    : Number.parseInt(await page.getByRole("timer").innerText(), 10);
}

async function drawFirstCard(guest: Page) {
  await expectLocalTurn(guest, 18_000);
  await drawDeck(guest).click();
  await expect(drawnCard(guest)).toHaveAccessibleName("Carte tirée, 5 de pique");
}

test("reconnexion de l’invité après une coupure et un rechargement", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(50_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceReprise", "BobReprise");
    await start.click();
    await drawFirstCard(guest);
    await expect(drawnCard(host)).toHaveCount(0);

    await setConnection(guest, false);
    await expect(guest.getByRole("heading", { name: "Reconnexion à la table" })).toBeVisible();
    await expect(guest.getByText("Ta place est conservée.")).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("01-invite-hors-ligne.png") });
    await expect(activeTurn(host)).toHaveText("BobReprise joue");
    const before = await secondsLeft(host);
    await expect.poll(() => secondsLeft(host)).toBeLessThan(before);

    await setConnection(guest, true);
    await expectLocalTurn(guest);
    await expect(drawnCard(guest)).toHaveAccessibleName("Carte tirée, 5 de pique");
    await guest.reload();
    await expectLocalTurn(guest);
    await expect(drawnCard(guest)).toHaveAccessibleName("Carte tirée, 5 de pique");
    await expect(drawnCard(host)).toHaveCount(0);
    await expect(guest.locator(".position-bottom .playing-card.face-down")).toHaveCount(4);
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("02-invite-revenu.png") });

    await discardDrawn(guest);
    await expectLocalTurn(host);
  } finally {
    await guest.close();
  }
});

test("pause de la table et reprise du chronomètre après le retour de l’hôte", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(50_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AlicePause", "BobPause");
    await start.click();
    await drawFirstCard(guest);
    const before = await secondsLeft(guest);

    await setConnection(host, false);
    await expect(guest.getByRole("heading", { name: "Partie en pause" })).toBeVisible();
    await expect(guest.getByText("En attente du retour de l’hôte.")).toBeVisible();
    await expect(guest.locator(".drawn-card[data-draggable]")).toHaveCount(0);
    const delay = await secondsLeft(guest);
    expect(delay).toBeGreaterThan(110);
    expect(delay).toBeLessThanOrEqual(120);
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.screenshot({ path: testInfo.outputPath("03-pause-hote-portrait.png") });
    await expect.poll(() => secondsLeft(guest)).toBeLessThanOrEqual(delay - 4);

    await guest.setViewportSize({ width: 844, height: 390 });
    await setConnection(host, true);
    await expectLocalTurn(guest);
    await expect(activeTurn(host)).toHaveText("BobPause joue");
    expect(await secondsLeft(guest)).toBeGreaterThanOrEqual(before - 2);
    await expect(drawnCard(guest)).toHaveAccessibleName("Carte tirée, 5 de pique");
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("04-table-reprise-paysage.png") });
    await discardDrawn(guest);
    await expectLocalTurn(host);
  } finally {
    await guest.close();
  }
});
