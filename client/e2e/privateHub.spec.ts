import { expect, test, type Page } from "@playwright/test";
import { discard, drawDeck, drawnCard, expectScreenFits, fixDeckOrder, openLobby, openSettings, openTwoPlayerHub } from "./tableFlow";

const privateHub = (page: Page) => page.locator(".hub-item").filter({ hasText: "Hub de SalonPrive" });
const requestAdmission = (page: Page) => privateHub(page).getByRole("button", { name: "Rejoindre" }).click();

test("le Hub privé réserve les admissions à l’hôte et ferme la file au complet ou au lancement", async ({
  page: host, browser, baseURL,
}, testInfo) => {
  const viewport = { width: 390, height: 780 };
  await host.setViewportSize(viewport);
  const guest = await browser.newPage({ baseURL, viewport });
  const outsider = await browser.newPage({ baseURL, viewport });
  try {
    await Promise.all([openLobby(host, "SalonPrive"), openLobby(guest, "InvitePrive"), openLobby(outsider, "AttentePrive")]);
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    const privateSetting = host.getByRole("checkbox", { name: "Hub Privé" });
    await privateSetting.click();
    await expect(privateSetting).toBeChecked();
    await expect(privateHub(guest)).toContainText("Hub Privé · En attente");
    await expect(privateHub(guest)).not.toContainText("/6 joueurs");
    await expect(privateHub(guest).getByRole("button", { name: /Aperçu/ })).toHaveCount(0);
    await requestAdmission(guest);
    await expect(privateHub(guest).getByRole("status")).toHaveText("En attente de validation");
    await expect(privateHub(outsider)).not.toContainText("InvitePrive");
    await expectScreenFits(host);
    await expect(host.getByRole("group", { name: "Emojis du Hub" }).getByRole("button")).toHaveCount(9);
    await expect(host.getByRole("button", { name: "Accepter InvitePrive" })).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath("hub-prive-admissions.png") });
    await guest.screenshot({ path: testInfo.outputPath("accueil-hub-prive.png") });
    await host.getByRole("button", { name: "Accepter InvitePrive" }).click();
    await expect(guest.getByText("2/6 joueurs")).toBeVisible();
    await expect(guest.getByRole("checkbox", { name: "Hub Privé" })).toBeDisabled();
    await expect(guest.getByRole("button", { name: /Retirer/ })).toHaveCount(0);
    await host.getByRole("button", { name: "Retirer InvitePrive" }).click();
    await expect(guest.getByText("L’hôte t’a retiré de la table.")).toBeVisible();
    await requestAdmission(guest);
    await host.getByRole("button", { name: "Accepter InvitePrive" }).click();

    await requestAdmission(outsider);
    await expect(guest.getByRole("button", { name: "Accepter AttentePrive" })).toHaveCount(0);
    await host.getByRole("button", { name: "Refuser AttentePrive" }).click();
    await expect(outsider.getByText("L’hôte a refusé la demande d’admission.")).toBeVisible();
    await requestAdmission(outsider);
    for (let count = 3; count <= 6; count++) {
      await host.getByRole("button", { name: "Ajouter un bot" }).click();
      await expect(host.getByText(`${count}/6 joueurs`)).toBeVisible();
    }
    await expect(outsider.getByText("La demande d’admission a été clôturée.")).toBeVisible();
    await expect(host.getByRole("button", { name: "Accepter AttentePrive" })).toHaveCount(0);
    await host.getByRole("button", { name: "Retirer Bot 1", exact: true }).click();
    await requestAdmission(outsider);
    await expect(host.getByRole("button", { name: "Accepter AttentePrive" })).toBeVisible();
    await host.getByRole("button", { name: "Lancer la partie" }).click();
    await expect(privateHub(outsider)).toContainText("Hub Privé · En partie");
    await expect(outsider.getByText("La demande d’admission a été clôturée.")).toBeVisible();
    await expect(privateHub(outsider).getByRole("button", { name: "Rejoindre" })).toBeDisabled();
  } finally {
    await Promise.all([guest.close(), outsider.close()]);
  }
});

test("les joueurs lancent la manche en remasquant leurs cartes et peuvent toucher la défausse", async ({
  page: host, browser, baseURL,
}, testInfo) => {
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, viewport: { width: 390, height: 780 } });
  const hand = (page: Page) => page.locator(".position-bottom");
  const memory = (page: Page) => page.getByRole("region", { name: "Mémorisation" });
  const uncover = async (page: Page) => {
    for (const position of [1, 2]) {
      await hand(page).getByRole("button", { name: `Carte ${position} face cachée`, exact: true }).click();
      await expect(hand(page).getByRole("button", { name: new RegExp(`^Carte ${position} (?!face cachée)`) })).toBeVisible();
    }
  };
  const cover = async (page: Page, position: number) => {
    await hand(page).getByRole("button", { name: new RegExp(`^Carte ${position} (?!face cachée)`) }).click();
  };
  try {
    const start = await openTwoPlayerHub(host, guest, "HoteCartes", "InviteCartes");
    await start.click();
    await expect(memory(host)).toBeVisible();
    await Promise.all([uncover(host), uncover(guest)]);
    await cover(host, 1);
    await cover(host, 2);
    await cover(guest, 1);
    await expect(memory(host)).toBeVisible();
    await expect(guest.locator(".position-top .face-up")).toHaveCount(0);
    await cover(guest, 2);
    await expect(drawDeck(guest)).toBeEnabled({ timeout: 3_000 });
    await drawDeck(guest).click();
    await expect(drawnCard(guest)).toBeVisible();
    await drawnCard(guest).evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map(({ finished }) => finished));
    });
    await guest.screenshot({ path: testInfo.outputPath("carte-tiree-defausse.png") });
    await discard(guest).click();
    await expect(drawnCard(guest)).toHaveCount(0);
    await expect(discard(host).locator(".face-up")).toBeVisible();
    await expect(guest.getByRole("button", { name: "Quitter la table" })).toHaveCount(0);
    await expect((await openSettings(guest)).getByRole("button", { name: "Quitter la table" })).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("quitter-dans-parametres.png") });
  } finally {
    await guest.close();
  }
});
