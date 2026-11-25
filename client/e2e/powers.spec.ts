import { expect, test, type Page } from "@playwright/test";
import { discard, discardDrawn, drawDeck, drawnCard, expectTableFits, fixDeckOrder, openLobby, openTwoPlayerHub, turnClock, expectLocalTurn,
  expectCenteredTurnPanel, expectClockFromTop } from "./tableFlow";

const faceUpHands = (page: Page) => page.locator(".player-cards .face-up");
const targetCard = (page: Page, position: number, pseudo: string) =>
  page.getByRole("button", { name: `Choisir la carte ${position} de ${pseudo}`, exact: true });

async function playSpecialCard(page: Page, position: number, power: string) {
  await expectLocalTurn(page);
  await drawDeck(page).click();
  await page.getByRole("button", { name: `Remplacer la carte ${position}`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `Pouvoir du ${power}` })).toBeVisible();
  const panel = page.locator(".turn-panel");
  await expect(panel.locator(".turn-player")).toHaveCount(0);
  await expect(panel.getByRole("heading")).toHaveCSS("color", "rgb(36, 25, 12)");
  await expect(panel.locator(".power-controls p")).toHaveCSS("color", "rgb(36, 25, 12)");
  if (power === "Joker+") {
    await expect(drawDeck(page)).toHaveCount(0);
  } else await expect(drawDeck(page)).toBeDisabled();
  await expect(drawnCard(page)).toHaveCount(0);
}

test("vision et échange des cartes spéciales", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(110_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, hasTouch: true, isMobile: true });
  const alice = "AlicePouvoir";
  const bob = "BobPouvoir";

  try {
    const start = await openTwoPlayerHub(host, guest, alice, bob);
    await start.click();
    await expectLocalTurn(guest, 20_000);
    await expect(guest.getByRole("timer")).toHaveCount(0);
    const progress = turnClock(guest).locator(".perimeter-clock-progress");
    await expectClockFromTop(turnClock(guest));
    const originalOffset = Number(await progress.getAttribute("stroke-dashoffset"));
    await expect.poll(async () => Number(await progress.getAttribute("stroke-dashoffset"))).toBeLessThan(originalOffset);
    await expect.poll(async () => Number(await turnClock(guest).getAttribute("aria-valuenow"))).toBeLessThan(60);
    await expect(host.locator(".position-top .player-name").getByRole("progressbar", { name: "Temps restant" })).toBeVisible();
    await expectClockFromTop(turnClock(host));
    await expect(host.locator(".table-center .turn-panel")).toHaveCount(0);
    const otherHand = guest.locator(".position-top .player-cards");
    const beforePower = await otherHand.boundingBox();

    await playSpecialCard(guest, 2, "10");
    expect(await otherHand.boundingBox()).toEqual(beforePower);
    await guest.setViewportSize({ width: 740, height: 360 });
    await expectCenteredTurnPanel(guest);
    await guest.screenshot({ path: testInfo.outputPath("09-consigne-centree-paysage.png") });
    await expect(turnClock(guest)).toHaveAttribute("aria-valuenow", /^(59|60)$/);
    await targetCard(guest, 1, bob).click();
    await expect(guest.locator(".position-bottom .playing-card[data-selected=true]")).toHaveCount(1);
    await expect(host.locator(".position-top .playing-card[data-exchange-selected=true]")).toHaveCount(1);
    await expect(host.locator(".position-top .playing-card[data-exchange-selected=true]")).toHaveCSS("background-color", "rgb(242, 206, 103)");
    await expect(host.locator(".position-top [data-exchange-selected=true] .card-back-pattern span")).toHaveCSS("color", "rgb(72, 52, 19)");
    await expect(faceUpHands(guest)).toHaveCount(0);
    await expect(faceUpHands(host)).toHaveCount(0);
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("01-dix-echange-aveugle.png") });
    await host.setViewportSize({ width: 390, height: 844 });
    await targetCard(guest, 1, alice).click();
    const bothSelected = host.locator(".playing-card.face-down[data-exchange-selected=true]");
    await expect(bothSelected).toHaveCount(2);
    await expect(host.locator('[data-card-animation="swap"]')).toHaveCount(0);
    await host.screenshot({ path: testInfo.outputPath("01b-dix-deux-cartes-surlignees.png") });
    await expect(host.locator('[data-card-animation="swap"]')).toHaveCount(2);
    expect(await host.locator('[data-card-animation="swap"]').first().evaluate((card) => card.getAnimations()[0].effect?.getTiming().duration)).toBeGreaterThan(900);
    await expect(host.locator(".flying-card .card-face")).toHaveCount(0);
    await expectLocalTurn(host);

    await playSpecialCard(host, 2, "Valet");
    await targetCard(host, 1, alice).click();
    await expect(faceUpHands(host)).toHaveCount(0);
    await targetCard(host, 1, bob).click();
    await expect(faceUpHands(host)).toHaveCount(2);
    await expect(host.locator(".power-card-turn")).toHaveCount(2);
    await expect(host.locator(".position-bottom .face-up")).toHaveAttribute("aria-label", "Carte 1 Dame de pique");
    await expect(host.locator(".position-bottom .face-up .drawn-card-front")).toHaveCSS("color", "rgb(53, 42, 22)");
    await expect(host.locator(".position-top .face-up")).toHaveAttribute("aria-label", "Carte 1 Roi de pique");
    await expect(guest.getByRole("heading", { name: "Pouvoir du Valet" })).toHaveCount(0);
    await expect(guest.locator(".position-top .player-name").getByRole("progressbar", { name: "Temps restant" })).toBeVisible();
    await expect(faceUpHands(guest)).toHaveCount(0);
    await expect(guest.locator(".power-card-turn")).toHaveCount(0);
    await expect(guest.locator(".playing-card[data-exchange-selected=true]")).toHaveCount(2);

    await host.setViewportSize({ width: 390, height: 844 });
    await expectTableFits(host);
    await expectCenteredTurnPanel(host);
    await host.screenshot({ path: testInfo.outputPath("02-valet-portrait.png") });
    await guest.screenshot({ path: testInfo.outputPath("03-valet-vue-adversaire.png") });
    await guest.setViewportSize({ width: 390, height: 844 });
    const swapValet = host.locator(".power-controls").getByRole("button", { name: "Échanger les cartes" });
    await expect(swapValet).toBeVisible();
    await expect(swapValet).toHaveCSS("color", "rgb(36, 25, 12)");
    await expect(host.locator(".power-controls").getByRole("button", { name: "Annuler l’échange" })).toBeVisible();
    await expect(guest.getByRole("button", { name: "Échanger les cartes" })).toHaveCount(0);
    await swapValet.click();
    await expect(guest.locator('[data-card-animation="swap"]')).toHaveCount(2);
    await expect(guest.locator(".flying-card .card-face")).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("06-echange-face-cachee.png") });
    await expectLocalTurn(guest);
    await expect(faceUpHands(host)).toHaveCount(0);

    await playSpecialCard(guest, 3, "8");
    await expect(targetCard(guest, 1, alice)).toHaveCount(0);
    await targetCard(guest, 1, bob).click();
    const hideOwn = guest.getByRole("button", { name: "Retourner la carte 1 de BobPouvoir, Dame de pique" });
    await expect(hideOwn).toBeVisible();
    await expect(faceUpHands(host)).toHaveCount(0);
    const lookClock = (page: Page) => page.getByRole("progressbar", { name: "Temps de consultation de la carte" });
    await expect(lookClock(host)).toHaveAttribute("aria-valuemax", "10");
    await expect(host.locator(".playing-card.face-down[data-look-card]")).toHaveCSS("background-color", "rgb(242, 206, 103)");
    await expectClockFromTop(lookClock(host));
    await expect(guest.getByRole("button", { name: /Terminer le pouvoir|Passer le pouvoir/ })).toHaveCount(0);
    await hideOwn.locator(".power-card-turn").evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await guest.screenshot({ path: testInfo.outputPath("07-huit-carte-retournee.png") });
    await host.screenshot({ path: testInfo.outputPath("07-huit-surlignage-observateur.png") });
    // Certains navigateurs tactiles n’émettent pas de clic après un appui.
    await hideOwn.evaluate((element) => {
      element.addEventListener("click", (event) => event.stopImmediatePropagation(), { once: true });
    });
    await hideOwn.tap();
    await expect(lookClock(host)).toHaveCount(0);

    await playSpecialCard(host, 3, "9");
    await expect(targetCard(host, 1, alice)).toHaveCount(0);
    await targetCard(host, 1, bob).click();
    await expect(host.getByRole("button", { name: "Retourner la carte 1 de BobPouvoir, Dame de pique" })).toBeVisible();
    await expect(faceUpHands(guest)).toHaveCount(0);
    await expect(lookClock(guest)).toBeVisible();
    await expect(guest.locator(".playing-card.face-down[data-look-card]")).toHaveCSS("background-color", "rgb(242, 206, 103)");
    await expect.poll(async () => Number(await lookClock(guest).getAttribute("aria-valuenow"))).toBeLessThan(10);
    await guest.screenshot({ path: testInfo.outputPath("08-neuf-carte-cachee-observateur.png") });
    await host.setViewportSize({ width: 844, height: 390 });
    await expectTableFits(host);
    await expectClockFromTop(lookClock(host));
    await host.screenshot({ path: testInfo.outputPath("04-neuf-paysage.png") });
    await expectLocalTurn(guest, 11_000);
    await expect(lookClock(guest)).toHaveCount(0);
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
  const guest = await browser.newPage({ baseURL, viewport: { width: 393, height: 702 }, hasTouch: true, isMobile: true, colorScheme: "dark" });
  const alice = "AliceJoker";
  const bob = "BobJoker";

  try {
    const start = await openTwoPlayerHub(host, guest, alice, bob);
    for (const variant of ["6 cartes", "Joker +"]) {
      await host.getByRole("button", { name: variant, exact: true }).click();
      await expect(guest.getByRole("button", { name: variant, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    await start.click();
    await expectLocalTurn(guest, 20_000);
    await playSpecialCard(guest, 1, "Joker+");

    const panel = guest.locator('.turn-panel[data-power="give-card"]');
    await expect(panel).toHaveText("Joker+Glisse sur un joueur.");
    await expect(panel.getByRole("heading", { name: "Pouvoir du Joker+" })).toHaveCSS("color", "rgb(36, 25, 12)");
    await expect(panel.getByText("Glisse sur un joueur.", { exact: true })).toHaveCSS("color", "rgb(36, 25, 12)");
    await expect(guest.locator(".discard-slot .joker-face")).toHaveCSS("color", "rgb(36, 25, 12)");
    await expect(host.locator(".discard-slot .joker-face")).toHaveCSS("color", "rgb(36, 25, 12)");
    const firstLine = (await panel.locator(".power-heading").boundingBox())!;
    const secondLine = (await panel.locator(".power-controls p").boundingBox())!;
    const cancel = (await panel.getByRole("button", { name: "Passer le pouvoir" }).boundingBox())!;
    expect(firstLine.y + firstLine.height).toBeLessThan(secondLine.y);
    expect(cancel.x + cancel.width).toBeLessThan(firstLine.x);
    expect(secondLine.height).toBeCloseTo(firstLine.height, 0);
    await expect(guest.locator(".discard-cover")).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("04-pouvoir-joker-deux-lignes.png") });

    const recipient = guest.locator(".position-top");
    await expect(recipient.locator(".player-name")).toHaveText(alice);
    await expect(host.getByRole("button", { name: /^Donner une carte à / })).toHaveCount(0);
    await expect(guest.getByRole("button", { name: "Carte de la pioche à donner" })).toBeVisible();
    await expect(host.locator(".deck-slot")).toHaveCSS("animation-name", "gift-pulse");
    await expect(host.locator(".table-center .turn-panel")).toHaveCount(0);
    await expectTableFits(guest);
    await expectCenteredTurnPanel(guest);
    await host.setViewportSize({ width: 393, height: 702 });
    await host.screenshot({ path: testInfo.outputPath("01-joker-vu-par-adversaire.png") });
    const source = (await guest.locator(".deck-slot").boundingBox())!;
    const target = (await recipient.boundingBox())!;
    const session = await guest.context().newCDPSession(guest);
    const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [to] });
      await expect(guest.locator(".gift-drag-card")).toBeVisible();
      await expect(recipient).toHaveAttribute("data-drop-target", "true");
      await guest.screenshot({ path: testInfo.outputPath("03-joker-glisse-vers-joueur.png") });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } finally {
      await session.detach();
    }
    await expect(host.locator('[data-card-animation="gift"]')).toBeVisible();
    await expect(host.locator(".deck-slot")).not.toHaveAttribute("data-gift-pending");

    await expectLocalTurn(host);
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

test("le Joker+ ne propose pas le joueur qui a annoncé Dutch", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(55_000);
  await host.setViewportSize({ width: 390, height: 844 });
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL });
  const announcer = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceJokerDutch", "BobJokerDutch");
    await openLobby(announcer, "ChloeJokerDutch");
    await announcer.locator(".hub-item").filter({ hasText: "Hub de AliceJokerDutch" })
      .getByRole("button", { name: "Rejoindre", exact: true }).click();
    await expect(host.getByRole("list", { name: "Joueurs présents" })).toContainText("ChloeJokerDutch");
    await host.getByRole("button", { name: "Joker +", exact: true }).click();
    await expect(announcer.getByRole("button", { name: "Joker +", exact: true })).toHaveAttribute("aria-pressed", "true");
    await start.click();
    await expectLocalTurn(announcer, 20_000);
    await drawDeck(announcer).click();
    await announcer.getByRole("button", { name: "Annoncer Dutch en fin de tour" }).click();
    await discardDrawn(announcer);
    await playSpecialCard(host, 1, "Joker+");

    await expect(host.getByRole("img", { name: "ChloeJokerDutch a annoncé Dutch" })).toBeVisible();
    await expect(host.getByRole("button", { name: "Donner une carte à ChloeJokerDutch" })).toHaveCount(0);
    const recipient = host.getByRole("button", { name: "Donner une carte à BobJokerDutch" });
    await expect(recipient).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath("protection-dutch-joker.png") });
    await recipient.press("Enter");
    await expect(guest.locator(".position-bottom .playing-card")).toHaveCount(5);
    await expect(announcer.locator(".position-bottom .playing-card")).toHaveCount(4);
  } finally {
    await guest.close();
    await announcer.close();
  }
});

test("le chrono de consultation commence en haut sur les cartes latérales en paysage", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(40_000);
  await fixDeckOrder(host);
  const viewport = { width: 844, height: 390 };
  await host.setViewportSize(viewport);
  const guest = await browser.newPage({ baseURL, viewport });
  const last = await browser.newPage({ baseURL, viewport });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceCadran", "BobCadran");
    await openLobby(last, "ChloeCadran");
    await last.locator(".hub-item").filter({ hasText: "Hub de AliceCadran" })
      .getByRole("button", { name: "Rejoindre", exact: true }).click();
    await expect(host.getByRole("list", { name: "Joueurs présents" }).getByRole("listitem")).toHaveCount(3);
    await expect(start).toBeEnabled();
    await start.click();
    await expectLocalTurn(last, 18_000);
    await playSpecialCard(last, 2, "8");
    await targetCard(last, 1, "ChloeCadran").click();

    for (const [page, side] of [[host, "right"], [guest, "left"]] as const) {
      const card = page.locator(`.position-${side} [data-look-card]`);
      const clock = card.getByRole("progressbar", { name: "Temps de consultation de la carte" });
      await expectClockFromTop(clock);
      const frame = (await clock.boundingBox())!;
      const box = (await card.boundingBox())!;
      expect(frame.width).toBeGreaterThan(box.width);
      expect(frame.height).toBeGreaterThan(box.height);
      expect(frame.y + frame.height / 2).toBeCloseTo(box.y + box.height / 2, 0);
      await expect.poll(async () => Number(await clock.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(8);
      await page.screenshot({ path: testInfo.outputPath(`chrono-12h-${side}.png`) });
    }
  } finally {
    await Promise.all([guest.close(), last.close()]);
  }
});
