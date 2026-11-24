import { expect, test } from "@playwright/test";
import { activeTurn, discard, discardDrawn, drawDeck, expectScreenFits, expectLocalTurn, fixDeckOrder, openLobby, openManagement, openTwoPlayerHub } from "./tableFlow";

test("l’hôte peut gérer cinq bots et jouer seul à une table complète", async ({ page }, testInfo) => {
  test.setTimeout(40_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await fixDeckOrder(page);
  await openLobby(page, "SoloBots");
  await page.getByRole("button", { name: "Créer un Hub", exact: true }).click();
  const add = page.getByRole("button", { name: "Ajouter un bot", exact: true });
  const launch = page.getByRole("button", { name: "Lancer la partie", exact: true });
  const roster = page.getByRole("list", { name: "Joueurs présents" });
  await expect(launch).toBeDisabled();
  for (let number = 1; number <= 5; number++) {
    await add.click();
    await expect(roster.getByRole("listitem")).toHaveCount(number + 1);
  }
  await expect(add).toBeDisabled();
  await expect(roster.getByRole("img", { name: "Bot", exact: true })).toHaveCount(5);
  await expect(roster.locator("[data-avatar-mark='robot']")).toHaveCount(5);
  const management = await openManagement(page);
  await management.getByRole("button", { name: "Retirer Bot 5", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer le retrait", exact: true }).click();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(add).toBeDisabled();
  await expect(launch).toBeEnabled();
  await expectScreenFits(page);
  await expect(launch).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("01-hub-cinq-bots.png") });
  await launch.click();

  await expect(activeTurn(page)).toHaveText("Bot 5 joue", { timeout: 18_000 });
  await expect(page.locator(".game-table [data-avatar-mark='robot']")).toHaveCount(5);
  const drawn = page.getByRole("img", { name: "Carte tirée par Bot 5, face cachée" });
  await expect(drawn).toBeVisible();
  await expect(drawn.locator(".card-face")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("02-bot-pioche-face-cachee.png") });
  await expect(discard(page)).toHaveAccessibleName("Défausse, 2 de trèfle");
  await expect(page.locator('[data-card-animation="bot-discard"] .card-face b')).toHaveText("2");
});

test("un bot utilise le Valet et les deux joueurs humains voient l’échange", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(45_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceBots", "BobBots");
    await host.getByRole("button", { name: "Ajouter un bot", exact: true }).click();
    await expect(guest.getByRole("list", { name: "Joueurs présents" }).getByText("Bot 1", { exact: true })).toBeVisible();
    await expect(guest.getByRole("button", { name: "Ajouter un bot", exact: true })).toHaveCount(0);
    await start.click();
    await expect(activeTurn(guest)).toHaveText("Bot 1 joue", { timeout: 18_000 });
    const drawn = guest.getByRole("img", { name: "Carte tirée par Bot 1, face cachée" });
    await expect(drawn).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Pouvoir du Valet" })).toHaveCount(0);
    await expect(discard(guest)).toHaveAccessibleName("Défausse, Valet de pique");
    const selected = guest.locator('.player-cards [data-exchange-selected="true"]');
    await expect(selected).toHaveCount(2);
    await expect(guest.locator(".player-cards .face-up")).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("03-bot-selection-valet.png") });
    for (const page of [host, guest]) {
      const swapped = page.locator('[data-card-animation="swap"]');
      await expect(swapped).toHaveCount(2);
      await expect(swapped.locator(".card-face")).toHaveCount(0);
    }
    await expectLocalTurn(host);
  } finally {
    await guest.close();
  }
});

test("le délai de réaction du bot part de la défausse et survit à une autre action", async ({ page }, testInfo) => {
  test.setTimeout(40_000);
  await page.setViewportSize({ width: 393, height: 702 });
  await fixDeckOrder(page);
  await openLobby(page, "DelaiBot");
  await page.getByRole("button", { name: "Créer un Hub", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter un bot", exact: true }).click();
  await page.getByRole("button", { name: "+1 / -1", exact: true }).click();
  await page.getByRole("button", { name: "Lancer la partie", exact: true }).click();
  await expectLocalTurn(page, 22_000);
  await expect(discard(page)).toHaveAccessibleName("Défausse, Dame de pique");

  const table = page.locator(".game-table");
  await table.evaluate((game) => {
    if (!(game instanceof HTMLElement)) return;
    new MutationObserver(() => {
      const rank = game.querySelector(".discard-slot > .card-face b")?.textContent;
      if (rank === "4") game.dataset.discardFour ??= String(performance.now());
      if (rank === "5" && game.dataset.discardFour) game.dataset.discardFive ??= String(performance.now());
    }).observe(game, { childList: true, subtree: true });
  });
  await drawDeck(page).click();
  await discardDrawn(page);
  await expect(discard(page)).toHaveAccessibleName("Défausse, 4 de pique");
  await page.waitForFunction(() => {
    const at = document.querySelector<HTMLElement>(".game-table")?.dataset.discardFour;
    return at !== undefined && performance.now() - Number(at) >= 1_500;
  });

  const hand = page.locator(".position-bottom .playing-card");
  await hand.first().press("r");
  await expect(hand).toHaveCount(5);
  await expect(discard(page)).toHaveAccessibleName("Défausse, 5 de pique");
  const waited = await table.evaluate((game) => Number(game.getAttribute("data-discard-five")) - Number(game.getAttribute("data-discard-four")));
  expect(waited).toBeGreaterThan(3_800);
  expect(waited).toBeLessThan(4_600);
  await expect(page.locator(".position-top .playing-card")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("04-bot-apres-reaction.png") });
});
