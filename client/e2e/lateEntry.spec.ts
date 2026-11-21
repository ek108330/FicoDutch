import { expect, test, type Page } from "@playwright/test";
import { drawDeck, fixDeckOrder, openLobby, openTwoPlayerHub, expectLocalTurn } from "./tableFlow";

const hub = (page: Page) => page.locator(".hub-item").filter({ hasText: "Hub de AliceEntree" });
const join = (page: Page) => hub(page).getByRole("button", { name: "Rejoindre", exact: true });
const waiting = (page: Page) => page.getByRole("heading", { name: "En attente de la prochaine manche" });
const showRanking = (page: Page) => page.locator(".result-screen").getByRole("heading", { level: 1 });

async function playTurn(page: Page, announceDutch = false) {
  await expectLocalTurn(page, 18_000);
  await drawDeck(page).click();
  if (announceDutch) {
    const announce = page.getByRole("button", { name: "Annoncer Dutch en fin de tour" });
    await announce.click();
    await expect(announce).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Défausser la carte tirée" }).click();
}

test("un nouvel invité attend, rejoint la manche suivante et hérite du plus haut total", async ({
  page: host, browser, baseURL,
}, testInfo) => {
  test.setTimeout(85_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  const newcomer = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 } });
  const late = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceEntree", "BobEntree");
    await Promise.all([openLobby(newcomer, "ChloeEntree"), openLobby(late, "DanaEntree")]);
    await host.getByRole("slider").press("Home");
    await start.click();
    await expectLocalTurn(guest, 18_000);

    await expect(hub(newcomer).getByText("En cours", { exact: true })).toBeVisible();
    await join(newcomer).click();
    await expect(waiting(newcomer)).toBeVisible();
    await expect(newcomer.getByText("Tu entreras en jeu après la manche 1.")).toBeVisible();
    await expect(newcomer.locator(".game-table")).toHaveCount(0);
    await newcomer.reload();
    await expect(waiting(newcomer)).toBeVisible();
    await newcomer.screenshot({ path: testInfo.outputPath("01-attente-nouvel-invite-portrait.png") });
    await expect(host.locator(".game-table").getByText("ChloeEntree", { exact: true })).toHaveCount(0);

    await playTurn(guest, true);
    await playTurn(host);
    await expect(host.getByRole("region", { name: "Main de BobEntree" })).toContainText("36 +10");
    await expect(host.getByText("En attente de la prochaine manche · ChloeEntree")).toBeVisible();
    await expect(waiting(newcomer)).toBeVisible();
    await expect(newcomer.getByRole("region", { name: "Main de BobEntree" })).toHaveCount(0);
    await showRanking(host).click();
    await expect(host.getByRole("row", { name: /ChloeEntree/ })).toHaveCount(0);
    await host.screenshot({ path: testInfo.outputPath("02-classement-et-joueuse-en-attente.png") });

    await host.getByRole("button", { name: "Lancer la manche suivante" }).click();
    await expect(newcomer.getByRole("heading", { name: "Manche 2" })).toBeVisible();
    await join(late).click();
    await expect(late.getByText("Tu entreras en jeu après la manche 2.")).toBeVisible();
    await expect(newcomer.getByText("Manche 2 · Mémorisation")).toBeVisible({ timeout: 9_000 });
    await expect(newcomer.locator(".playing-card.face-down")).toHaveCount(12);
    await expect(newcomer.locator(".position-bottom .playing-card.face-down")).toHaveCount(4);
    await newcomer.getByRole("button", { name: "Carte 1 face cachée", exact: true }).click();
    await expect(newcomer.locator(".position-bottom .playing-card.face-up")).toHaveCount(1);
    await expect(host.locator(".playing-card.face-up")).toHaveCount(0);
    const center = (await newcomer.locator(".table-center").boundingBox())!;
    const own = (await newcomer.locator(".position-bottom").boundingBox())!;
    for (const seat of [".position-left", ".position-right"]) {
      const opponent = (await newcomer.locator(seat).boundingBox())!;
      expect(opponent.y + opponent.height).toBeLessThan(center.y);
      const card = (await newcomer.locator(`${seat} .playing-card`).first().boundingBox())!;
      expect(card.width).toBeGreaterThan(card.height * 0.65);
    }
    expect(center.y + center.height).toBeLessThan(own.y);
    await newcomer.screenshot({ path: testInfo.outputPath("03-premiere-main-portrait.png") });
    await newcomer.setViewportSize({ width: 844, height: 390 });
    await newcomer.screenshot({ path: testInfo.outputPath("04-premiere-main-paysage.png") });
    await newcomer.setViewportSize({ width: 390, height: 844 });

    await playTurn(host, true);
    await playTurn(guest);
    await playTurn(newcomer);
    await expect(newcomer.getByRole("heading", { name: "Fin de la partie" })).toBeVisible();
    await showRanking(newcomer).click();
    const newScore = newcomer.getByRole("row", { name: /ChloeEntree/ });
    await expect(newScore.getByRole("cell", { name: "72 (+26)", exact: true })).toBeVisible();
    await expect(newcomer.getByRole("row", { name: /DanaEntree/ })).toHaveCount(0);
    await newcomer.screenshot({ path: testInfo.outputPath("05-score-herite-portrait.png") });
    await expect(late.getByRole("heading", { name: "La partie est terminée" })).toBeVisible();
    await late.getByRole("button", { name: "Quitter la table" }).click();
    await expect(hub(late).getByText("Terminée", { exact: true })).toBeVisible();
    await expect(join(late)).toBeDisabled();
  } finally {
    await Promise.all([guest.close(), newcomer.close(), late.close()]);
  }
});
