import { expect, test, type Page } from "@playwright/test";
import { drawDeck, expectScreenFits, fixDeckOrder, openLobby, openTwoPlayerHub, expectLocalTurn } from "./tableFlow";

const chat = (page: Page) => page.getByRole("region", { name: "Chat du Hub" });
const messages = (page: Page) => page.getByRole("log", { name: "Messages du Hub" });
const emoji = (page: Page, label: string) => page.getByRole("button", { name: `Envoyer l’emoji ${label}` });
const bubble = (page: Page, label: string) => page.getByRole("status", { name: label });
const tableEmojis = (page: Page) => page.getByRole("group", { name: "Emojis de la table" });

async function expectToolbarBelowTable(page: Page) {
  const board = (await page.locator(".game-table").boundingBox())!;
  const toolbar = (await tableEmojis(page).boundingBox())!;
  expect(toolbar.y).toBeGreaterThan(board.y + board.height);
  await expect(tableEmojis(page)).toBeInViewport({ ratio: 1 });
  await expectScreenFits(page);
}

test("le chat reste dans le lobby de son Hub et les emojis de table disparaissent", async ({
  page: host, browser, baseURL,
}, testInfo) => {
  test.setTimeout(55_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 } });
  const newcomer = await browser.newPage({ baseURL });
  try {
    const start = await openTwoPlayerHub(host, guest, "AliceChat", "BobChat");
    await openLobby(newcomer, "ChloeChat");
    await newcomer.getByRole("button", { name: "Créer un Hub" }).click();
    await expect(chat(newcomer)).toBeVisible();

    const input = chat(guest).getByRole("textbox", { name: "Message du Hub" });
    const content = "<b>Salut tout le monde !</b>";
    await input.fill(content);
    await input.press("Enter");
    await expect(messages(host)).toContainText(content);
    await expect(messages(host)).toContainText("BobChat");
    await expect(messages(host).locator("b")).toHaveCount(0);
    await expect(input).toHaveValue("");
    await input.fill("Message trop rapide");
    await input.press("Enter");
    const emojiPicker = host.getByRole("button", { name: "Émojis du Hub" });
    const emojiOptions = host.getByRole("group", { name: "Choisir un émoji" });
    const logHeight = (await messages(host).boundingBox())!.height;
    await expect(emojiOptions).not.toBeVisible();
    await emojiPicker.click();
    await expect(emojiOptions.getByRole("button")).toHaveCount(9);
    expect((await messages(host).boundingBox())!.height).toBe(logHeight);
    await host.screenshot({ path: testInfo.outputPath("00-selecteur-emojis-hub.png") });
    await emoji(host, "Salut").click();
    await expect(emojiOptions).not.toBeVisible();
    await expect(messages(guest).getByRole("img", { name: "Salut" })).toBeVisible();
    await expect(messages(guest)).toContainText("AliceChat");
    await expect(messages(host)).not.toContainText("Message trop rapide");
    await expect(chat(guest).getByRole("status")).toHaveCount(0);
    await expect(input).toHaveValue("Message trop rapide");
    await input.clear();
    await expect(messages(newcomer)).toHaveText("Aucun message pour le moment.");
    await chat(guest).screenshot({ path: testInfo.outputPath("01-chat-lobby-portrait.png") });

    await newcomer.getByRole("button", { name: "Annuler", exact: true }).click();
    await newcomer.locator(".hub-item").filter({ hasText: "Hub de AliceChat" })
      .getByRole("button", { name: "Rejoindre", exact: true }).click();
    await expect(messages(newcomer)).toHaveText("Aucun message pour le moment.");
    await expect(messages(host)).toContainText(content);
    await expect(host.getByRole("list", { name: "Joueurs présents" }).getByRole("listitem")).toHaveCount(3);

    await start.click();
    await expectLocalTurn(newcomer, 19_000);
    for (const page of [host, guest, newcomer]) {
      await expect(chat(page)).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Message du Hub" })).toHaveCount(0);
    }
    await expect(tableEmojis(host).getByRole("button")).toHaveCount(9);
    await guest.setViewportSize({ width: 320, height: 620 });
    await expect(tableEmojis(guest)).toBeInViewport({ ratio: 1 });
    for (const label of ["En pleurs", "Furieux", "Yeux en cœur", "Chut"]) {
      await expect(emoji(guest, label)).toBeInViewport({ ratio: 1 });
    }
    await guest.screenshot({ path: testInfo.outputPath("09-emojis-portrait.png") });
    await expectToolbarBelowTable(guest);
    await emoji(host, "Bravo").click();
    const reaction = bubble(guest, "AliceChat · Bravo");
    await expect(reaction).toBeVisible();
    const visibleSince = Date.now();
    await expect(bubble(newcomer, "AliceChat · Bravo")).toBeVisible();
    await expect(reaction).toHaveCSS("animation-name", "table-emoji-zoom");
    await reaction.evaluate(async (element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const placement = await reaction.evaluate((element) => {
      const emojiBox = element.getBoundingClientRect();
      const name = element.closest(".player-name")!.getBoundingClientRect();
      return { gap: emojiBox.top - name.bottom, offset: emojiBox.x + emojiBox.width / 2 - name.x - name.width / 2 };
    });
    expect(placement.gap).toBeGreaterThanOrEqual(0);
    expect(placement.offset).toBeCloseTo(0, 0);
    await guest.screenshot({ path: testInfo.outputPath("02-reaction-table-portrait.png") });
    await expect(reaction).toHaveCount(0, { timeout: 6_000 });
    expect(Date.now() - visibleSince).toBeGreaterThan(4_500);

    await guest.setViewportSize({ width: 844, height: 390 });
    await expectToolbarBelowTable(guest);
    await expect(tableEmojis(guest).getByRole("button", { name: "Envoyer l’emoji Cœur" })).toBeInViewport();
    await guest.screenshot({ path: testInfo.outputPath("03-choix-emojis-paysage.png") });
    await emoji(guest, "Chut").click();
    await expect(bubble(host, "BobChat · Chut")).toBeVisible();
    await expect(bubble(newcomer, "BobChat · Chut")).toBeVisible();
    await expect(drawDeck(newcomer)).toBeEnabled();
  } finally {
    await Promise.all([guest.close(), newcomer.close()]);
  }
});
