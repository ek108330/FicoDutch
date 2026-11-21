import { expect, test, type Page } from "@playwright/test";
import { activeTurn, closeSettings, discard, drawDeck, drawnCard, expectTableFits, fixDeckOrder, openSettings, openTwoPlayerHub } from "./tableFlow";

const faceUpHands = (page: Page) => page.locator(".player-cards .face-up");
const targetCard = (page: Page, position: number, pseudo: string) =>
  page.getByRole("button", { name: `Choisir la carte ${position} de ${pseudo}`, exact: true });

async function playSpecialCard(page: Page, position: number, power: string) {
  await expect(activeTurn(page)).toHaveText("À toi de jouer");
  await drawDeck(page).click();
  await page.getByRole("button", { name: `Remplacer la carte ${position}`, exact: true }).click();
  await expect(activeTurn(page)).toHaveText(`Pouvoir du ${power}`);
  await expect(drawDeck(page)).toBeDisabled();
  await expect(drawnCard(page)).toHaveCount(0);
}

test("vision et échange des cartes spéciales", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(110_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  const alice = "AlicePouvoir";
  const bob = "BobPouvoir";

  try {
    const start = await openTwoPlayerHub(host, guest, alice, bob);
    await start.click();
    await expect(activeTurn(guest)).toHaveText("À toi de jouer", { timeout: 17_000 });
    await expect(guest.getByRole("timer")).toHaveText("58 s");

    await playSpecialCard(guest, 2, "10");
    await expect(guest.getByRole("timer")).toHaveText(/^(59|60) s$/);
    await targetCard(guest, 1, bob).click();
    await expect(guest.locator(".position-bottom .playing-card[data-selected=true]")).toHaveCount(1);
    await expect(faceUpHands(guest)).toHaveCount(0);
    await expect(faceUpHands(host)).toHaveCount(0);
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("01-dix-echange-aveugle.png") });
    await targetCard(guest, 1, alice).click();
    await expect(activeTurn(host)).toHaveText("À toi de jouer");

    await playSpecialCard(host, 2, "Valet");
    await targetCard(host, 1, alice).click();
    await expect(faceUpHands(host)).toHaveCount(0);
    await targetCard(host, 1, bob).click();
    await expect(faceUpHands(host)).toHaveCount(2);
    await expect(host.locator(".position-bottom .face-up")).toHaveAttribute("aria-label", "Carte 1 Dame de pique");
    await expect(host.locator(".position-top .face-up")).toHaveAttribute("aria-label", "Carte 1 Roi de pique");
    await expect(activeTurn(guest)).toHaveText("Pouvoir du Valet");
    await expect(faceUpHands(guest)).toHaveCount(0);

    await host.setViewportSize({ width: 390, height: 844 });
    await expectTableFits(host);
    await host.screenshot({ path: testInfo.outputPath("02-valet-portrait.png") });
    await guest.screenshot({ path: testInfo.outputPath("03-valet-vue-adversaire.png") });
    await host.getByRole("button", { name: "Échanger les cartes" }).click();
    await expect(activeTurn(guest)).toHaveText("À toi de jouer");
    await expect(faceUpHands(host)).toHaveCount(0);

    await playSpecialCard(guest, 3, "8");
    await expect(targetCard(guest, 1, alice)).toHaveCount(0);
    await targetCard(guest, 1, bob).click();
    await expect(guest.locator(".position-bottom .face-up")).toHaveAttribute("aria-label", "Carte 1 Dame de pique");
    await expect(faceUpHands(host)).toHaveCount(0);
    await guest.getByRole("button", { name: "Terminer le pouvoir" }).click();

    await playSpecialCard(host, 3, "9");
    await expect(targetCard(host, 1, alice)).toHaveCount(0);
    await targetCard(host, 1, bob).click();
    await expect(host.locator(".position-top .face-up")).toHaveAttribute("aria-label", "Carte 1 Dame de pique");
    await expect(faceUpHands(guest)).toHaveCount(0);
    await host.setViewportSize({ width: 844, height: 390 });
    await expectTableFits(host);
    await host.screenshot({ path: testInfo.outputPath("04-neuf-paysage.png") });
    await expect(activeTurn(guest)).toHaveText("À toi de jouer", { timeout: 65_000 });
    await expect(faceUpHands(host)).toHaveCount(0);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 9 de pique");
    await guest.screenshot({ path: testInfo.outputPath("05-apres-expiration.png") });
  } finally {
    await guest.close();
  }
});

test("joker ajoute une septième carte cachée", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(45_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  const alice = "AliceJoker";
  const bob = "BobJoker";

  try {
    const start = await openTwoPlayerHub(host, guest, alice, bob);
    const hostSettings = await openSettings(host);
    const guestSettings = await openSettings(guest);
    for (const variant of ["6 cartes", "Joker +"]) {
      await hostSettings.getByRole("button", { name: variant, exact: true }).click();
      await expect(guestSettings.getByRole("button", { name: variant, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    await Promise.all([closeSettings(host), closeSettings(guest)]);
    await start.click();
    await expect(activeTurn(guest)).toHaveText("À toi de jouer", { timeout: 17_000 });
    await playSpecialCard(guest, 1, "Joker+");

    const give = guest.getByRole("button", { name: `Donner à ${alice}`, exact: true });
    await expect(give).toBeVisible();
    await expect(host.getByRole("button", { name: /^Donner à / })).toHaveCount(0);
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("01-joker-adversaire.png") });
    await give.click();

    await expect(activeTurn(host)).toHaveText("À toi de jouer");
    const received = host.locator(".position-bottom .playing-card");
    const visibleToGuest = guest.locator(".position-top .playing-card");
    for (const hand of [received, visibleToGuest]) {
      await expect(hand).toHaveCount(7);
      await expect(hand.nth(6)).toHaveAttribute("aria-label", "Carte 7 face cachée");
    }
    await expect(faceUpHands(host)).toHaveCount(0);
    await expect(faceUpHands(guest)).toHaveCount(0);
    await host.setViewportSize({ width: 390, height: 844 });
    expect(await received.evaluateAll((cards) => new Set(cards.map((card) => (card as HTMLElement).offsetTop)).size))
      .toBe(2);
    await expectTableFits(host);
    const slot = await host.locator(".discard-slot").boundingBox();
    const jokerLabel = await host.locator(".discard-slot .joker-face").boundingBox();
    expect(jokerLabel!.x).toBeGreaterThanOrEqual(slot!.x + 4);
    expect(jokerLabel!.x + jokerLabel!.width).toBeLessThanOrEqual(slot!.x + slot!.width - 4);
    await host.screenshot({ path: testInfo.outputPath("02-joker-sept-cartes.png") });
  } finally {
    await guest.close();
  }
});
