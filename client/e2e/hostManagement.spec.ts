import { expect, test } from "@playwright/test";
import { closeSettings, discardDrawn, discard, drawDeck, drawnCard, fixDeckOrder, openLobby, openManagement,
  openSettings, openTwoPlayerHub, expectLocalTurn } from "./tableFlow";

test("l’hôte peut retirer un invité de la salle d’attente", async ({ page: host, browser, baseURL }) => {
  const guest = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceSalon", "BobSalon");
    await expect(host.getByRole("button", { name: "Gérer la table" })).toHaveCount(0);
    await expect((await openSettings(guest)).getByRole("button", { name: "Gérer la table" })).toHaveCount(0);
    await closeSettings(guest);
    const dialog = await openManagement(host);
    await expect(dialog.getByRole("button", { name: "Interrompre la partie" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Retirer BobSalon" }).click();
    await dialog.getByRole("button", { name: "Confirmer le retrait" }).click();
    await expect(guest.getByRole("status").filter({ hasText: "L’hôte t’a retiré de la table." })).toBeVisible();
    await expect(start).toBeDisabled();
    await expect(host.getByText("1/6 joueurs", { exact: true })).toBeVisible();
    await host.getByRole("button", { name: "Quitter le Hub" }).click();
    await expect(guest.getByText("Hub de AliceSalon", { exact: true })).toHaveCount(0);
  } finally {
    await guest.close();
  }
});

test("le retrait conserve les cartes et l’interruption confirmée ferme la table", async ({
  page: host, browser, baseURL,
}, testInfo) => {
  test.setTimeout(55_000);
  await fixDeckOrder(host);
  await host.setViewportSize({ width: 390, height: 844 });
  const guest = await browser.newPage({ baseURL });
  const removed = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceGestion", "BobGestion");
    await openLobby(removed, "ChloeGestion");
    await removed.locator(".hub-item").filter({ hasText: "Hub de AliceGestion" })
      .getByRole("button", { name: "Rejoindre", exact: true }).click();
    await expect(removed.getByText("Salle d'attente")).toBeVisible();
    await expect(host.getByText("3/6 joueurs", { exact: true })).toBeVisible();
    await start.click();
    await expectLocalTurn(removed, 18_000);
    await drawDeck(removed).click();
    await expect(drawnCard(removed)).toHaveAccessibleName("Carte tirée, As de pique");
    await expect(guest.getByRole("button", { name: "Gérer la table" })).toHaveCount(0);

    let dialog = await openManagement(host);
    await host.screenshot({ path: testInfo.outputPath("00-gestion-parametres-hote.png") });
    await dialog.getByRole("button", { name: "Retirer ChloeGestion" }).click();
    await expect(dialog.getByRole("heading", { name: "Retirer ChloeGestion ?" })).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath("01-confirmation-retrait-portrait.png") });
    await dialog.getByRole("button", { name: "Annuler" }).click();
    await dialog.getByRole("button", { name: "Fermer" }).click();
    await expectLocalTurn(removed);
    await expect(drawnCard(removed)).toHaveAccessibleName("Carte tirée, As de pique");

    dialog = await openManagement(host);
    await dialog.getByRole("button", { name: "Retirer ChloeGestion" }).click();
    await dialog.getByRole("button", { name: "Confirmer le retrait" }).click();
    await expect(removed.getByText("L’hôte t’a retiré de la table.", { exact: true })).toBeVisible();
    await expect(removed.locator(".hub-list")).toBeVisible();
    expect(await removed.locator(".hub-list").evaluate((list) => list.scrollWidth <= list.clientWidth)).toBe(true);
    await removed.screenshot({ path: testInfo.outputPath("02-joueuse-retiree.png") });
    await removed.reload();
    await expect(removed.getByRole("textbox", { name: "Pseudo" })).toBeVisible();
    await expectLocalTurn(host);
    await expect(discard(host)).toHaveAccessibleName("Défausse, As de pique");
    const formerHand = host.locator(".table-player").filter({ hasText: "ChloeGestion" });
    await expect(formerHand.locator(".playing-card.face-down")).toHaveCount(4);
    await host.screenshot({ path: testInfo.outputPath("03-main-conservee-portrait.png") });

    await drawDeck(host).click();
    await host.getByRole("button", { name: "Annoncer Dutch en fin de tour" }).click();
    await discardDrawn(host);
    await expectLocalTurn(guest);
    await drawDeck(guest).click();
    await discardDrawn(guest);
    await expect(host.getByRole("region", { name: "Main de ChloeGestion" })).toBeVisible();
    await host.getByRole("button", { name: "Lancer la manche suivante" }).click();
    await expect(host.locator('.game-table[data-player-count="2"]')).toBeVisible({ timeout: 9_000 });
    await expect(formerHand).toHaveCount(0);

    await host.setViewportSize({ width: 844, height: 390 });
    dialog = await openManagement(host);
    await dialog.getByRole("button", { name: "Interrompre la partie", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Interrompre la partie ?" })).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath("04-confirmation-interruption-paysage.png") });
    await dialog.getByRole("button", { name: "Annuler" }).click();
    await expect(guest.locator(".game-table")).toBeVisible();
    await dialog.getByRole("button", { name: "Interrompre la partie", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirmer l’interruption" }).click();
    for (const page of [host, guest]) {
      await expect(page.getByText("L’hôte a interrompu la partie.", { exact: true })).toBeVisible();
    }
    await expect(removed.getByText("Hub de AliceGestion", { exact: true })).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("05-partie-interrompue.png") });
  } finally {
    await Promise.all([guest.close(), removed.close()]);
  }
});
