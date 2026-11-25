import { expect, test } from "@playwright/test";
import { closeSettings, expectScreenFits, openLobby, openSettings } from "./tableFlow";

test("l’accueil et le Hub tiennent à l’écran et les règles peuvent défiler", async ({ page, browser, baseURL }, testInfo) => {
  const guest = await browser.newPage({ baseURL });
  const gear = page.getByRole("button", { name: "Paramètres du jeu" });
  try {
    await page.setViewportSize({ width: 393, height: 702 });
    await page.goto("/");
    await expect(page.locator(".home-page")).toHaveCSS("background-color", "rgb(16, 47, 41)");
    const logo = page.locator(".brand img");
    await expect(logo).toHaveJSProperty("naturalWidth", 576);
    await expect(logo).toHaveCSS("object-position", "50% 0%");
    const signature = page.getByText("by Kevin", { exact: true });
    const logoBox = (await logo.boundingBox())!;
    const gearBox = (await gear.boundingBox())!;
    const titleBox = (await page.locator(".brand span").boundingBox())!;
    const versionBox = (await page.locator(".top-bar .version").boundingBox())!;
    expect(logoBox.width).toBeCloseTo(250, 0);
    expect(logoBox.x + logoBox.width / 2).toBeCloseTo(titleBox.x + titleBox.width / 2, 0);
    expect(titleBox.y + titleBox.height / 2).toBeCloseTo(logoBox.y + logoBox.height / 2 + 14.4, 1);
    expect(titleBox.x + titleBox.width).toBeLessThan(gearBox.x);
    expect(logoBox.y + logoBox.height / 2).toBeCloseTo(gearBox.y + gearBox.height / 2, 0);
    expect(versionBox.y).toBeGreaterThanOrEqual(gearBox.y + gearBox.height);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/ficodutch-logo.png");
    const pseudo = page.getByRole("textbox", { name: "Pseudo" });
    await expect(pseudo).toHaveAttribute("placeholder", "Pseudo");
    await expect(pseudo).toHaveValue("");
    await expect(page.getByText("Choisis ton pseudo", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Rejoindre une partie" })).toHaveCSS("text-align", "center");
    await page.screenshot({ path: testInfo.outputPath("accueil-pseudo-vide.png") });
    await Promise.all([openLobby(page, "AliceLayout"), openLobby(guest, "BobLayout")]);
    for (const [width, height] of [[320, 568], [740, 360], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await expectScreenFits(page);
      await expect(gear).toBeInViewport();
      await expect(signature).toBeInViewport({ ratio: 1 });
      const signatureBox = (await signature.boundingBox())!;
      expect(signatureBox.x + signatureBox.width).toBeLessThan((await gear.boundingBox())!.x);
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
    expect((await logo.boundingBox())!.width).toBeCloseTo(229, 0);
    await expect(signature).toBeVisible();
    await expectScreenFits(page);
    await expect(start).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("hub-360.png") });
    const threshold = page.getByRole("slider", { name: "Fin de partie" });
    const guestThreshold = guest.getByRole("slider", { name: "Fin de partie" });
    await expect(guestThreshold).toBeDisabled();
    await threshold.press("End");
    await expect(guestThreshold).toHaveAttribute("aria-valuetext", "Sans limite");
    await threshold.press("Home");
    await expect(guestThreshold).toHaveAttribute("aria-valuetext", "50 points");

    for (const [width, height] of [[360, 640], [740, 360]]) {
      await page.setViewportSize({ width, height });
      await expectScreenFits(page);
      const players = page.getByRole("list", { name: "Joueurs présents" });
      const chat = page.getByRole("region", { name: "Chat du Hub" });
      await expect(chat.getByRole("textbox", { name: "Message du Hub" })).toBeInViewport({ ratio: 1 });
      const playerBox = (await players.boundingBox())!;
      const chatBox = (await chat.boundingBox())!;
      expect(playerBox.y + playerBox.height).toBeLessThanOrEqual(chatBox.y);
      await expect(start).toBeInViewport();
      const tiles = page.getByRole("group", { name: "Variantes", exact: true }).getByRole("button");
      await expect(tiles).toHaveCount(4);
      for (const tile of await tiles.all()) {
        await expect(tile).toBeInViewport({ ratio: 1 });
        expect((await tile.boundingBox())!.y).toBe((await tiles.first().boundingBox())!.y);
      }
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
