import { expect, test, type Page } from "@playwright/test";
import { activeTurn, closeSettings, discard, drawDeck, expectTableFits, fixDeckOrder, openSettings, openTwoPlayerHub } from "./tableFlow";

const reactButton = (page: Page) => page.getByRole("button", { name: "Réagir", exact: true });
const ownCards = (page: Page) => page.locator(".position-bottom .playing-card");

async function react(page: Page, position: number) {
  await reactButton(page).click();
  await page.getByRole("button", { name: `Poser la carte ${position} en réaction`, exact: true }).click();
}

async function openReactionRound(host: Page, guest: Page, hostName: string, guestName: string, infinite = false) {
  await fixDeckOrder(host);
  const start = await openTwoPlayerHub(host, guest, hostName, guestName);
  const variants = infinite ? ["+1 / -1", "Pose infinie"] : ["+1 / -1"];
  const hostSettings = await openSettings(host);
  const guestSettings = await openSettings(guest);
  for (const variant of variants) {
    await hostSettings.getByRole("button", { name: variant, exact: true }).click();
    await expect(guestSettings.getByRole("button", { name: variant, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await Promise.all([closeSettings(host), closeSettings(guest)]);
  await start.click();
  await expect(activeTurn(guest)).toHaveText("À toi de jouer", { timeout: 17_000 });
  await expect(reactButton(guest)).toHaveCount(0);
  await drawDeck(guest).click();
  await guest.getByRole("button", { name: "Défausser la carte tirée" }).click();
  await expect(discard(host)).toHaveAccessibleName("Défausse, 5 de pique");
}

test("réaction adjacente, pénalité et fin de manche", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(55_000);
  const guest = await browser.newPage({ baseURL });
  try {
    await openReactionRound(host, guest, "AliceReflexe", "BobReflexe");

    await react(host, 1);
    await expect(host.getByText("AliceReflexe reçoit une carte de pénalité.")).toBeVisible();
    await expect(ownCards(host)).toHaveCount(5);
    await expect(ownCards(host).nth(4)).toHaveAttribute("aria-label", "Carte 5 face cachée");
    await expect(discard(guest)).toHaveAccessibleName("Défausse, 5 de pique");
    await expectTableFits(host);
    await host.screenshot({ path: testInfo.outputPath("01-penalite-ordinateur.png") });

    await guest.setViewportSize({ width: 390, height: 844 });
    await reactButton(guest).click();
    const sixth = guest.getByRole("button", { name: "Poser la carte 4 en réaction", exact: true });
    await expect(sixth).toBeVisible();
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("02-choix-portrait.png") });
    await sixth.click();
    await expect(ownCards(guest)).toHaveCount(3);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 6 de pique");
    await expect(reactButton(guest)).toHaveCount(0);

    await react(host, 4);
    await expect(discard(guest)).toHaveAccessibleName("Défausse, 7 de pique");
    await react(guest, 3);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 8 de pique");
    await expect(activeTurn(host)).toHaveText("À toi de jouer");
    await expect(activeTurn(guest)).toHaveText("Au tour de AliceReflexe");
    await guest.setViewportSize({ width: 844, height: 390 });
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("03-chaine-paysage.png") });

    await react(host, 3);
    await expect(discard(guest)).toHaveAccessibleName("Défausse, 9 de pique");
    await react(guest, 2);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 10 de pique");
    await react(host, 2);
    await expect(discard(guest)).toHaveAccessibleName("Défausse, Valet de pique");
    await react(guest, 1);

    for (const page of [host, guest]) {
      await expect(page.getByRole("heading", { name: "Fin de la manche" })).toBeVisible();
      await expect(page.getByText("BobReflexe remporte la manche.")).toBeVisible();
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
    await expect(reactButton(guest)).toBeEnabled();
    await expectTableFits(guest);
    await guest.screenshot({ path: testInfo.outputPath("01-pose-infinie.png") });
  } finally {
    await guest.close();
  }
});
