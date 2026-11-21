import { expect, test, type Page } from "@playwright/test";
import { drawDeck, drawnCard, expectTableFits, fixDeckOrder, openTwoPlayerHub, expectLocalTurn } from "./tableFlow";

const announce = (page: Page) => page.getByRole("button", { name: "Annoncer Dutch en fin de tour" });

test("annonce Dutch, protection du Valet et scores", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(50_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceDutch", "BobDutch");
    await start.click();
    await expectLocalTurn(guest, 17_000);
    await drawDeck(guest).click();
    await expect(drawnCard(guest)).toHaveAccessibleName("Carte tirée, 5 de pique");
    await announce(guest).click();
    await expect(announce(guest)).toHaveAttribute("aria-pressed", "true");
    await expect(host.getByText(/a annoncé Dutch/)).toHaveCount(0);
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("01-annonce-preparee.png") });
    await guest.getByRole("button", { name: "Défausser la carte tirée" }).click();

    for (const page of [host, guest]) {
      await expect(page.getByText("BobDutch a annoncé Dutch. Dernier tour.")).toBeVisible();
      await expect(announce(page)).toHaveCount(0);
    }
    await expectLocalTurn(host);
    await expect(drawDeck(guest)).toBeDisabled();
    await expect(guest.locator(".position-bottom [data-reactable]")).toHaveCount(4);

    await host.setViewportSize({ width: 390, height: 844 });
    await expectTableFits(host);
    await host.screenshot({ path: testInfo.outputPath("02-dernier-tour-portrait.png") });
    await drawDeck(host).click();
    await host.getByRole("button", { name: "Remplacer la carte 2", exact: true }).click();
    await expect(host.getByRole("heading", { name: "Pouvoir du Valet" })).toBeVisible();
    await host.getByRole("button", { name: "Choisir la carte 1 de BobDutch" }).click();
    await host.getByRole("button", { name: "Choisir la carte 1 de AliceDutch" }).click();
    await expect(host.locator(".position-top .face-up")).toHaveAttribute("aria-label", "Carte 1 Dame de pique");
    await expect(host.getByRole("button", { name: "Échanger les cartes" })).toHaveCount(0);
    await expect(host.getByText("La protection Dutch empêche l’échange.")).toBeVisible();
    await expect(guest.locator(".player-cards .face-up")).toHaveCount(0);
    await expectTableFits(host);
    await host.screenshot({ path: testInfo.outputPath("03-protection-valet.png") });
    await host.getByRole("button", { name: "Garder en place" }).click();

    for (const page of [host, guest]) {
      await expect(page.getByRole("heading", { name: "Manche 1", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de AliceDutch" }).getByRole("img", { name: "Manche remportée" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de BobDutch" }).getByRole("img", { name: "Annonce Dutch, pénalité de 10 points" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de AliceDutch" }).getByText("20 points")).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de BobDutch" }).getByText("46 points")).toBeVisible();
    }
    await guest.setViewportSize({ width: 844, height: 390 });
    await guest.screenshot({ path: testInfo.outputPath("04-resultats-dutch-paysage.png"), fullPage: true });
  } finally {
    await guest.close();
  }
});
