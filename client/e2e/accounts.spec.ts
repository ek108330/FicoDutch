import { expect, test, type Page } from "@playwright/test";
import { discard, discardDrawn, drawDeck, expectLocalTurn, fixDeckOrder, openManagement } from "./tableFlow";

const password = "essai";
const ready = (page: Page) => page.getByRole("heading", { name: "Statistiques de la partie" });
const game = (page: Page) => page.getByRole("button", { name: "Lancer la partie", exact: true });

test("un invité garde un pseudo unique et peut jouer contre un bot de test", async ({ page, browser, baseURL }, testInfo) => {
  const guest = await browser.newPage({ baseURL });
  try {
    await page.goto("/");
    await expect(page.getByText("Jouer sans compte")).toBeVisible();
    const hubPanel = page.locator(".home-entry");
    const statistics = page.getByRole("navigation", { name: "Statistiques" });
    for (const [width, height] of [[360, 640], [740, 360], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await expect(statistics).toBeInViewport({ ratio: 1 });
      const panel = (await hubPanel.boundingBox())!;
      const buttons = (await statistics.boundingBox())!;
      expect(buttons.y).toBeGreaterThanOrEqual(panel.y + panel.height);
      await page.screenshot({ path: testInfo.outputPath(`accueil-invite-${width}.png`) });
    }
    await page.setViewportSize({ width: 360, height: 640 });
    await page.getByRole("button", { name: "Mes stats" }).click();
    await expect(page.getByText("Connecte-toi pour retrouver tes statistiques personnelles.")).toBeVisible();
    await page.goBack();
    await page.getByRole("button", { name: "Autres joueurs" }).click();
    await expect(page.getByRole("listitem")).toHaveCount(10);
    await page.screenshot({ path: testInfo.outputPath("dix-bots.png"), fullPage: true });
    await page.getByRole("textbox", { name: "Rechercher un pseudo" }).fill("ChaBotté");
    await page.getByRole("button", { name: "Rechercher" }).click();
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("autres-joueurs.png") });
    await page.getByRole("link", { name: "ChaBotté", exact: true }).click();
    await expect(page.getByText(/historique initial simulé/)).toBeVisible();
    await expect(page.getByText("Aucune confrontation terminée.")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("profil-bot.png") });
    await page.goto("/");
    const pseudo = (tab: Page) => tab.getByRole("textbox", { name: "Pseudo", exact: true });
    const create = (tab: Page) => tab.getByRole("button", { name: "Créer un Hub", exact: true });
    const rejected = (tab: Page) => tab.waitForEvent("dialog").then(async (dialog) => {
      expect(dialog.message()).toContain("Ce pseudo est déjà utilisé");
      await dialog.dismiss();
    });
    await pseudo(page).fill("chabotte");
    await Promise.all([rejected(page), create(page).click()]);
    await pseudo(page).fill("InviteLibre");
    await create(page).click();
    await expect(game(page)).toBeVisible();
    await guest.goto("/");
    await pseudo(guest).fill("invitelibre");
    await Promise.all([rejected(guest), create(guest).click()]);
    await page.getByRole("button", { name: "Ajouter un bot" }).click();
    await expect(game(page)).toBeEnabled();
    await game(page).click();
    await expect(page.getByRole("region", { name: "Mémorisation" })).toBeVisible();
    const management = await openManagement(page);
    await management.getByRole("button", { name: "Interrompre la partie" }).click();
    await page.getByRole("button", { name: "Confirmer l’interruption" }).click();
    await expect(ready(page)).toBeVisible();
    await expect(page.getByText("Partie interrompue", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Partie interrompue", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("bilan-invite.png") });
  } finally { await guest.close(); }
});

async function signIn(page: Page, handle: string, register = false) {
  await page.goto("/compte");
  if (register) await page.getByRole("button", { name: "Créer un compte", exact: true }).click();
  await page.getByLabel("Identifiant", { exact: true }).fill(handle);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: register ? "Créer mon compte" : "Se connecter", exact: true }).click();
  await expect(page.getByRole("link", { name: "Mon compte", exact: true })).toBeVisible();
}

async function join(page: Page, name: string) {
  await page.locator(".hub-item").filter({ hasText: `Hub de ${name}` }).getByRole("button", { name: "Rejoindre", exact: true }).click();
}

test("les comptes voient le même classement, et le bilan survit au Hub, au renommage et au changement d’appareil", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(85_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, hasTouch: true, viewport: { width: 390, height: 844 } });
  const otherDevice = await browser.newPage({ baseURL });
  try {
    await signIn(host, "AliceCompte", true);
    await signIn(guest, "BobbyCompte", true);
    await signIn(otherDevice, "bobbycompte");
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    await join(guest, "AliceCompte");
    await expect(game(host)).toBeEnabled({ timeout: 12_000 });
    const rejected = otherDevice.waitForEvent("dialog").then(async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      return message;
    });
    await join(otherDevice, "AliceCompte");
    expect(await rejected).toContain("déjà une place");
    await host.getByRole("slider").press("Home");
    await host.getByRole("button", { name: "6 cartes", exact: true }).click();
    await expect(guest.getByRole("button", { name: "6 cartes", exact: true })).toHaveAttribute("aria-pressed", "true");
    await game(host).click();
    await expectLocalTurn(guest, 20_000);
    await drawDeck(guest).click();
    await guest.getByRole("button", { name: "Annoncer Dutch en fin de tour" }).click();
    await discardDrawn(guest);
    await expectLocalTurn(host);
    await drawDeck(host).click();
    await discardDrawn(host);
    for (const tab of [host, guest]) {
      await expect(tab.getByRole("heading", { name: "Fin de la partie" })).toBeVisible({ timeout: 15_000 });
      await expect(ready(tab)).toHaveCount(0);
    }
    await expect(guest.getByRole("button", { name: "Interrompre la partie" })).toHaveCount(0);
    await expect(host.getByRole("button", { name: "Lancer la prochaine partie" })).toBeEnabled();
    await expect(host.getByRole("button", { name: "Interrompre la partie" })).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath("01-fin-de-partie.png"), fullPage: true });
    await host.getByRole("button", { name: "Lancer la prochaine partie" }).click();
    await expect(guest.getByRole("region", { name: "Mémorisation" })).toBeVisible();
    const management = await openManagement(host);
    await management.getByRole("button", { name: "Interrompre la partie" }).click();
    await host.getByRole("button", { name: "Confirmer l’interruption" }).click();
    await Promise.all([host, guest].map((tab) => expect(ready(tab)).toBeVisible()));
    const cumulative = (tab: Page) => tab.getByRole("region", { name: "Bilan cumulé de la table" });
    await expect(cumulative(guest)).toContainText("2 parties · 1 manche terminée");
    expect(await cumulative(host).innerText()).toEqual(await cumulative(guest).innerText());
    await guest.screenshot({ path: testInfo.outputPath("02-bilan-cumule-portrait.png"), fullPage: true });
    await cumulative(guest).getByRole("link").last().click();
    await expect(guest.getByRole("heading", { name: "Classement officiel" })).toBeVisible();
    const url = guest.url();

    await otherDevice.goto("/compte");
    await otherDevice.getByLabel("Pseudo", { exact: true }).fill("BobbyMobile");
    await otherDevice.getByRole("button", { name: "Enregistrer le pseudo" }).click();
    await expect(otherDevice.getByRole("status")).toHaveText("Pseudo enregistré.");
    const link = otherDevice.getByRole("link", { name: "Mon profil public" });
    const profileUrl = (await link.getAttribute("href"))!;
    await link.click();
    await expect(otherDevice.getByRole("heading", { name: "BobbyMobile" })).toBeVisible();
    await expect(otherDevice.locator(".profile-numbers")).toContainText("Parties jouées2");
    await expect(otherDevice.locator(".profile-numbers")).toContainText("Manches terminées1");
    await otherDevice.screenshot({ path: testInfo.outputPath("03-profil-apres-renommage.png"), fullPage: true });
    await otherDevice.goto("/");
    await otherDevice.getByRole("button", { name: "Mes stats" }).click();
    await expect(otherDevice.getByRole("heading", { name: "Mes stats" })).toBeVisible();
    await otherDevice.getByRole("link", { name: "Mes parties" }).click();
    await otherDevice.getByRole("listitem").filter({ hasText: "Terminée" }).getByRole("link").click();
    await expect(ready(otherDevice)).toBeVisible();
    await expect(otherDevice.getByRole("heading", { name: "Classement officiel" })).toBeVisible();
    expect(otherDevice.url()).toBe(url);

    const anonymous = await browser.newPage({ baseURL });
    try {
      await anonymous.goto(profileUrl);
      await expect(anonymous.getByRole("heading", { name: "BobbyMobile" })).toBeVisible();
      await expect(anonymous.getByText("Identifiant de connexion")).toHaveCount(0);
      await anonymous.goto(url);
      await expect(anonymous.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
      await expect(anonymous.getByRole("heading", { name: "Classement officiel" })).toHaveCount(0);
    } finally { await anonymous.close(); }
  } finally {
    await guest.close();
    await otherDevice.close();
  }
});

test("l’interruption d’une manche conserve une réaction et une pénalité sans résultat officiel", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(55_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, hasTouch: true, viewport: { width: 320, height: 620 } });
  try {
    await signIn(host, "AlicePartie", true);
    await signIn(guest, "BobbyPartie", true);
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    await join(guest, "AlicePartie");
    await expect(game(host)).toBeEnabled({ timeout: 12_000 });
    await host.getByRole("button", { name: "+1 / -1", exact: true }).click();
    await expect(guest.getByRole("button", { name: "+1 / -1", exact: true })).toHaveAttribute("aria-pressed", "true");
    await game(host).click();
    await expectLocalTurn(guest, 20_000);
    await drawDeck(guest).click();
    await discardDrawn(guest);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 5 de pique");
    await host.locator(".position-bottom .playing-card").first().click({ clickCount: 3 });
    await expect(host.locator(".position-bottom .playing-card")).toHaveCount(5);
    await guest.locator(".position-bottom .playing-card").nth(3).click({ clickCount: 3 });
    await expect(discard(host)).toHaveAccessibleName("Défausse, 6 de pique");
    const management = await openManagement(host);
    await management.getByRole("button", { name: "Interrompre la partie" }).click();
    await host.getByRole("button", { name: "Confirmer l’interruption" }).click();
    for (const page of [host, guest]) {
      await expect(ready(page)).toBeVisible();
      await expect(ready(page)).toHaveCSS("color", "rgb(255, 248, 231)");
      await expect(page.getByText("Partie interrompue", { exact: true })).toBeVisible();
      await expect(page.getByText("0 manches terminées", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Classement officiel" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Activité de la manche 1 interrompue" })).toContainText("1 réaction valide · 1 pénalité");
      await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Shuriken" }) })).toContainText("BobbyPartie");
      await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Le boulet" }) })).toContainText("AlicePartie");
      await expect(page.getByRole("heading", { name: "Le distributeur" })).toHaveCount(0);
    }
    await guest.screenshot({ path: testInfo.outputPath("01-interruption-portrait.png"), fullPage: true });
    await guest.setViewportSize({ width: 740, height: 360 });
    await guest.screenshot({ path: testInfo.outputPath("02-interruption-paysage.png"), fullPage: true });
  } finally { await guest.close(); }
});

test("la disparition de l’hôte produit un bilan partiel à l’expiration du délai de reconnexion", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(175_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    await signIn(host, "AlicePause", true);
    await signIn(guest, "BobbyPause", true);
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    await join(guest, "AlicePause");
    await expect(game(host)).toBeEnabled({ timeout: 12_000 });
    await game(host).click();
    await expect(guest.getByRole("region", { name: "Mémorisation" })).toBeVisible();
    await host.close();
    await expect(guest.getByRole("heading", { name: "Partie en pause" })).toBeVisible();
    await expect(ready(guest)).toBeVisible({ timeout: 132_000 });
    await expect(guest.getByText(/Bilan partiel établi/)).toBeVisible();
    await expect(guest.getByText("Partie interrompue", { exact: true })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Classement officiel" })).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("01-bilan-partiel-apres-deconnexion.png"), fullPage: true });
  } finally { await guest.close(); }
});
