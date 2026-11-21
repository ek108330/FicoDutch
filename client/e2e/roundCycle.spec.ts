import { expect, test, type Page } from "@playwright/test";
import { drawDeck, fixDeckOrder, openTwoPlayerHub, expectLocalTurn } from "./tableFlow";

const next = (page: Page) => page.getByRole("button", { name: "Lancer la manche suivante" });
const resultTitle = (page: Page) => page.getByRole("heading", { name: /^Fin de la (manche|partie)$/ });
const ranking = (page: Page) => page.getByRole("table", { name: "Classement cumulé" });
const sixCards = (page: Page) => page.getByRole("button", { name: "6 cartes", exact: true });

async function swipeLeftOnResults(page: Page) {
  const session = await page.context().newCDPSession(page);
  const box = (await resultTitle(page).boundingBox())!;
  const y = Math.round(box.y + box.height / 2);
  const right = Math.round(box.x + box.width * 0.8);
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: right, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: right - 120, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function finishWithDutch(first: Page, last: Page) {
  await expectLocalTurn(first, 18_000);
  await drawDeck(first).click();
  const announce = first.getByRole("button", { name: "Annoncer Dutch en fin de tour" });
  await announce.click();
  await expect(announce).toHaveAttribute("aria-pressed", "true");
  await first.getByRole("button", { name: "Défausser la carte tirée" }).click();
  await expectLocalTurn(last);
  await drawDeck(last).click();
  await last.getByRole("button", { name: "Défausser la carte tirée" }).click();
}

test("deux manches jusqu’au seuil de fin de partie", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(75_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, hasTouch: true });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceManches", "BobManches");
    await host.getByRole("slider").press("Home");
    await expect(guest.getByRole("slider")).toHaveValue("0");
    await start.click();
    await finishWithDutch(guest, host);

    for (const page of [host, guest]) {
      await expect(page.getByRole("heading", { name: "Fin de la manche" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de AliceManches" }).getByText("27 points")).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de BobManches" }).getByText("46 points")).toBeVisible();
      await expect(next(page)).toHaveCount(0);
    }
    await guest.screenshot({ path: testInfo.outputPath("01-resultats-manche-1.png") });
    await resultTitle(host).click();
    await expect(ranking(host)).toBeVisible();
    await expect(guest.getByRole("region", { name: "Résultat de la manche" })).toBeVisible();
    await expect(ranking(guest)).toHaveCount(0);
    await guest.setViewportSize({ width: 390, height: 844 });
    await swipeLeftOnResults(guest);
    await expect(ranking(guest)).toBeVisible();
    await expect(next(host)).toBeEnabled();
    await expect(next(guest)).toHaveCount(0);
    await expect(sixCards(guest)).toBeDisabled();
    await sixCards(host).click();
    await expect(sixCards(guest)).toHaveAttribute("aria-pressed", "true");
    await expect(ranking(host)).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath("02-classement-et-variantes.png") });

    await next(host).click();
    await expect(guest.getByRole("region", { name: "Transition" }).getByRole("heading", { name: "Manche 2" }))
      .toBeVisible();
    await guest.setViewportSize({ width: 844, height: 390 });
    await guest.screenshot({ path: testInfo.outputPath("03-transition-paysage.png") });
    await guest.locator(".game-table.is-dealing").waitFor({ state: "visible", timeout: 7_000 });
    await guest.screenshot({ path: testInfo.outputPath("04-distribution.png") });

    for (const page of [host, guest]) {
      await expect(page.getByText("Manche 2 · Mémorisation")).toBeVisible();
      await expect(page.locator(".position-bottom .playing-card.face-down")).toHaveCount(6);
      await expect(page.locator(".position-top .playing-card.face-down")).toHaveCount(6);
    }
    await guest.getByRole("button", { name: "Carte 1 face cachée", exact: true }).click();
    await expect(guest.locator(".position-bottom .playing-card.face-up")).toHaveCount(1);
    await expect(host.locator(".position-top .playing-card.face-up")).toHaveCount(0);
    await finishWithDutch(host, guest);

    for (const page of [host, guest]) {
      await expect(page.getByRole("heading", { name: "Fin de la partie" })).toBeVisible();
      await expect(page.getByText("AliceManches remporte la partie.")).toBeVisible();
      await expect(page.getByText("Seuil de 50 points atteint.")).toBeVisible();
      await resultTitle(page).click();
      await expect(page.getByRole("group", { name: "Variantes de la partie" })).toHaveText(/6 cartes/);
      await expect(sixCards(page)).toHaveCount(0);
      await expect(ranking(page).getByRole("row", { name: /AliceManches/ })).toContainText("27 → 62");
      await expect(ranking(page).getByRole("row", { name: /BobManches/ })).toContainText("46 → 88");
      await expect(next(page)).toHaveCount(0);
    }
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.screenshot({ path: testInfo.outputPath("05-classement-final-portrait.png"), fullPage: true });
    await guest.getByRole("button", { name: "Quitter la table" }).click();
    await expect(guest.getByRole("textbox", { name: "Choisis ton pseudo" })).toBeVisible();
    await expect(host.getByRole("heading", { name: "Fin de la partie" })).toBeVisible();
  } finally {
    await guest.close();
  }
});
