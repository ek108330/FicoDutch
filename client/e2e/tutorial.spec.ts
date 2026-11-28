import { expect, test, type Locator, type Page } from "@playwright/test";
import { drawDeck, drawnCard, expectScreenFits, openSettings } from "./tableFlow";

const coach = (page: Page) => page.getByRole("region", { name: "Consigne du didacticiel" });
const own = (page: Page, position: number) => page.locator(`.position-bottom [data-card-position="${position}"]`);
const recipient = (page: Page) => page.locator('[data-hand-player="nora"]');

async function drag(page: Page, source: Locator, target: Locator) {
  await expect(source).toBeVisible();
  await source.evaluate(async (element) => {
    const finite = element.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
  });
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("ouvrir le parcours depuis les paramètres et avancer automatiquement après les quatre gestes de pose", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Apprendre à jouer" }).click();
  const menu = page.getByRole("heading", { name: "Apprendre à jouer", exact: true });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("choix-des-exercices-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Parcours complet" }).click();
  await expect(coach(page)).toContainText("Découvrir ta main");
  await coach(page).getByRole("button", { name: "Indice" }).click();
  await expect(own(page, 0)).toHaveAttribute("data-tutorial-target", "true");
  await own(page, 0).click();
  await own(page, 1).click();
  await expect(coach(page)).toContainText("retourner");
  await own(page, 0).click();
  await own(page, 1).click();
  await expect(coach(page)).toContainText("Remplacer en glissant");
  await expectScreenFits(page);
  await drawDeck(page).click();
  await coach(page).getByRole("button", { name: "Indice" }).click();
  await drawnCard(page).evaluate(async (element) => {
    const animations = element.getAnimations({ subtree: true }).filter(({ effect }) => effect?.getTiming().iterations !== Infinity);
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
  });
  await page.screenshot({ path: testInfo.outputPath("exercice-glisser-320.png") });
  await own(page, 0).click();
  await expect(coach(page)).toContainText("Essaie le geste");
  await expect(drawnCard(page)).toBeVisible();
  await drag(page, drawnCard(page), own(page, 0));

  await expect(coach(page)).toContainText("Remplacer en touchant");
  await drawDeck(page).click();
  await own(page, 0).click();
  await expect(coach(page)).toContainText("Défausser en glissant");
  await drawDeck(page).click();
  await drag(page, drawnCard(page), page.locator(".discard-slot"));
  await expect(coach(page)).toContainText("Défausser en touchant");
  await drawDeck(page).click();
  await page.getByRole("button", { name: /^Défausse/ }).click();
  await expect(coach(page)).toContainText("Trois appuis rapides");
  await expect(page.getByRole("img", { name: "Défausse, 6 de pique" })).toBeVisible();
  await own(page, 0).click({ clickCount: 3 });
  await expect(coach(page)).toContainText("Glisser vers le centre");
  await expect(page.getByRole("img", { name: "Défausse, 6 de pique" })).toBeVisible();
  await drag(page, own(page, 0), page.locator(".discard-slot"));
  await expect(coach(page)).toContainText("Reconnaître une erreur");
  await expect(page.getByRole("img", { name: "Défausse, 6 de pique" })).toBeVisible();
  await own(page, 0).press("r");
  await expect(coach(page)).toContainText("une carte de pénalité s’ajoute");
  await expect(coach(page)).toContainText("8 · Regarder chez soi");
});

test("choisir le Valet, le Joker+ et la partie libre directement depuis le menu", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/didacticiel");
  await page.getByRole("button", { name: /10 et Valet/ }).click();
  await drawDeck(page).click();
  await page.getByRole("button", { name: /^Défausse/ }).click();
  await own(page, 0).click();
  await recipient(page).getByRole("button", { name: "Choisir la carte 1 de Nora" }).click();
  await expect(coach(page)).toContainText("Valet · Confirmer l’échange");
  await drawDeck(page).click();
  await page.getByRole("button", { name: /^Défausse/ }).click();
  await own(page, 0).click();
  await recipient(page).getByRole("button", { name: "Choisir la carte 1 de Nora" }).click();
  const swap = page.getByRole("button", { name: "Échanger les cartes" });
  await expect(swap).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("valet-tutoriel-mobile.png") });
  await swap.click();
  await expect(coach(page)).toContainText("Valet · Annuler l’échange");
  await drawDeck(page).click();
  await page.getByRole("button", { name: /^Défausse/ }).click();
  await own(page, 0).click();
  await recipient(page).getByRole("button", { name: "Choisir la carte 1 de Nora" }).click();
  await page.getByRole("button", { name: "Annuler l’échange", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Exercices terminés" })).toBeVisible();

  await page.getByRole("button", { name: "Choisir un exercice" }).click();
  await page.getByRole("button", { name: /Joker\+/ }).click();
  await drawDeck(page).click();
  await page.getByRole("button", { name: /^Défausse/ }).click();
  await drag(page, page.getByRole("button", { name: "Carte de la pioche à donner" }).locator(".deck-slot"),
    recipient(page).locator(".player-cards"));
  await expect(recipient(page).locator(".playing-card")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Exercices terminés" })).toBeVisible();
  await page.getByRole("button", { name: "Jouer une partie libre" }).click();
  await expect(page.getByRole("region", { name: "Mémorisation" })).toBeVisible();
  await expect(page.locator(".table-player")).toHaveCount(3);
  await page.getByRole("button", { name: "Quitter l’entraînement" }).click();
  await expect(page.getByRole("heading", { name: "Apprendre à jouer" })).toBeVisible();
});

test("Dutch guidé laisse répéter le geste et calcule le score après les derniers tours des bots", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await page.clock.install();
  await page.goto("/didacticiel/dutch");
  const announce = page.getByRole("button", { name: "Annoncer Dutch en fin de tour" });
  const toss = page.getByRole("button", { name: /^Défausse/ });
  await drawDeck(page).click();
  await announce.click();
  await toss.click();
  await page.clock.runFor(2_900);
  await expect(coach(page)).toContainText("Repérer l’icône");
  await expectScreenFits(page);
  await drawDeck(page).click();
  await toss.click();
  await page.clock.runFor(900);
  await announce.click();
  await page.clock.runFor(3_450);
  await expect(coach(page)).toContainText("Défi Dutch");

  await drawDeck(page).click();
  await toss.click();
  await page.clock.runFor(550);
  await expect(coach(page)).toContainText("Le délai est passé");
  await drawDeck(page).click();
  await toss.click();
  await announce.press("Enter");
  await page.clock.runFor(4_000);
  await page.clock.runFor(2_000);
  await page.clock.runFor(2_000);
  await page.clock.runFor(4_000);
  const score = page.getByRole("region", { name: "Résultat de la manche d’entraînement" });
  await expect(score.getByRole("listitem")).toHaveText(["Toi 6 points", "Nora 26 points", "Milo 23 points"]);
  await page.screenshot({ path: testInfo.outputPath("dutch-score-didacticiel.png"), fullPage: true });
});
