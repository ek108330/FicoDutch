import { expect, type Locator, type Page } from "@playwright/test";

export async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Paramètres du jeu" }).click();
  return page.getByRole("dialog", { name: "Paramètres du jeu" });
}

export function closeSettings(page: Page) {
  return page.getByRole("button", { name: "Fermer les paramètres" }).click();
}

export async function openManagement(page: Page) {
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Gérer la table", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Gérer la table");
  return dialog;
}

export async function expectScreenFits(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement!;
    return { horizontal: root.scrollWidth - window.innerWidth, vertical: root.scrollHeight - window.innerHeight };
  });
  expect(overflow.horizontal, "débordement horizontal").toBeLessThanOrEqual(1);
  expect(overflow.vertical, "débordement vertical").toBeLessThanOrEqual(1);
}

export async function openLobby(page: Page, pseudo: string) {
  await Promise.all([
    page.waitForEvent("console", (message) => message.text().startsWith("FicoDutch connecté au serveur")),
    page.goto("/"),
  ]);
  await page.getByRole("textbox", { name: "Pseudo" }).fill(pseudo);
}

export async function openTwoPlayerHub(host: Page, guest: Page, hostPseudo: string, guestPseudo: string) {
  await Promise.all([openLobby(host, hostPseudo), openLobby(guest, guestPseudo)]);
  await host.getByRole("button", { name: "Créer un Hub" }).click();
  const start = host.getByRole("button", { name: "Lancer la partie" });
  await expect(start).toBeDisabled();

  await guest.locator(".hub-item").filter({ hasText: `Hub de ${hostPseudo}` })
    .getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(guest.getByText("Salle d'attente")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Lancer la partie" })).toHaveCount(0);
  await expect(start).toBeEnabled({ timeout: 12_000 });
  return start;
}

export async function fixDeckOrder(host: Page) {
  // Conserve l'ordre des cartes et fait commencer le dernier joueur.
  await host.addInitScript(() => { Math.random = () => 0.999; });
}

export async function expectTableFits(page: Page) {
  const opponent = await page.locator(".position-top").boundingBox();
  const center = await page.locator(".table-center").boundingBox();
  const own = await page.locator(".position-bottom").boundingBox();
  expect(opponent).not.toBeNull();
  expect(center).not.toBeNull();
  expect(own).not.toBeNull();
  expect(opponent!.y + opponent!.height).toBeLessThan(center!.y);
  expect(center!.y + center!.height).toBeLessThan(own!.y);
  expect(own!.y + own!.height).toBeLessThan(page.viewportSize()!.height);
}

export const drawDeck = (page: Page) => page.getByRole("button", { name: "Piocher dans la pioche" });
export const drawnCard = (page: Page) => page.getByRole("img", { name: /^Carte tirée, / });
export const discard = (page: Page) => page.locator(".pile-slot").filter({ has: page.locator(".discard-slot") });
export const activeTurn = (page: Page) => page.getByRole("region", { name: "Tour de jeu" }).getByRole("status");
export const turnClock = (page: Page) => page.getByRole("progressbar", { name: "Temps restant" });

export async function expectClockFromTop(clock: Locator) {
  const progress = clock.locator("path.perimeter-clock-progress");
  await expect(progress).toHaveAttribute("d", /^M /);
  const { center, startX, startY, nextX, nextY } = await progress.evaluate((element: SVGPathElement) => {
    const { x: startX, y: startY } = element.getPointAtLength(0);
    const { x: nextX, y: nextY } = element.getPointAtLength(2);
    return { center: element.ownerSVGElement!.clientWidth / 2, startX, startY, nextX, nextY };
  });
  expect(Math.abs(startX - center)).toBeLessThan(1);
  expect(startY).toBeCloseTo(1.5);
  expect(nextX).toBeGreaterThan(startX);
  expect(nextY).toBeCloseTo(startY);
}

export async function expectCenteredTurnPanel(page: Page) {
  const panel = page.locator(".turn-panel[data-local-turn]");
  await expect(panel).toHaveCSS("background-color", "rgb(243, 222, 154)");
  const [text, piles, ownName] = await Promise.all([
    panel.boundingBox(), page.locator(".turn-layout .table-piles").boundingBox(), page.locator(".position-bottom .player-name").boundingBox(),
  ]);
  expect(text!.y - piles!.y - piles!.height).toBeGreaterThanOrEqual(9);
  expect(text!.y + text!.height).toBeLessThanOrEqual(ownName!.y);
  expect(text!.x + text!.width / 2).toBeCloseTo(piles!.x + piles!.width / 2, 0);
  const overlap = await page.locator(".table-player:not(.position-bottom)").evaluateAll((seats, box) =>
    seats.some((seat) => {
      const { left, top, right, bottom } = seat.getBoundingClientRect();
      return left < box.x + box.width && right > box.x && top < box.y + box.height && bottom > box.y;
    }), text!);
  expect(overlap).toBe(false);
}

export async function discardDrawn(page: Page) {
  const card = drawnCard(page);
  await card.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const from = (await card.boundingBox())!;
  const to = (await page.locator(".discard-slot").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(card).toHaveCount(0);
}

export async function expectLocalTurn(page: Page, timeout?: number) {
  const pseudo = (await page.locator(".position-bottom .player-name").innerText()).replace(/ \(Moi\)$/, "");
  await expect(activeTurn(page)).toHaveText(`${pseudo} joue`, { timeout });
}
