import { expect, test, type Page } from "@playwright/test";
import { discardDrawn, drawDeck, expectScreenFits, fixDeckOrder, openLobby, openTwoPlayerHub, expectLocalTurn,
  expectClockFromTop } from "./tableFlow";

const next = (page: Page) => page.getByRole("button", { name: "Lancer la manche suivante" });
const resultTitle = (page: Page) => page.locator(".result-screen").getByRole("heading", { level: 1 });
const results = (page: Page) => page.getByRole("region", { name: "Détail de la manche" });
const hand = (page: Page, pseudo: string) => results(page).getByRole("region", { name: `Main de ${pseudo}` });
const ranking = (page: Page) => page.getByRole("table", { name: "Classement cumulé" });
const crowns = (page: Page) => page.getByRole("img", { name: "En tête du classement" });
const dealing = (page: Page) => page.getByRole("region", { name: "Distribution des cartes" });
const sixCards = (page: Page) => page.getByRole("button", { name: "6 cartes", exact: true });

async function finishWithDutch(first: Page, last: Page) {
  await expectLocalTurn(first, 20_000);
  await drawDeck(first).click();
  const announce = first.getByRole("button", { name: "Annoncer Dutch en fin de tour" });
  await announce.click();
  await expect(announce).toHaveAttribute("aria-pressed", "true");
  await discardDrawn(first);
  await expectLocalTurn(last);
  await drawDeck(last).click();
  await discardDrawn(last);
}

test("deux manches jusqu’au seuil puis nouvelle partie à zéro dans le même Hub", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(105_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    await guest.addInitScript(() => {
      const setFrequency = AudioParam.prototype.setValueAtTime;
      AudioParam.prototype.setValueAtTime = function (value, at) {
        if (value === 550) {
          const data = document.documentElement.dataset;
          data.dealSounds = String(Number(data.dealSounds ?? 0) + 1);
        }
        return setFrequency.call(this, value, at);
      };
    });
    const start = await openTwoPlayerHub(host, guest, "AliceManches", "BobManches");
    await host.getByRole("slider").press("Home");
    await expect(guest.getByRole("slider")).toHaveValue("0");
    await start.click();
    await Promise.all([host, guest].map((page) => expect(dealing(page)).toBeVisible()));
    await expect(guest.getByRole("heading", { name: "Manche 1" })).toHaveCount(0);
    await guest.waitForFunction(() => Array.from(document.querySelectorAll('[data-card-animation="deal"]')).some((card) => {
      const elapsed = Number(card.getAnimations()[0]?.currentTime) - Number(card.getAnimations()[0]?.effect?.getTiming().delay);
      return elapsed >= 70 && elapsed <= 230;
    }));
    await expect(guest.locator('.game-table.is-dealing .face-up, [data-card-animation="deal"] .card-face')).toHaveCount(0);
    await expect(crowns(guest)).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("00-distribution-premiere-manche.png") });
    await expect(guest.locator("html")).toHaveAttribute("data-deal-sounds", /^[78]$/);
    await finishWithDutch(guest, host);

    for (const page of [host, guest]) {
      await expect(resultTitle(page)).toHaveText("Manche 1");
      await expect(page.getByRole("progressbar", { name: "Temps avant la manche suivante" })).toBeVisible();
      await expectClockFromTop(page.getByRole("progressbar", { name: "Temps avant la manche suivante" }));
      await expect(page.getByRole("timer")).toHaveCount(0);
      await expect(hand(page, "AliceManches").locator(".result-points")).toHaveText("27");
      const alice = ranking(page).getByRole("row", { name: /AliceManches/ });
      await expect(alice.locator(".result-total")).toHaveText("27");
      await expect(alice.locator(".ranking-round-score")).toHaveText("+27");
      await expect(page.getByRole("group", { name: "Variantes de la prochaine manche" }).getByRole("button")).toHaveCount(4);
      await expect(hand(page, "AliceManches").locator(".result-cards .face-up")).toHaveCount(4);
      await expect(hand(page, "AliceManches")).toHaveCSS("background-color", "rgb(243, 222, 154)");
      await expect(page.getByRole("heading", { name: "AliceManches" })).toHaveCSS("color", "rgb(39, 50, 36)");
      await expect(hand(page, "BobManches")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(hand(page, "BobManches").locator(".result-points")).toHaveText("36 +10");
      await expect(ranking(page).locator(".rank-movement")).toHaveCount(0);
    }
    await guest.screenshot({ path: testInfo.outputPath("01-resultats-manche-1.png") });
    await expect(next(host)).toBeEnabled();
    await expect(next(host)).toHaveCSS("background-color", "rgb(243, 222, 154)");
    await expect(next(guest)).toHaveCount(0);
    const interruptRound = host.getByRole("button", { name: "Interrompre la partie", exact: true });
    await expect(guest.getByRole("button", { name: "Interrompre la partie", exact: true })).toHaveCount(0);
    await interruptRound.click();
    await host.getByRole("dialog", { name: "Interrompre la partie ?" }).getByRole("button", { name: "Annuler" }).click();
    await expect(next(host)).toBeEnabled();
    await expect(sixCards(guest)).toBeDisabled();
    await sixCards(host).click();
    await expect(sixCards(guest)).toHaveAttribute("aria-pressed", "true");
    await host.screenshot({ path: testInfo.outputPath("02-classement-et-variantes.png") });

    await host.evaluate(() => { Math.random = () => 0.02; });
    await guest.setViewportSize({ width: 844, height: 390 });
    await next(host).click();
    await expect(dealing(guest)).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("03-distribution-paysage.png") });

    for (const page of [host, guest]) {
      await expect(page.getByRole("region", { name: "Mémorisation" })).toHaveText("Mémorisation");
      await expect(crowns(page)).toHaveCount(1);
      await expect(page.locator(".table-player").filter({ has: page.getByText(/^AliceManches/) }).locator(".leader-crown")).toHaveCount(1);
      await expect(page.locator(".position-bottom .playing-card.face-down")).toHaveCount(6);
      await expect(page.locator(".position-top .playing-card.face-down")).toHaveCount(6);
    }
    await guest.screenshot({ path: testInfo.outputPath("04-couronne-manche-2.png") });
    await guest.getByRole("button", { name: "Carte 1 face cachée", exact: true }).click();
    await expect(guest.locator(".position-bottom .playing-card.face-up")).toHaveCount(1);
    await expect(host.locator(".position-top .playing-card.face-up")).toHaveCount(0);
    await finishWithDutch(host, guest);

    for (const page of [host, guest]) {
      await expect(page.getByRole("heading", { name: "Fin de la partie" })).toBeVisible();
      await expect(page.getByText("BobManches remporte la partie.")).toBeVisible();
      await expect(page.getByText("Seuil de 50 points atteint.")).toBeVisible();
      await expect(page.getByRole("group", { name: "Variantes de la prochaine partie" }).getByRole("button")).toHaveCount(4);
      await expect(sixCards(page)).toHaveAttribute("aria-pressed", "true");
      expect(await ranking(page).getByRole("columnheader").allTextContents()).toEqual(["Rang", "Joueur", "Dernière manche", "Total"]);
      const alice = ranking(page).getByRole("row", { name: /AliceManches/ });
      const bob = ranking(page).getByRole("row", { name: /BobManches/ });
      await expect(alice.locator(".result-total")).toHaveText("79");
      await expect(alice.locator(".ranking-round-score")).toHaveText("+52");
      await expect(alice.getByRole("img", { name: "Perd 1 place" })).toHaveCSS("color", "rgb(255, 157, 150)");
      await expect(bob.locator(".result-total")).toHaveText("71");
      await expect(bob.locator(".ranking-round-score")).toHaveText("+25");
      await expect(bob.getByRole("img", { name: "Gagne 1 place" })).toHaveCSS("color", "rgb(154, 230, 173)");
      await expect(hand(page, "BobManches").locator(".result-cards .face-up")).toHaveCount(6);
      await expect(ranking(page).locator("tbody tr").first()).toContainText("BobManches");
      await expect(next(page)).toHaveCount(0);
    }
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.screenshot({ path: testInfo.outputPath("05-classement-final-portrait.png"), fullPage: true });
    const startOver = host.getByRole("button", { name: "Lancer une nouvelle partie" });
    const interrupt = host.getByRole("button", { name: "Interrompre la partie", exact: true });
    await expect(guest.getByRole("button", { name: "Lancer une nouvelle partie" })).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Interrompre la partie", exact: true })).toHaveCount(0);
    await expect(startOver).toBeEnabled();
    await expect(startOver).toHaveCSS("background-color", "rgb(29, 78, 216)");
    const infinite = (page: Page) => page.getByRole("button", { name: "Pose infinie", exact: true });
    await expect(infinite(guest)).toBeDisabled();
    await expect(infinite(host)).toHaveAttribute("aria-pressed", "false");
    await infinite(host).click();
    await expect(infinite(guest)).toHaveAttribute("aria-pressed", "true");
    await host.setViewportSize({ width: 320, height: 568 });
    await expectScreenFits(host);
    const interruptBox = (await interrupt.boundingBox())!;
    expect(interruptBox.y + interruptBox.height).toBeLessThan((await startOver.boundingBox())!.y);
    await host.screenshot({ path: testInfo.outputPath("06-relancer-partie-portrait.png") });
    await interrupt.click();
    const confirmation = host.getByRole("dialog", { name: "Interrompre la partie ?" });
    await confirmation.getByRole("button", { name: "Annuler" }).click();
    await expect(startOver).toBeEnabled();
    await host.evaluate(() => { Math.random = () => 0.999; });
    await startOver.click();

    await Promise.all([host, guest].map((page) => expect(dealing(page)).toBeVisible()));
    for (const page of [host, guest]) {
      await expect(page.getByRole("region", { name: "Mémorisation" })).toBeVisible({ timeout: 9_000 });
      await expect(crowns(page)).toHaveCount(0);
      await expect(page.locator(".position-bottom .playing-card.face-down")).toHaveCount(6);
      await expect(page.locator(".position-top .playing-card.face-up")).toHaveCount(0);
    }
    await guest.screenshot({ path: testInfo.outputPath("07-nouvelle-partie-memorisation.png") });
    await finishWithDutch(guest, host);
    for (const page of [host, guest]) {
      const scores = ranking(page).locator("tbody tr");
      await expect(scores).toHaveCount(2);
      for (const row of await scores.all()) {
        const total = await row.locator(".result-total").innerText();
        await expect(row.locator(".ranking-round-score")).toHaveText(`+${total}`);
      }
      await expect(infinite(page)).toHaveAttribute("aria-pressed", "true");
    }
    await host.screenshot({ path: testInfo.outputPath("08-scores-reinitialises.png") });
    await interrupt.click();
    await confirmation.getByRole("button", { name: "Confirmer l’interruption" }).click();
    for (const page of [host, guest]) {
      await expect(page.getByText("L’hôte a interrompu la partie.", { exact: true })).toBeVisible();
    }
  } finally {
    await guest.close();
  }
});

test("la table couronne les deux joueurs à égalité au début de la manche suivante", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(50_000);
  await host.addInitScript(() => { Math.random = () => 0.808; });
  const guest = await browser.newPage({ baseURL });
  const last = await browser.newPage({ baseURL, viewport: { width: 393, height: 702 } });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceCouronne", "BobCouronne");
    await openLobby(last, "ChloeCouronne");
    await last.locator(".hub-item").filter({ hasText: "Hub de AliceCouronne" })
      .getByRole("button", { name: "Rejoindre", exact: true }).click();
    await expect(host.getByRole("list", { name: "Joueurs présents" }).getByRole("listitem")).toHaveCount(3);
    await start.click();
    await finishWithDutch(last, host);
    await expectLocalTurn(guest);
    await drawDeck(guest).click();
    await discardDrawn(guest);
    await expect(ranking(last).getByRole("cell", { name: "22", exact: true })).toHaveCount(2);
    await next(host).click();
    for (const page of [host, guest, last]) {
      await expect(crowns(page)).toHaveCount(2);
      await expect(page.locator(".player-name-text").getByRole("img", { name: "En tête du classement" })).toHaveCount(2);
      await expect(page.locator(".table-player").filter({ hasText: "ChloeCouronne" }).locator(".leader-crown")).toHaveCount(0);
    }
    await expect(last.getByRole("region", { name: "Mémorisation" })).toBeVisible();
    await last.screenshot({ path: testInfo.outputPath("couronnes-egalite-portrait.png") });
  } finally {
    await Promise.all([guest.close(), last.close()]);
  }
});
