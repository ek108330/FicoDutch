import { expect, test } from "@playwright/test";
import { discardDrawn, activeTurn, discard, drawDeck, drawnCard, expectTableFits, fixDeckOrder, openTwoPlayerHub,
  expectLocalTurn, expectClockFromTop } from "./tableFlow";

for (const cardsPerPlayer of [4, 6]) {
  test(`mémorisation à ${cardsPerPlayer} cartes pour l’hôte et l’invité`, async ({
    page: host,
    browser,
    baseURL,
  }, testInfo) => {
    if (cardsPerPlayer === 6) {
      test.setTimeout(105_000);
      await fixDeckOrder(host);
    }
    const guest = await browser.newPage({ baseURL });
    const hostPseudo = `Alice${cardsPerPlayer}`;
    const guestPseudo = `Bob${cardsPerPlayer}`;

    try {
      const start = await openTwoPlayerHub(host, guest, hostPseudo, guestPseudo);

      const guestVariant = guest.getByRole("button", { name: "6 cartes", exact: true });
      await expect(guestVariant).toBeDisabled();
      if (cardsPerPlayer === 6) {
        await host.getByRole("button", { name: "6 cartes", exact: true }).click();
        await expect(guestVariant).toHaveAttribute("aria-pressed", "true");
      }

      await start.click();
      for (const [page, pseudo] of [[host, hostPseudo], [guest, guestPseudo]] as const) {
        const table = page.locator(".game-table");
        await expect(table).toBeVisible();
        await expect(page.getByText("Salle d'attente")).toHaveCount(0);
        await expect(table.locator(".position-bottom .player-name")).toHaveText(pseudo);
        for (const position of ["top", "bottom"]) {
          await expect(table.locator(`.position-${position} .playing-card.face-down`))
            .toHaveCount(cardsPerPlayer);
        }
      }

      const limit = cardsPerPlayer === 6 ? 3 : 2;
      for (const page of [host, guest]) {
        const prompt = page.getByRole("region", { name: "Mémorisation" });
        await expect(prompt).toHaveText("Mémorisation");
        const clock = prompt.getByRole("progressbar", { name: "Temps de mémorisation" });
        await expect(clock).toHaveAttribute("aria-valuemax", "15");
        await expectClockFromTop(clock);
        const ownHand = page.locator(".position-bottom");
        const cards = ownHand.getByRole("button", { name: /^Carte / });
        for (let i = 0; i < limit; i++) {
          await cards.nth(i).click();
          await expect(ownHand.locator(".face-up")).toHaveCount(i + 1);
        }
        await expect(cards.nth(limit)).toBeDisabled();
        await expect(cards.first()).toHaveCSS("background-color", "rgb(255, 227, 154)");
        await expect(page.locator(".position-top .face-up")).toHaveCount(0);
        await expect(page.locator(".position-top").getByRole("button")).toHaveCount(0);
      }

      await expectTableFits(host);
      await host.screenshot({ path: testInfo.outputPath("01-ordinateur.png") });

      if (cardsPerPlayer === 6) {
        await guest.setViewportSize({ width: 390, height: 844 });
        await expectTableFits(guest);
        await guest.screenshot({ path: testInfo.outputPath("02-mobile-portrait.png") });

        await guest.setViewportSize({ width: 844, height: 390 });
        await expectTableFits(guest);
        await guest.screenshot({ path: testInfo.outputPath("03-mobile-paysage.png") });
      }

      const guestHand = guest.locator(".position-bottom");
      const guestCards = guestHand.getByRole("button", { name: /^Carte / });
      const firstFace = await guestCards.nth(0).getAttribute("aria-label");
      await guestCards.nth(0).click();
      await expect(guestHand.locator(".face-up")).toHaveCount(limit - 1);
      await expect(guestCards.nth(limit)).toBeDisabled();
      await expect(guest.getByRole("button", { name: "Masquer mes cartes" })).toHaveCount(0);
      for (let i = 1; i < limit; i++) await guestCards.nth(i).click();
      await expect(guestHand.locator(".face-up")).toHaveCount(0);
      for (let i = limit; i < cardsPerPlayer; i++) await expect(guestCards.nth(i)).toBeDisabled();
      for (let i = 0; i < limit; i++) await guestCards.nth(i).click();
      await expect(guestHand.locator(".face-up")).toHaveCount(limit);
      await expect(guestCards.nth(0)).toHaveAttribute("aria-label", firstFace!);
      await guest.screenshot({ path: testInfo.outputPath("10-cartes-selectionnees-reaffichees.png") });

      await Promise.all([host, guest].map(async (page) => {
        await expect(page.getByRole("region", { name: "Tour de jeu" })).toBeVisible({ timeout: 20_000 });
        await expect(page.locator(".playing-card.face-up")).toHaveCount(0);
        await expect(page.locator(".position-bottom .player-cards").getByRole("button")).toHaveCount(0);
      }));
      if (cardsPerPlayer === 6) {
        await host.screenshot({ path: testInfo.outputPath("04-cartes-masquees.png") });
        const first = (await activeTurn(host).textContent()) === `${hostPseudo} joue` ? host : guest;
        const second = first === host ? guest : host;

        await first.setViewportSize({ width: 1280, height: 720 });
        await expect(drawDeck(first)).toBeEnabled();
        await expect(drawDeck(second)).toBeDisabled();
        await expect(first.getByRole("img", { name: "Défausse vide" })).toBeVisible();
        await drawDeck(first).click();
        await expect(drawnCard(first)).toBeVisible();
        await expect(drawnCard(second)).toHaveCount(0);
        await expect(drawDeck(first)).toBeDisabled();
        const firstFace = (await drawnCard(first).getAttribute("aria-label"))?.replace("Carte tirée, ", "");
        await expectTableFits(first);
        await first.screenshot({ path: testInfo.outputPath("05-pioche-ordinateur.png") });

        await discardDrawn(first);
        await expectLocalTurn(second);
        for (const page of [first, second]) {
          await expect(discard(page)).toHaveAccessibleName(`Défausse, ${firstFace}`);
        }
        await discard(second).click();
        await expect(drawnCard(second)).toHaveCount(0);
        await expect(drawDeck(second)).toBeEnabled();
        await drawDeck(second).click();
        await expect(drawnCard(second)).toBeVisible();
        await expect(drawnCard(first)).toHaveCount(0);
        await expect(discard(second)).toHaveAccessibleName(`Défausse, ${firstFace}`);

        await second.setViewportSize({ width: 390, height: 844 });
        await expectTableFits(second);
        await second.screenshot({ path: testInfo.outputPath("06-remplacement-portrait.png") });
        await second.getByRole("button", { name: "Remplacer la carte 1", exact: true }).click();
        await expectLocalTurn(first);
        await expect(discard(first)).toBeVisible();
        await expect(discard(second)).toHaveAccessibleName((await discard(first).getAttribute("aria-label"))!);
        for (const page of [first, second]) {
          await expect(page.locator(".position-bottom .playing-card.face-down")).toHaveCount(6);
          await expect(page.locator(".position-top .playing-card.face-down")).toHaveCount(6);
        }

        await first.setViewportSize({ width: 844, height: 390 });
        await expectTableFits(first);
        await first.screenshot({ path: testInfo.outputPath("07-defausse-paysage.png") });

        await drawDeck(first).click();
        await expect(drawnCard(first)).toBeVisible();
        await expectTableFits(first);
        await first.screenshot({ path: testInfo.outputPath("09-tour-reaction-paysage.png") });
        const expiredFace = (await drawnCard(first).getAttribute("aria-label"))?.replace("Carte tirée, ", "");
        await expectLocalTurn(second, 65_000);
        await expect(discard(second)).toHaveAccessibleName(`Défausse, ${expiredFace}`);
        await expect(drawnCard(first)).toHaveCount(0);
        await second.screenshot({ path: testInfo.outputPath("08-tour-apres-expiration.png") });
      }
    } finally {
      await guest.close();
    }
  });
}
