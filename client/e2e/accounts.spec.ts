import { expect, test, type Page } from "@playwright/test";
import type { SavedMatch } from "../../shared/statistics";
import { discard, discardDrawn, drawDeck, expectLocalTurn, expectScreenFits, fixDeckOrder, openManagement, openSettings } from "./tableFlow";

const password = "essai";
const ready = (page: Page) => page.getByRole("heading", { name: "Statistiques de la partie" });
const game = (page: Page) => page.getByRole("button", { name: "Lancer la partie", exact: true });

test("un invité garde un pseudo unique et peut jouer contre un bot de test", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(45_000);
  const guest = await browser.newPage({ baseURL });
  try {
    await page.goto("/");
    await expect(page.getByText("Jouer sans compte")).toBeVisible();
    const hubPanel = page.locator(".home-entry");
    const statistics = page.getByRole("navigation", { name: "Statistiques" });
    const podium = page.getByRole("region", { name: "Podium RN" });
    await expect(podium.getByRole("link")).toHaveCount(3);
    await expect(podium.getByRole("heading")).toHaveCount(0);
    const podiumNames = await podium.locator(".podium-name").allTextContents();
    for (const [width, height] of [[320, 568], [360, 640], [740, 360], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await expect(statistics).toBeInViewport({ ratio: 1 });
      const panel = (await hubPanel.boundingBox())!;
      const buttons = (await statistics.boundingBox())!;
      expect(buttons.y).toBeGreaterThanOrEqual(panel.y + panel.height);
      const topThree = (await podium.boundingBox())!;
      expect(topThree.y).toBeGreaterThanOrEqual(buttons.y + buttons.height);
      await expect(podium).toBeInViewport({ ratio: 1 });
      const steps = await podium.locator(".podium-step").evaluateAll((items) => items.map((item) => {
        const { height, bottom } = item.getBoundingClientRect();
        return { height, bottom };
      }));
      expect(steps[0].height).toBeGreaterThan(steps[1].height);
      expect(steps[1].height).toBeGreaterThan(steps[2].height);
      expect(steps[0].bottom).toBeCloseTo(steps[2].bottom);
      await page.screenshot({ path: testInfo.outputPath(`accueil-invite-${width}.png`) });
    }
    await page.setViewportSize({ width: 360, height: 640 });
    await page.getByRole("button", { name: "Mes stats" }).click();
    await expect(page.getByText("Connecte-toi pour retrouver tes statistiques personnelles.")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("textbox", { name: "Pseudo", exact: true })).toBeVisible();
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Mon compte", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
    const nativeBack = () => page.evaluate(() => window.dispatchEvent(new Event("ficodutch:back", { cancelable: true })));
    expect(await nativeBack()).toBe(false);
    await expect(page.getByRole("textbox", { name: "Pseudo", exact: true })).toBeVisible();
    expect(await nativeBack()).toBe(false);
    expect(await nativeBack()).toBe(false);
    await expect(page.getByRole("textbox", { name: "Pseudo", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Classement", exact: true }).click();
    const directory = page.getByRole("table", { name: "Classement des joueurs" });
    await expect(directory.getByRole("row")).toHaveCount(11);
    await expect(directory.getByRole("columnheader")).toHaveText(["Rang", "Nom", "Manches", "Victoires", "RN", "7j"]);
    await expect(directory.locator(".directory-position")).toHaveText(Array.from({ length: 10 }, (_, i) => String(i + 1)));
    await expect(directory.locator("tbody tr[data-place] .directory-position")).toHaveText(["1", "2", "3"]);
    expect(await directory.locator("tbody a").evaluateAll((links) => links.every((link) => {
      const range = document.createRange();
      range.selectNodeContents(link);
      return range.getClientRects().length === 1;
    }))).toBe(true);
    const ratings = (await directory.locator("tbody td:nth-last-child(2)").allTextContents()).map(Number);
    const names = await directory.locator("tbody a").allTextContents();
    expect(names.slice(0, 3)).toEqual(podiumNames);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
    const sortBy = (name: string) => directory.getByRole("button", { name, exact: true }).click();
    await sortBy("Nom");
    await expect(directory.locator("tbody a").first()).toHaveText("BotEnTrain");
    await sortBy("Nom");
    await expect(directory.locator("tbody a").first()).toHaveText("ValteriBotAs");
    await sortBy("Rang");
    await expect(directory.locator(".directory-position").first()).toHaveText("1");
    await sortBy("Rang");
    await expect(directory.locator(".directory-position").first()).toHaveText("10");
    for (const [column, index] of [["Manches", 2], ["Victoires", 3]] as const) {
      const sortedValues = async () => (await directory.locator(`tbody td:nth-of-type(${index})`).allTextContents()).map((value) => parseFloat(value));
      await sortBy(column);
      await expect.poll(async () => {
        const values = await sortedValues();
        return values.every((value, position) => position === 0 || values[position - 1] >= value);
      }).toBe(true);
      await sortBy(column);
      await expect.poll(async () => {
        const values = await sortedValues();
        return values.every((value, position) => position === 0 || values[position - 1] <= value);
      }).toBe(true);
    }
    await sortBy("7j");
    await expect(directory.getByRole("columnheader").last()).toHaveAttribute("aria-sort", "descending");
    await sortBy("RN");
    await page.screenshot({ path: testInfo.outputPath("dix-bots.png"), fullPage: true });
    const search = page.getByRole("searchbox", { name: "Rechercher un joueur" });
    await expect(page.getByRole("button", { name: "Rechercher", exact: true })).toHaveCount(0);
    await Promise.all([
      page.waitForRequest((request) => /\/api\/players\?q=C&/.test(request.url())),
      search.pressSequentially("C"),
    ]);
    await search.pressSequentially("haBotté");
    await expect(directory.getByRole("row")).toHaveCount(2);
    await expect(directory.locator(".directory-position")).toHaveText(String(names.indexOf("ChaBotté") + 1));
    await page.screenshot({ path: testInfo.outputPath("autres-joueurs.png") });
    await page.getByRole("link", { name: "ChaBotté", exact: true }).click();
    await expect(page.getByText(/historique initial simulé/)).toBeVisible();
    await expect(page.locator(".profile-identity .player-avatar")).toBeVisible();
    await expect(page.locator(".profile-identity [data-avatar-mark='robot']")).toBeVisible();
    await expect(page.locator(".profile-headline")).toContainText("Manches gagnées");
    await expect(page.getByRole("heading", { name: "Historique des confrontations" })).toHaveCount(0);
    await expect(page.getByText("Aucune manche classée.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("profil-bot.png") });

    await page.route("**/api/players/*", async (route) => {
      const response = await route.fetch();
      const profile = await response.json();
      const ratings = [45, 48, 46, 52, 54].map((rating, index) => ({
        rating, date: Date.UTC(2026, 0, index + 1),
      }));
      const rivals = [
        { id: "rival-fort", name: "RivalFort", played: 10, wins: 1, losses: 6, rating: 53 },
        { id: "rival-faible", name: "RivalFaible", played: 10, wins: 7, losses: 2, rating: 47 },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `rival-${index}`, name: `Rival${index}`, played: 9,
          wins: index < 3 ? 2 : 6, losses: index < 3 ? 7 : 1, rating: 50,
        })),
      ];
      await route.fulfill({ response, json: { ...profile, ratings, rivals } });
    });
    await page.reload();
    const ratingChart = page.getByRole("img", { name: "Évolution du RN sur les dernières manches classées" });
    await expect(ratingChart).toBeVisible();
    await expect(ratingChart.getByText("Indice RN", { exact: true })).toBeVisible();
    await expect(ratingChart.getByText("Manches classées", { exact: true })).toBeVisible();
    await expect(ratingChart.locator("polyline")).toHaveCount(1);
    const ratingTicks = (await ratingChart.locator("text[dominant-baseline='central']").allTextContents()).map(Number);
    expect(ratingTicks.at(-1)! - ratingTicks[0]).toBeGreaterThanOrEqual(40);
    await expect(page.locator(".archive-card").filter({ has: ratingChart }).getByRole("list")).toHaveCount(0);
    await ratingChart.screenshot({ path: testInfo.outputPath("graphique-rn.png") });
    const blackBeasts = page.getByRole("region", { name: "Bêtes noires" });
    await expect(blackBeasts.getByRole("img", { name: "1 victoire" })).toBeVisible();
    await expect(blackBeasts.getByRole("img", { name: "6 défaites" })).toBeVisible();
    await expect(blackBeasts).toContainText("60 % de défaites");
    await expect(blackBeasts.getByText("78 % de défaites", { exact: true })).toHaveCount(2);
    const dominated = page.getByRole("region", { name: "Joueurs dominés" });
    await expect(dominated).not.toContainText("de défaites");
    await expect(dominated).toContainText("70 % de victoires");
    await expect(dominated).toContainText("10 manches");
    await expect(page.getByText("Meilleur score de manche", { exact: true })).toHaveCount(0);
    for (const group of ["Rivaux réguliers", "Joueurs dominés", "Bêtes noires"]) {
      const section = page.getByRole("region", { name: group });
      await expect(section.getByRole("listitem")).toHaveCount(3);
      await expect(section.getByRole("heading")).toHaveCSS("color", "rgb(255, 255, 255)");
      const badge = section.locator(".profile-rival-rating .table-rn").first();
      await expect(badge).toHaveText(/^\d+$/);
      await expect(badge).toHaveCSS("background-color", group === "Joueurs dominés" ? "rgb(132, 155, 36)" : "rgb(77, 115, 38)");
    }
    const columns = await page.locator(".profile-rivals").evaluateAll((lists) =>
      lists.map((list) => Array.from(list.querySelectorAll("li:first-child > span"), (cell) => cell.getBoundingClientRect().x)));
    expect(columns).toHaveLength(3);
    expect(columns).toEqual([columns[0], columns[0], columns[0]]);
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(page.getByText("10 et Valets utilisés", { exact: true })).toBeVisible();
    const inlineCounts = await page.locator(".profile-stat-count").evaluateAll((rows) => rows.map((row) => {
      const label = row.querySelector("dt")!.getBoundingClientRect();
      const value = row.querySelector("dd")!.getBoundingClientRect();
      return label.right <= value.left && label.bottom > value.top && value.bottom > label.top;
    }));
    expect(inlineCounts).toEqual([true, true, true, true, true, true]);
    await page.setViewportSize({ width: 360, height: 640 });
    await page.screenshot({ path: testInfo.outputPath("profil-rivalites-portrait.png"), fullPage: true });
    await page.unroute("**/api/players/*");
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
    for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Ajouter un bot" }).click();
    await expect(game(page)).toBeEnabled();
    const hubRoster = page.getByRole("list", { name: "Joueurs présents" });
    const hubRatings = hubRoster.locator(".lobby-rn");
    await expect(hubRatings).toHaveCount(5);
    for (const rating of await hubRatings.all()) {
      await expect(rating).toHaveText(/^\d+$/);
      await expect(rating).toHaveAttribute("data-rn-band", String(Math.floor(Number(await rating.innerText()) / 10)));
      const rightInset = await rating.evaluate((badge) =>
        badge.parentElement!.getBoundingClientRect().right - badge.getBoundingClientRect().right);
      expect(rightInset).toBeCloseTo(6);
    }
    for (const name of await hubRoster.locator(".lobby-player-name").all()) {
      await expect(name).toHaveCSS("white-space", "nowrap");
      await expect(name).toHaveCSS("text-overflow", "ellipsis");
    }
    await expectScreenFits(page);
    await page.screenshot({ path: testInfo.outputPath("hub-six-joueurs-rn.png") });
    await page.setViewportSize({ width: 320, height: 568 });
    await expectScreenFits(page);
    await expect(page.getByRole("button", { name: "Quitter le Hub" })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("hub-six-joueurs-rn-320.png") });
    await page.setViewportSize({ width: 360, height: 640 });
    await game(page).click();
    await expect(page.getByRole("region", { name: "Mémorisation" })).toBeVisible();
    await expect(page.locator(".position-bottom .player-avatar")).toHaveCount(0);
    await expect(page.locator(".position-top .player-avatar-mini")).toHaveCount(1);
    await expect(page.locator(".position-top [data-avatar-mark='robot']")).toBeVisible();
    await expect(page.locator(".player-credentials .table-rn")).toHaveCount(5);
    for (const [width, height] of [[320, 568], [740, 360]]) {
      await page.setViewportSize({ width, height });
      await expectScreenFits(page);
      for (const seat of await page.locator(".table-player").all()) await expect(seat).toBeInViewport({ ratio: 1 });
      const table = page.locator(".game-table");
      const feltBottom = await table.evaluate((element) =>
        element.getBoundingClientRect().bottom - parseFloat(getComputedStyle(element).borderBottomWidth) - 3);
      const hand = (await page.locator(".position-bottom .player-cards").boundingBox())!;
      expect(hand.y + hand.height).toBeLessThanOrEqual(feltBottom);
      await page.screenshot({ path: testInfo.outputPath(`table-six-badges-${width}.png`) });
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.getByRole("region", { name: "Tour de jeu" })).toBeVisible({ timeout: 20_000 });
    const compactHand = page.locator(".position-bottom .player-cards");
    const insideFelt = await compactHand.evaluate((hand) => {
      const table = hand.closest(".game-table")!;
      const bottom = table.getBoundingClientRect().bottom - parseFloat(getComputedStyle(table).borderBottomWidth) - 3;
      return hand.getBoundingClientRect().bottom <= bottom;
    });
    expect(insideFelt).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("table-six-en-jeu-320.png") });
    await page.setViewportSize({ width: 360, height: 640 });
    await (await openSettings(page)).getByRole("button", { name: "Quitter la table", exact: true }).click();
    await expect(ready(page)).toBeVisible();
    await expect(page.getByRole("group", { name: "Totaux" })).toContainText("1 partie");
    await page.reload();
    await expect(page.getByRole("group", { name: "Totaux" })).toContainText("1 partie");
    await expect(page.getByText("Partie interrompue", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Cible dans le dos" })).toBeVisible();
    await expect(page.getByText("Meilleur échange", { exact: true })).toHaveCount(0);
    await page.route(/\/api\/matches\/[^/?]+\?table=1$/, async (route) => {
      const response = await route.fetch();
      const match: SavedMatch = await response.json();
      const [first, second] = match.players;
      await route.fulfill({ response, json: { ...match, awards: {
        ...match.awards,
        cible: [first, second].map(({ id }) => ({ players: [id], value: 3, extra: 2 })),
        roisNoirs: [first, second].map(({ id }) => ({ players: [id], value: 2 })),
        rivalite: [{ players: [first.id, second.id], value: 2 }],
        pire: [{ players: [first.id], value: 12, exchange: { opponentId: second.id, given: "spades-K", received: "hearts-Q" } }],
      } } });
    });
    await page.reload();
    const rois = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Mr. Roinoir" }) });
    await expect(rois.locator("p")).toHaveText(/.+ & .+ avec 2 rois noirs\./);
    const targets = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Cible dans le dos" }) });
    await expect(targets.locator("p")).toHaveText(/.+ & .+ ont chacun subi 3 actions de 2 adversaires\./);
    const interactions = page.getByRole("region", { name: "Interactions et rivalités" });
    await expect(interactions.locator(".archive-card")).toHaveCount(4);
    const interactionColumns = await interactions.locator(".archive-card").evaluateAll((cards) =>
      new Set(cards.map((card) => card.getBoundingClientRect().x)).size);
    expect(interactionColumns).toBe(1);
    await expect(interactions).toContainText(/a donné une dame à .+ contre un roi noir\./);
    await expect(interactions).not.toContainText("entre leurs mains");
    await page.screenshot({ path: testInfo.outputPath("bilan-invite.png"), fullPage: true });
    await page.getByRole("button", { name: "Revenir à l’accueil", exact: true }).click();
    await expect(pseudo(page)).toBeVisible();
  } finally { await guest.close(); }
});

async function signIn(page: Page, handle: string, register = false) {
  await page.goto("/compte");
  if (register) await page.getByRole("button", { name: "Créer un compte", exact: true }).click();
  await page.getByLabel("Identifiant", { exact: true }).fill(handle);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: register ? "Créer mon compte" : "Se connecter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Créer un Hub", exact: true })).toBeVisible();
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
    await (await openSettings(host)).getByRole("button", { name: "Mon compte", exact: true }).click();
    const profileIcon = host.getByRole("region", { name: "Icône du profil" });
    const renderedIcon = profileIcon.locator(".player-avatar");
    const icon = () => renderedIcon.evaluate((element) => {
      const style = getComputedStyle(element);
      return [element.querySelector("svg")?.getAttribute("data-avatar-mark"), style.backgroundColor, style.color];
    });
    const initial = await icon();
    expect(initial[1]).not.toEqual(initial[2]);
    await expect(renderedIcon.locator(".avatar-symbol path")).toHaveAttribute("stroke", "#000");
    await expect(profileIcon.getByRole("combobox")).toHaveCount(0);
    await profileIcon.getByRole("button", { name: "Générer une icône" }).click();
    await expect(host.getByRole("status")).toHaveText("Icône enregistrée.");
    const generated = await icon();
    expect(generated).not.toEqual(initial);
    await host.reload();
    await expect(renderedIcon).toBeVisible();
    expect(await icon()).toEqual(generated);
    await host.screenshot({ path: testInfo.outputPath("icone-compte.png") });
    const picture = await host.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 240;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#256777";
      context.fillRect(0, 0, 400, 240);
      context.fillStyle = "#f5d783";
      context.fillRect(143, 66, 114, 108);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await host.getByLabel("Photo de profil").setInputFiles({
      name: "avatar-de-test.png", mimeType: "image/png", buffer: Buffer.from(picture, "base64"),
    });
    await host.getByRole("button", { name: "Enregistrer la photo" }).click();
    await expect(host.getByRole("status")).toHaveText("Photo enregistrée.");
    await host.reload();
    const photo = host.locator(".account-photo-form .player-avatar img");
    await expect(photo).toHaveJSProperty("naturalWidth", 128);
    await expect(photo).toHaveJSProperty("naturalHeight", 128);
    const alpha = await photo.evaluate(async (image: HTMLImageElement) => {
      const bitmap = await createImageBitmap(await (await fetch(image.src)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      return [context.getImageData(0, 0, 1, 1).data[3], context.getImageData(64, 64, 1, 1).data[3]];
    });
    expect(alpha).toEqual([0, 255]);
    await host.screenshot({ path: testInfo.outputPath("photo-circulaire.png"), fullPage: true });
    await host.getByRole("link", { name: "Accueil", exact: true }).click();
    await expect(host.locator(".home-identity .player-avatar-mini img")).toHaveJSProperty("naturalWidth", 128);
    await host.screenshot({ path: testInfo.outputPath("avatar-accueil.png") });
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    await expect(guest.locator(".hub-item").filter({ hasText: "Hub de AliceCompte" })
      .locator(".hub-name .player-avatar-mini img")).toHaveJSProperty("naturalWidth", 128);
    await join(guest, "AliceCompte");
    const roster = guest.getByRole("list", { name: "Joueurs présents" });
    const playerTile = (name: string) => roster.getByRole("listitem").filter({ hasText: name });
    await expect(playerTile("AliceCompte").locator(".lobby-player-avatar img")).toHaveJSProperty("naturalWidth", 128);
    await expect(playerTile("BobbyCompte").locator(".lobby-player-avatar .avatar-symbol")).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("avatars-hub-portrait.png") });
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
    await expect(guest.locator(".position-top .player-name-text")).toHaveText("AliceCompt");
    await expect(guest.locator(".position-top .player-avatar-mini img")).toHaveJSProperty("naturalWidth", 128);
    const badge = (await guest.locator(".position-top .player-credentials").boundingBox())!;
    const name = (await guest.locator(".position-top .player-name-label").boundingBox())!;
    expect(badge.y + badge.height).toBeLessThanOrEqual(name.y);
    await expect(guest.locator(".position-top .table-rn")).toHaveText("50");
    await expectLocalTurn(guest, 20_000);
    const opponent = host.locator(".position-top");
    await expect(opponent.locator(".player-credentials .table-rn")).toHaveText("50");
    await guest.evaluate(() => window.dispatchEvent(new Event("offline")));
    await guest.context().setOffline(true);
    await expect(opponent.getByRole("img", { name: "Déconnecté" })).toBeVisible();
    await expect(opponent.locator(".player-credentials")).toHaveCount(0);
    await host.setViewportSize({ width: 390, height: 844 });
    await host.screenshot({ path: testInfo.outputPath("joueur-deconnecte-portrait.png") });
    await guest.context().setOffline(false);
    await guest.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(opponent.getByRole("img", { name: "Déconnecté" })).toHaveCount(0);
    await expect(opponent.locator(".player-credentials .table-rn")).toHaveText("50");
    await expectLocalTurn(guest, 20_000);
    await guest.screenshot({ path: testInfo.outputPath("icones-en-jeu.png") });
    await drawDeck(guest).click();
    await guest.getByRole("button", { name: "Annoncer Dutch en fin de tour" }).click();
    await discardDrawn(guest);
    await expectLocalTurn(host);
    await drawDeck(host).click();
    await discardDrawn(host);
    for (const tab of [host, guest]) {
      await expect(tab.getByRole("heading", { name: "Fin de la partie" })).toBeVisible({ timeout: 15_000 });
      await expect(tab.getByRole("table", { name: "Classement cumulé" })).not.toContainText("→");
      await expect(ready(tab)).toHaveCount(0);
    }
    await expect(guest.getByRole("button", { name: "Interrompre la partie" })).toHaveCount(0);
    await expect(host.getByRole("button", { name: "Lancer une nouvelle partie" })).toBeEnabled();
    await expect(host.getByRole("button", { name: "Interrompre la partie" })).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath("01-fin-de-partie.png"), fullPage: true });
    await host.getByRole("button", { name: "Lancer une nouvelle partie" }).click();
    await expect(guest.getByRole("region", { name: "Mémorisation" })).toBeVisible();
    const management = await openManagement(host);
    await management.getByRole("button", { name: "Interrompre la partie" }).click();
    await host.getByRole("button", { name: "Confirmer l’interruption" }).click();
    await Promise.all([host, guest].map((tab) => expect(ready(tab)).toBeVisible()));
    for (const tab of [host, guest]) {
      const totals = tab.getByRole("group", { name: "Totaux" });
      await expect(totals.getByText("2 manches", { exact: true })).toBeVisible();
      await expect(totals.getByText("2 parties", { exact: true })).toBeVisible();
      await expect(tab.getByRole("heading", { name: "Bilan cumulé de la table" })).toHaveCount(0);
      await expect(tab.getByRole("heading", { name: "Classement officiel" })).toBeVisible();
      const rating = tab.getByRole("region", { name: "Variations de l’indice RN" });
      await expect(rating.getByRole("article")).toHaveCount(2);
      await expect(rating.getByRole("heading")).toHaveText(["Gain de RN", "Perte de RN"]);
      await expect(rating.getByRole("article").first()).toContainText("AliceCompte");
      await expect(rating.getByRole("article").first()).toContainText("+2 RN");
      await expect(rating.getByRole("article").last()).toContainText("BobbyCompte");
      await expect(rating.getByRole("article").last()).toContainText(/[-−]2 RN/);
      const [gain, loss] = await Promise.all([rating.getByRole("article").first().boundingBox(), rating.getByRole("article").last().boundingBox()]);
      expect(gain!.y).toBeCloseTo(loss!.y);
      await expect(tab.getByRole("region", { name: "Interactions et rivalités" })).toContainText("a fait échouer 1 Dutch.");
    }
    expect(await host.locator(".archive-screen").innerText()).toEqual(await guest.locator(".archive-screen").innerText());
    await guest.screenshot({ path: testInfo.outputPath("02-bilan-cumule-portrait.png"), fullPage: true });

    await otherDevice.goto("/compte");
    await otherDevice.getByLabel("Pseudo", { exact: true }).fill("BobbyMobile");
    await otherDevice.getByRole("button", { name: "Enregistrer le pseudo" }).click();
    await expect(otherDevice.getByRole("status")).toHaveText("Pseudo enregistré.");
    const link = otherDevice.getByRole("link", { name: "Mon profil public" });
    const profileUrl = (await link.getAttribute("href"))!;
    await link.click();
    await expect(otherDevice.getByRole("heading", { name: "BobbyMobile" })).toBeVisible();
    await expect(otherDevice.getByRole("region", { name: "Parties", exact: true }).getByRole("heading")).toHaveText("Parties 2");
    await expect(otherDevice.getByRole("region", { name: "Manches", exact: true }).getByRole("heading")).toHaveText("Manches 1");
    await expect(otherDevice.getByRole("region", { name: "Dutch", exact: true })).toContainText("Réussite");
    await expect(otherDevice.locator(".profile-headline")).toContainText("Indice RN48");
    await expect(otherDevice.locator(".profile-headline")).toContainText("0 %");
    await expect(otherDevice.getByText("Interrompues", { exact: true })).toHaveCount(0);
    await expect(otherDevice.getByText("Terminées", { exact: true })).toHaveCount(0);
    await expect(otherDevice.getByRole("img", { name: "Évolution du RN sur les dernières manches classées" })
      .locator("circle")).toHaveCount(1);
    await otherDevice.screenshot({ path: testInfo.outputPath("03-profil-apres-renommage.png"), fullPage: true });
    await host.goto(profileUrl);
    await host.getByRole("button", { name: "Signaler cet historique" }).click();
    await expect(host.getByRole("status")).toHaveText("Signalement transmis pour vérification.");
    await otherDevice.goto("/");
    await otherDevice.getByRole("button", { name: "Classement", exact: true }).click();
    const bobbyRow = otherDevice.getByRole("row").filter({ has: otherDevice.getByRole("link", { name: "BobbyMobile" }) });
    await expect(bobbyRow.getByRole("cell")).toHaveText(["1", "0 %", "48", "-2"]);
    await otherDevice.screenshot({ path: testInfo.outputPath("classement-rn-sept-jours.png") });
    await otherDevice.getByRole("link", { name: "Accueil", exact: true }).click();
    await otherDevice.getByRole("button", { name: "Mes stats" }).click();
    await expect(otherDevice.getByRole("heading", { name: "Mes stats" })).toBeVisible();
    await otherDevice.getByRole("link", { name: "Mes parties" }).click();
    await otherDevice.getByRole("listitem").filter({ hasText: "Terminée" }).getByRole("link").click();
    await expect(ready(otherDevice)).toBeVisible();
    await expect(otherDevice.getByRole("heading", { name: "Classement officiel" })).toBeVisible();
    await expect(otherDevice.getByRole("region", { name: "Variations de l’indice RN" })).toContainText("+2 RN");
    const url = otherDevice.url();

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
      await expect(page.getByText("1 manche", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Classement officiel" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Activité de la manche 1 interrompue" })).toContainText("1 réaction valide · 1 pénalité");
      await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Le défausseur" }) })).toContainText("BobbyPartie");
      await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Le boulet" }) }))
        .toContainText(/AlicePartie avec 1 erreur pour \d+ points?\./);
      await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Le distributeur" }) })).toContainText("Non attribuée");
    }
    await guest.screenshot({ path: testInfo.outputPath("01-interruption-portrait.png"), fullPage: true });
    await guest.setViewportSize({ width: 740, height: 360 });
    await guest.screenshot({ path: testInfo.outputPath("02-interruption-paysage.png"), fullPage: true });
  } finally { await guest.close(); }
});

test("le bilan affiche les interactions en phrases avec leurs icônes", async ({ page }, testInfo) => {
  await signIn(page, "LecteurBilan", true);
  await page.setViewportSize({ width: 360, height: 640 });
  const awards = {
    boulet: [{ players: ["alice"], value: 3, extra: 18 }],
    rivalite: [{ players: ["alice", "bob"], value: 5 }],
    pire: [{ players: ["bob"], value: 13, exchange: { opponentId: "alice", given: "spades-A", received: "joker-1" } }],
    bourreau: [{ players: ["alice"], value: 1 }, { players: ["bob"], value: 1 }],
    voleur: [{ players: ["alice"], value: 1 }],
  };
  const report: SavedMatch = {
    id: "00000000-0000-4000-8000-000000000001:1", startedAt: 0, endedAt: 60_000,
    status: "interrupted", partial: false, rounds: 1, awards,
    ratingMovements: [{ accountId: "alice", name: "Alice", delta: -2 }],
    players: ["Alice", "Bob"].map((name) => ({
      id: name.toLowerCase(), name, rounds: 1, wins: 0, scoreSum: 0, bestScore: 0,
      dutch: 0, dutchWon: 0, reactions: 0, penalties: 0, exchanges: 0,
    })),
  };
  await page.route("**/api/matches/*", (route) => route.fulfill({ json: report }));
  await page.goto(`/parties/${encodeURIComponent(report.id)}`);
  await expect(page.getByText("Alice avec 3 erreurs pour 18 points.")).toBeVisible();
  const rn = page.getByRole("region", { name: "Variations de l’indice RN" });
  await expect(rn.getByText("Aucun gain net", { exact: true })).toBeVisible();
  await expect(rn.getByText("-2 RN", { exact: true })).toBeVisible();
  const interactions = page.getByRole("region", { name: "Interactions et rivalités" });
  await expect(interactions.getByText("Alice et Bob ont échangé 5 fois.", { exact: true })).toBeVisible();
  await expect(interactions.getByText("Alice a donné un joker à Bob contre un as.", { exact: true })).toBeVisible();
  await expect(interactions.getByText("Alice & Bob ont fait échouer 1 Dutch.", { exact: true })).toBeVisible();
  await expect(interactions.getByText("Voleur de victoires")).toHaveCount(0);
  await expect(interactions.locator("dt > svg")).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath("bilan-interactions-portrait.png"), fullPage: true });
});

test("la disparition du dernier humain ferme la table des bots avec un bilan partiel", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(40_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    await signIn(host, "AlicePause", true);
    await guest.goto("/");
    await host.getByRole("button", { name: "Créer un Hub" }).click();
    await host.getByRole("button", { name: "Ajouter un bot" }).click();
    await expect(game(host)).toBeEnabled({ timeout: 12_000 });
    await game(host).click();
    await expect(host.getByRole("region", { name: "Mémorisation" })).toBeVisible();
    await expect(guest.getByText("Hub de AlicePause", { exact: true })).toBeVisible();
    await host.evaluate(() => window.dispatchEvent(new Event("offline")));
    await host.context().setOffline(true);
    await expect(guest.getByText("Hub de AlicePause", { exact: true })).toHaveCount(0);
    await host.context().setOffline(false);
    await host.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(ready(host)).toBeVisible();
    await expect(host.getByText(/Bilan partiel établi/)).toBeVisible();
    await expect(host.getByRole("group", { name: "Totaux" })).toContainText("1 partie");
    await expect(host.getByRole("heading", { name: "Classement officiel" })).toHaveCount(0);
    await host.screenshot({ path: testInfo.outputPath("01-bilan-partiel-apres-deconnexion.png"), fullPage: true });
  } finally { await guest.close(); }
});
