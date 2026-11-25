import { expect, test, type Page } from "@playwright/test";
import { openSettings, discardDrawn, activeTurn, drawDeck, drawnCard, expectTableFits, fixDeckOrder, openLobby, openManagement,
  openTwoPlayerHub, turnClock, expectLocalTurn } from "./tableFlow";

async function setConnection(page: Page, online: boolean) {
  if (!online) await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.context().setOffline(!online);
  if (online) await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

async function secondsLeft(page: Page) {
  const clock = turnClock(page);
  return await clock.isVisible() ? Number(await clock.getAttribute("aria-valuenow"))
    : Number(await page.getByRole("progressbar", { name: "Délai de reprise" }).getAttribute("aria-valuenow"));
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

test("la déconnexion de l’hôte transmet les cartes et le chronomètre au joueur connecté", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(50_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AlicePause", "BobPause");
    await start.click();
    await drawFirstCard(guest);
    const before = await secondsLeft(guest);

    await setConnection(host, false);
    await guest.setViewportSize({ width: 390, height: 844 });
    const management = await openManagement(guest);
    await expect(management.getByRole("button", { name: "Retirer AlicePause" })).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("03-nouvel-hote-portrait.png") });
    await management.getByRole("button", { name: "Fermer" }).click();
    expect(await secondsLeft(guest)).toBeGreaterThanOrEqual(before - 2);
    await expect(drawnCard(guest)).toHaveAccessibleName("Carte tirée, 5 de pique");
    await expectTableFits(guest);
    await guest.setViewportSize({ width: 844, height: 390 });
    await guest.screenshot({ path: testInfo.outputPath("04-table-reprise-paysage.png") });
    await setConnection(host, true);
    await expect(host.getByRole("textbox", { name: "Pseudo", exact: true })).toBeVisible();
    await discardDrawn(guest);
    await expectLocalTurn(guest);
  } finally {
    await guest.close();
  }
});

test("le bouton quitter donne l’administration au premier humain connecté après l’hôte", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(50_000);
  await fixDeckOrder(host);
  const successor = await browser.newPage({ baseURL });
  const last = await browser.newPage({ baseURL });
  try {
    await openLobby(host, "AliceDepart");
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    await host.getByRole("button", { name: "Ajouter un bot" }).click();
    for (const [page, name] of [[successor, "BobDepart"], [last, "ChloeDepart"]] as const) {
      await openLobby(page, name);
      await page.locator(".hub-item").filter({ hasText: "Hub de AliceDepart" }).getByRole("button", { name: "Rejoindre" }).click();
      await expect(page.getByRole("list", { name: "Joueurs présents" })).toBeVisible();
    }
    await host.getByRole("button", { name: "Lancer la partie" }).click();
    await expectLocalTurn(last, 22_000);
    await drawDeck(last).click();
    const card = await drawnCard(last).getAttribute("aria-label");
    expect(card).toMatch(/^Carte tirée, /);
    await (await openSettings(host)).getByRole("button", { name: "Quitter la table", exact: true }).click();
    await expect(host.getByText("BobDepart a repris la table.")).toBeVisible();
    const management = await openManagement(successor);
    await expect(management.getByRole("button", { name: "Retirer ChloeDepart" })).toBeVisible();
    await successor.screenshot({ path: testInfo.outputPath("admin-transmise-au-joueur.png") });
    await expect(drawnCard(last)).toHaveAccessibleName(card!);
    await discardDrawn(last);
    await last.getByRole("button", { name: "Passer le pouvoir" }).click();
    await expect(activeTurn(last)).not.toHaveText("ChloeDepart joue");
  } finally {
    await Promise.all([successor.close(), last.close()]);
  }
});
