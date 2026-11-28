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
  await expect(coach(page)).toContainText("Défausser le 10 pendant ton tour active son pouvoir.");
  await page.getByRole("button", { name: "Choisir la carte 1 de Toi" }).click();
  await recipient(page).getByRole("button", { name: "Choisir la carte 1 de Nora" }).click();
  await expect(coach(page)).toContainText("Valet · Confirmer l’échange");
  await page.getByRole("button", { name: "Choisir la carte 1 de Toi" }).click();
  await recipient(page).getByRole("button", { name: "Choisir la carte 1 de Nora" }).click();
  const swap = page.getByRole("button", { name: "Échanger les cartes" });
  await expect(swap).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("valet-tutoriel-mobile.png") });
  await swap.click();
  await expect(coach(page)).toContainText("Valet · Annuler l’échange");
  await page.getByRole("button", { name: "Choisir la carte 1 de Toi" }).click();
  await recipient(page).getByRole("button", { name: "Choisir la carte 1 de Nora" }).click();
  await page.getByRole("button", { name: "Annuler l’échange", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Exercices terminés" })).toBeVisible();

  await page.getByRole("button", { name: "Choisir un exercice" }).click();
  await page.getByRole("button", { name: /Joker\+/ }).click();
  await drag(page, page.getByRole("button", { name: "Carte de la pioche à donner" }).locator(".deck-slot"),
    recipient(page).locator(".player-cards"));
  await expect(recipient(page).locator(".playing-card")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Exercices terminés" })).toBeVisible();
  const recap = page.getByRole("region", { name: "Récapitulatif des exercices" });
  await expect(recap).toContainText("Nora reçoit une carte face cachée");
  await expect(recap).toBeVisible();
  await page.clock.install();
  await page.getByRole("button", { name: "Jouer une partie libre" }).click();
  await expect(page.getByRole("region", { name: "Mémorisation" })).toBeVisible();
  await expect(page.locator(".table-player")).toHaveCount(3);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Emojis de la table" })).toHaveCount(0);
  await page.clock.fastForward(65_000);
  await expect(page.getByRole("region", { name: "Mémorisation" })).toBeVisible();
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
  await coach(page).getByRole("button", { name: "Relire les explications" }).click();
  const explanations = page.getByRole("dialog", { name: "Explications du didacticiel" });
  await page.clock.runFor(10_000);
  await expect(explanations).toContainText("Dutch est annoncé. Les autres joueurs ont chacun un dernier tour.");
  await explanations.getByRole("button", { name: "Reprendre l’exercice" }).click();
  await page.clock.runFor(2_900);
  await expect(coach(page)).toContainText("Repérer l’icône");
  await expectScreenFits(page);
  await drawDeck(page).click();
  await toss.click();
  await page.clock.runFor(900);
  await announce.click();
  await page.clock.runFor(3_450);
  await expect(coach(page)).toContainText("Tester Dutch en fin de manche");

  await drawDeck(page).click();
  await toss.click();
  await page.clock.runFor(10_000);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(announce).toBeVisible();
  await announce.press("Enter");
  await page.clock.runFor(4_000);
  await page.clock.runFor(2_000);
  await page.clock.runFor(2_000);
  await expect(coach(page)).toContainText("Milo a posé un 3");
  await page.clock.runFor(10_000);
  await own(page, 3).press("r");
  await page.clock.runFor(3_200);
  const score = page.getByRole("region", { name: "Résultat de la manche d’entraînement" });
  await expect(score.getByRole("listitem")).toHaveText(["Toi 3 points", "Nora 26 points", "Milo 23 points"]);
  await page.screenshot({ path: testInfo.outputPath("dutch-score-didacticiel.png"), fullPage: true });
});

test("l’accueil mémorise la progression et la croix, tandis que les paramètres gardent l’accès", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const shortcut = page.getByRole("button", { name: /^Didacticiel/ });
  await expect(shortcut).toContainText("0/8");
  expect((await shortcut.boundingBox())!.y).toBeLessThan((await page.getByRole("button", { name: "Créer un Hub" }).boundingBox())!.y);
  await shortcut.click();
  await page.getByRole("button", { name: /^Mémorisation/ }).click();
  for (const position of [0, 1, 0, 1]) await own(page, position).click();
  await expect(page.getByRole("heading", { name: "Exercices terminés" })).toBeVisible();
  await expect(page.getByText("Tu connais maintenant deux cartes.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Choisir un exercice" }).click();
  await expect(page.getByRole("button", { name: /^Mémorisation/ }).getByRole("img", { name: "Chapitre terminé" })).toBeVisible();
  await page.getByRole("link", { name: "Accueil" }).click();
  await page.reload();
  await expect(shortcut).toContainText("1/8");
  await page.screenshot({ path: testInfo.outputPath("accueil-progression-didacticiel.png") });
  await page.getByRole("button", { name: "Masquer le didacticiel sur l’accueil" }).click();
  await page.reload();
  await expect(shortcut).toHaveCount(0);
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Apprendre à jouer" }).click();
  await expect(page.getByRole("heading", { name: "Apprendre à jouer" })).toBeVisible();

  await page.evaluate(() => {
    localStorage.removeItem("ficodutch-tutorial-hidden");
    localStorage.setItem("ficodutch-tutorial-progress", JSON.stringify(["memorisation", "poser", "reactions", "visions", "echanges", "joker", "variantes", "dutch"]));
  });
  await page.goto("/");
  await expect(shortcut).toHaveCount(0);
  await expect((await openSettings(page)).getByRole("button", { name: "Apprendre à jouer" })).toBeEnabled();
});
