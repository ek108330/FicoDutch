import { expect, type Page } from "@playwright/test";

export async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Paramètres du jeu" }).click();
  return page.getByRole("dialog", { name: "Paramètres du jeu" });
}

export function closeSettings(page: Page) {
  return page.getByRole("button", { name: "Fermer les paramètres" }).click();
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
  await page.getByRole("textbox", { name: "Choisis ton pseudo" }).fill(pseudo);
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
export const discard = (page: Page) => page.getByRole("img", { name: /^Défausse, / });
export const activeTurn = (page: Page) => page.getByRole("region", { name: "Tour de jeu" }).getByRole("status");
