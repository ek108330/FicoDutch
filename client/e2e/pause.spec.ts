import { expect, test, type Page } from "@playwright/test";
import { discard, drawnCard, drawDeck, expectLocalTurn, expectScreenFits, fixDeckOrder, openTwoPlayerHub, turnClock } from "./tableFlow";

test("l’hôte met le jeu en pause et le compte à rebours est visible de tous", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(45_000);
  const viewport = { width: 320, height: 640 };
  await host.setViewportSize(viewport);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, viewport });
  const pause = (page: Page) => page.getByRole("button", { name: "Mettre la partie en pause" });
  const countdown = (page: Page) => page.getByRole("progressbar", { name: "Reprise dans" });
  try {
    const start = await openTwoPlayerHub(host, guest, "HotePause", "InvitePause");
    await start.click();
    await expectLocalTurn(guest, 20_000);
    await expect(pause(guest)).toHaveCount(0);
    const toolbar = host.locator(".table-options");
    const buttons = toolbar.locator(":scope > button");
    await expect(buttons.first()).toHaveAccessibleName("Mettre la partie en pause");
    await expect(buttons.last()).toHaveAccessibleName("Paramètres du jeu");
    await expect(toolbar.getByRole("group", { name: "Emojis de la table" })).toBeInViewport({ ratio: 1 });
    await expectScreenFits(host);
    await drawDeck(guest).click();
    const cardName = await drawnCard(guest).getAttribute("aria-label");
    const beforePause = Number(await turnClock(guest).getAttribute("aria-valuenow"));
    await pause(host).click();

    for (const page of [host, guest]) {
      await expect(page.getByRole("heading", { name: "Partie en pause" })).toBeVisible();
    }
    await expect(guest.getByRole("button", { name: "Reprendre la partie" })).toHaveCount(0);
    await host.screenshot({ path: testInfo.outputPath("pause-hote-portrait.png") });
    const resume = host.getByRole("button", { name: "Reprendre la partie" });
    await resume.click();
    await expect(resume).toBeDisabled();
    for (const seconds of ["3", "2", "1"]) {
      await Promise.all([host, guest].map((page) => expect(countdown(page)).toHaveAttribute("aria-valuenow", seconds)));
      if (seconds === "3") await guest.screenshot({ path: testInfo.outputPath("reprise-invite-portrait.png") });
    }
    await expect(countdown(host)).toHaveCount(0);
    await expect(countdown(guest)).toHaveCount(0);
    await expect(drawnCard(guest)).toHaveAccessibleName(cardName!);
    expect(Number(await turnClock(guest).getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(beforePause - 1);
    await discard(guest).click();
    await expect(drawnCard(guest)).toHaveCount(0);
  } finally {
    await guest.close();
  }
});
