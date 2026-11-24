import { expect, test, type Page } from "@playwright/test";
import { io } from "socket.io-client";
import type { HubListing } from "../../shared/hubTypes";
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
    const hubName = host.getByRole("heading", { name: "Hub de SalonPrive" });
    const [checkbox, title] = await Promise.all([privateSetting.boundingBox(), hubName.boundingBox()]);
    expect(checkbox!.x + checkbox!.width).toBeLessThan(title!.x);
    expect(checkbox!.y + checkbox!.height / 2).toBeCloseTo(title!.y + title!.height / 2, 0);
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

test("une longue file privée défile et se filtre sans déplacer le bouton de lancement", async ({
  page: host,
}, testInfo) => {
  await host.setViewportSize({ width: 390, height: 800 });
  const applicants = Array.from({ length: 12 }, () => io("http://127.0.0.1:15300", {
    autoConnect: false, reconnection: false,
    auth: { buildRevision: "abcdef0123456789abcdef0123456789abcdef01" },
  }));
  try {
    await openLobby(host, "FilePrivee");
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    const privateSetting = host.getByRole("checkbox", { name: "Hub Privé" });
    await privateSetting.click();
    await expect(privateSetting).toBeChecked();
    await host.getByRole("button", { name: "Ajouter un bot" }).click();
    const botCard = host.getByRole("list", { name: "Joueurs présents" }).getByRole("listitem").filter({ hasText: "Bot 1" });
    await expect(botCard.locator(":scope > :first-child")).toHaveAccessibleName("Retirer Bot 1");

    const start = host.getByRole("button", { name: "Lancer la partie" });
    await expect(start).toBeEnabled();
    const before = await start.boundingBox();
    const search = host.getByRole("searchbox", { name: "Rechercher un pseudo" });
    const queue = host.getByRole("list", { name: "Demandes d’admission" });
    for (const [index, client] of applicants.entries()) {
      const hubId = await new Promise<string>((resolve, reject) => {
        client.once("connect_error", reject);
        client.once("hubs:update", (listings: HubListing[]) => {
          const hub = listings.find(({ name }) => name === "Hub de FilePrivee");
          if (hub) resolve(hub.id);
          else reject(new Error("Hub privé absent"));
        });
        client.connect();
      });
      client.emit("hub:join", { hubId, pseudo: `Demandeur${String(index + 1).padStart(2, "0")}` });
      await expect(queue.getByRole("listitem")).toHaveCount(index + 1);
      expect(await start.boundingBox()).toEqual(before);
      if (index === 9) await expect(search).toHaveCount(0);
    }
    await expect(search).toBeVisible();
    const boxes = await Promise.all([0, 1, 2].map((index) => queue.getByRole("listitem").nth(index).boundingBox()));
    expect(boxes[0]!.y).toEqual(boxes[1]!.y);
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[0]!.y).toBeLessThan(boxes[2]!.y);
    await expectScreenFits(host);
    await host.screenshot({ path: testInfo.outputPath("file-privee-portrait.png") });

    await host.setViewportSize({ width: 390, height: 1040 });
    const rows = queue.getByRole("listitem");
    await expect(rows.nth(5)).toBeInViewport({ ratio: 1 });
    await expect(rows.nth(6)).not.toBeInViewport();
    await queue.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(rows.last()).toBeInViewport({ ratio: 1 });
    await host.screenshot({ path: testInfo.outputPath("file-privee-defilement.png") });

    await host.setViewportSize({ width: 360, height: 640 });
    await expect(search).toBeInViewport({ ratio: 1 });
    await expect(start).toBeInViewport({ ratio: 1 });
    await expectScreenFits(host);
    await host.setViewportSize({ width: 390, height: 800 });
    const beforeSearch = await start.boundingBox();
    await search.fill("demandeur12");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Demandeur12");
    await expect(rows.first().getByRole("button", { name: "Accepter Demandeur12" })).toHaveText("");
    await expect(rows.first().getByRole("button", { name: "Refuser Demandeur12" })).toHaveText("");
    expect(await start.boundingBox()).toEqual(beforeSearch);
    await host.screenshot({ path: testInfo.outputPath("file-privee-recherche.png") });
    await rows.first().getByRole("button", { name: "Refuser Demandeur12" }).click();
    await expect(host.getByText("Aucun pseudo trouvé.")).toBeVisible();
    expect(await start.boundingBox()).toEqual(beforeSearch);
  } finally {
    applicants.forEach((client) => client.disconnect());
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
