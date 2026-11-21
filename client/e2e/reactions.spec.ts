import { expect, test, type Page } from "@playwright/test";
import { activeTurn, discard, drawDeck, drawnCard, expectTableFits, fixDeckOrder, openTwoPlayerHub, expectLocalTurn } from "./tableFlow";

const ownCards = (page: Page) => page.locator(".position-bottom .playing-card");
const reactiveCards = (page: Page) => ownCards(page).and(page.locator("[data-reactable]"));

async function react(page: Page, position: number) {
  await ownCards(page).nth(position - 1).click({ clickCount: 3 });
}

async function dragCard(page: Page, index: number, towardCenter: boolean, screenshot?: string) {
  const card = ownCards(page).nth(index);
  const source = (await card.boundingBox())!;
  const discard = (await page.locator(".discard-slot").boundingBox())!;
  const x = source.x + source.width / 2;
  const y = source.y + source.height / 2;
  const endX = towardCenter ? discard.x + discard.width / 2 : x + 55;
  const endY = towardCenter ? discard.y + discard.height / 2 : y + 10;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    const halfway = { x: (x + endX) / 2, y: (y + endY) / 2 };
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [halfway] });
    await expect(card).toHaveClass(/is-dragging/);
    const moved = (await card.boundingBox())!;
    expect(Math.abs(moved.x - source.x - halfway.x + x)).toBeLessThan(3);
    expect(Math.abs(moved.y - source.y - halfway.y + y)).toBeLessThan(3);
    if (screenshot) await page.screenshot({ path: screenshot });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: endX, y: endY }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function openReactionRound(host: Page, guest: Page, hostName: string, guestName: string, infinite = false) {
  await fixDeckOrder(host);
  const start = await openTwoPlayerHub(host, guest, hostName, guestName);
  const variants = infinite ? ["+1 / -1", "Pose infinie"] : ["+1 / -1"];
  for (const variant of variants) {
    await host.getByRole("button", { name: variant, exact: true }).click();
    await expect(guest.getByRole("button", { name: variant, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await start.click();
  await expectLocalTurn(guest, 17_000);
  await expect(reactiveCards(guest)).toHaveCount(0);
  await drawDeck(guest).click();
  await guest.getByRole("button", { name: "Défausser la carte tirée" }).click();
  await expect(discard(host)).toHaveAccessibleName("Défausse, 5 de pique");
}

test("réaction adjacente, pénalité et fin de manche", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(55_000);
  const guest = await browser.newPage({ baseURL, hasTouch: true });
  try {
    await openReactionRound(host, guest, "AliceReflexe", "BobReflexe");

    await react(host, 1);
    await expect(host.locator('[data-card-animation="reaction"]')).toHaveCount(1);
    await expect(guest.locator('[data-card-animation="penalty"]')).toHaveCount(1);
    await expect(host.locator('[data-card-animation="penalty"] .card-face')).toHaveCount(0);
    await host.screenshot({ path: testInfo.outputPath("06-reaction-triple-appui.png") });
    await expect(host.getByText("AliceReflexe reçoit une carte de pénalité.")).toBeVisible();
    await expect(ownCards(host)).toHaveCount(5);
    await expect(ownCards(host).nth(4)).toHaveAttribute("data-hand-slot", "4");
    await expect(ownCards(host).nth(4)).toHaveAttribute("aria-label", "Carte 5 face cachée");
    await expect(discard(guest)).toHaveAccessibleName("Défausse, 5 de pique");
    await expectTableFits(host);
    await host.screenshot({ path: testInfo.outputPath("01-penalite-ordinateur.png") });

    await guest.setViewportSize({ width: 390, height: 844 });
    await expect(reactiveCards(guest)).toHaveCount(4);
    await expectTableFits(guest);
    await dragCard(guest, 3, false);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 5 de pique");
    await expect(ownCards(guest)).toHaveCount(4);
    await expect.poll(() => ownCards(guest).nth(3).evaluate((card) => card.getAnimations().length)).toBe(0);
    const fixedSlot = guest.locator('.position-bottom [data-hand-slot="2"]');
    const originalSlot = (await fixedSlot.boundingBox())!;
    await host.setViewportSize({ width: 390, height: 844 });
    const opponentCard = (await host.locator('.position-top [data-hand-slot="3"]').boundingBox())!;
    await dragCard(guest, 3, true, testInfo.outputPath("02-carte-glissee-portrait.png"));
    const opponentFlight = host.locator('[data-card-animation="reaction-discard"]');
    await expect(opponentFlight.locator(".card-face b")).toHaveText("6");
    const startX = await opponentFlight.evaluate((card: HTMLElement) => Number.parseFloat(card.style.left));
    expect(startX).toBeCloseTo(opponentCard.x, 1);
    await opponentFlight.evaluate((card) => {
      const animation = card.getAnimations()[0];
      animation.pause();
      animation.currentTime = 320;
    });
    await host.screenshot({ path: testInfo.outputPath("07-reaction-vue-adversaire.png") });
    await opponentFlight.evaluate((card) => card.getAnimations()[0].play());
    await expect(ownCards(guest)).toHaveCount(3);
    const retainedSlot = (await fixedSlot.boundingBox())!;
    expect(retainedSlot.x).toBeCloseTo(originalSlot.x, 1);
    expect(retainedSlot.y).toBeCloseTo(originalSlot.y, 1);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 6 de pique");
    await expect(host.locator(".discard-slot")).toHaveAttribute("data-stacked", "true");
    await expect(reactiveCards(guest)).toHaveCount(0);

    await react(host, 4);
    await expect(discard(guest)).toHaveAccessibleName("Défausse, 7 de pique");
    await react(guest, 3);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 8 de pique");
    await expectLocalTurn(host);
    await expect(activeTurn(guest)).toHaveText("AliceReflexe joue");
    await guest.setViewportSize({ width: 844, height: 390 });
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("03-chaine-paysage.png") });

    await react(host, 3);
    await expect(discard(guest)).toHaveAccessibleName("Défausse, 9 de pique");
    await react(guest, 2);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 10 de pique");
    await react(host, 2);
    await expect(discard(guest)).toHaveAccessibleName("Défausse, Valet de pique");
    const last = (await ownCards(guest).first().boundingBox())!;
    for (let i = 0; i < 3; i++) await guest.touchscreen.tap(last.x + last.width / 2, last.y + last.height / 2);
    await expect(opponentFlight.locator(".card-face b").filter({ hasText: /^Q$/ })).toHaveCount(1);

    for (const page of [host, guest]) {
      await expect(page.getByRole("heading", { name: "Manche 1", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de BobReflexe" }).getByRole("img", { name: "Manche remportée" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de AliceReflexe" }).getByText("4 points")).toBeVisible();
      await expect(page.getByRole("region", { name: "Main de BobReflexe" }).getByText("0 point")).toBeVisible();
      await expect(page.locator(".result-cards .face-up")).toHaveCount(2);
    }
    await host.screenshot({ path: testInfo.outputPath("04-fin-de-manche.png") });
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.screenshot({ path: testInfo.outputPath("05-fin-de-manche-portrait.png") });
  } finally {
    await guest.close();
  }
});

test("pose infinie autorise deux réactions de suite", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(45_000);
  const guest = await browser.newPage({ baseURL });
  try {
    await openReactionRound(host, guest, "AliceInfini", "BobInfini", true);

    await react(guest, 1);
    await expect(ownCards(guest)).toHaveCount(5);
    await react(guest, 1);
    await expect(ownCards(guest)).toHaveCount(6);

    await react(guest, 5);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 4 de pique");
    await expect(ownCards(guest)).toHaveCount(5);
    await react(guest, 5);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 3 de pique");
    await expect(ownCards(guest)).toHaveCount(4);
    await expect(guest.getByText("BobInfini a réagi.")).toBeVisible();
    await expect(reactiveCards(guest)).toHaveCount(4);
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("01-pose-infinie.png") });
  } finally {
    await guest.close();
  }
});

test("trois appuis réagissent sans remplacer la carte tirée et un clic simple la remplace", async ({ page: host, browser, baseURL }) => {
  const guest = await browser.newPage({ baseURL });
  try {
    await openReactionRound(host, guest, "Alice3Appuis", "Bob3Appuis");
    await drawDeck(host).click();
    await expect(drawnCard(host)).toHaveAccessibleName("Carte tirée, 4 de pique");
    await react(host, 1);
    await expect(ownCards(host)).toHaveCount(5);
    await expect(drawnCard(host)).toHaveAccessibleName("Carte tirée, 4 de pique");
    await host.getByRole("button", { name: "Remplacer la carte 1", exact: true }).click();
    await expect(drawnCard(host)).toHaveCount(0);
    await expect(discard(guest)).toHaveAccessibleName("Défausse, Roi de pique");
  } finally {
    await guest.close();
  }
});
