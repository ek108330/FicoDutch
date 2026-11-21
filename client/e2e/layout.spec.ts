import { expect, test } from "@playwright/test";
import { closeSettings, expectScreenFits, openLobby, openSettings } from "./tableFlow";

test("l’accueil et le Hub tiennent à l’écran et les règles peuvent défiler", async ({ page, browser, baseURL }, testInfo) => {
  const guest = await browser.newPage({ baseURL });
  const gear = page.getByRole("button", { name: "Paramètres du jeu" });
  try {
    await Promise.all([openLobby(page, "AliceLayout"), openLobby(guest, "BobLayout")]);
    for (const [width, height] of [[320, 568], [740, 360], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await expectScreenFits(page);
      await expect(gear).toBeInViewport();
      await expect(page.getByRole("heading", { name: "Rejoindre une partie" })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`accueil-${width}.png`) });
    }

    await page.setViewportSize({ width: 360, height: 640 });
    const settings = await openSettings(page);
    await expect(settings.getByRole("button", { name: "Sons de jeu" })).toBeInViewport();
    await settings.screenshot({ path: testInfo.outputPath("parametres-accueil.png") });
    await settings.getByRole("button", { name: "Règles du jeu" }).click();
    const rules = page.getByRole("dialog", { name: "Règles du FicoDutch" });
    await expect(rules.getByRole("button", { name: "Retour" })).toBeFocused();
    expect(await rules.evaluate((dialog) => dialog.scrollHeight)).toBeGreaterThan(640);
    await page.screenshot({ path: testInfo.outputPath("regles.png") });
    await rules.getByRole("button", { name: "Retour" }).click();
    await closeSettings(page);
    await expect(gear).toBeFocused();

    await page.getByRole("button", { name: "Créer un Hub" }).click();
    const start = page.getByRole("button", { name: "Lancer la partie" });
    await guest.locator(".hub-item").filter({ hasText: "Hub de AliceLayout" })
      .getByRole("button", { name: "Rejoindre", exact: true }).click();
    await expect(start).toBeEnabled();
    await expectScreenFits(page);
    await expect(start).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("hub-360.png") });
    await openSettings(page);
    await settings.screenshot({ path: testInfo.outputPath("parametres-hub.png") });
    await closeSettings(page);

    await page.getByRole("button", { name: "Chat", exact: true }).click();
    for (const [width, height] of [[360, 640], [740, 360]]) {
      await page.setViewportSize({ width, height });
      await expectScreenFits(page);
      await expect(page.getByRole("textbox", { name: "Message du Hub" })).toBeInViewport();
      await expect(start).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`) });
    }

    await start.click();
    await page.setViewportSize({ width: 360, height: 640 });
    await expect(page.locator(".game-table")).toBeVisible();
    await expectScreenFits(page);
    await expect(gear).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("partie-360.png") });
  } finally {
    await guest.close();
  }
});
