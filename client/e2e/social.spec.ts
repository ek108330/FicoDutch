import { expect, test, type Page } from "@playwright/test";
import { drawDeck, fixDeckOrder, openLobby, openTwoPlayerHub, expectLocalTurn } from "./tableFlow";

const chat = (page: Page) => page.getByRole("region", { name: "Chat du Hub" });
const messages = (page: Page) => page.getByRole("log", { name: "Messages du Hub" });
const emoji = (page: Page, label: string) => page.getByRole("button", { name: `Envoyer l’emoji ${label}` });
const bubble = (page: Page, label: string) => page.getByRole("status", { name: label });
const tableEmojis = (page: Page) => page.getByRole("group", { name: "Emojis de la table" });

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
    await emoji(host, "Salut").click();
    await expect(messages(guest).getByRole("img", { name: "Salut" })).toBeVisible();
    await expect(messages(guest)).toContainText("AliceChat");
    await expect(messages(newcomer)).toHaveText("Aucun message pour le moment.");
    await chat(guest).screenshot({ path: testInfo.outputPath("01-chat-lobby-portrait.png") });

    await newcomer.getByRole("button", { name: "Quitter le Hub" }).click();
    await newcomer.locator(".hub-item").filter({ hasText: "Hub de AliceChat" })
      .getByRole("button", { name: "Rejoindre", exact: true }).click();
    await expect(messages(newcomer)).toHaveText("Aucun message pour le moment.");
    await expect(messages(host)).toContainText(content);
    await expect(host.getByText("3/6 joueurs", { exact: true })).toBeVisible();

    await start.click();
    await expectLocalTurn(newcomer, 19_000);
    for (const page of [host, guest, newcomer]) {
      await expect(chat(page)).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Message du Hub" })).toHaveCount(0);
    }
    await expect(tableEmojis(host).getByRole("button")).toHaveCount(5);
    await emoji(host, "Bravo").click();
    await expect(guest.locator(".table-player").filter({ hasText: "AliceChat" })
      .getByRole("status", { name: "AliceChat · Bravo" })).toBeVisible();
    await expect(bubble(newcomer, "AliceChat · Bravo")).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("02-reaction-table-portrait.png") });
    await expect(bubble(guest, "AliceChat · Bravo")).toHaveCount(0);

    await guest.setViewportSize({ width: 844, height: 390 });
    await expect(tableEmojis(guest).getByRole("button", { name: "Envoyer l’emoji Cœur" })).toBeInViewport();
    await guest.screenshot({ path: testInfo.outputPath("03-choix-emojis-paysage.png") });
    await emoji(guest, "Cœur").click();
    await expect(bubble(host, "BobChat · Cœur")).toBeVisible();
    await expect(bubble(newcomer, "BobChat · Cœur")).toBeVisible();
    await expect(drawDeck(newcomer)).toBeEnabled();
  } finally {
    await Promise.all([guest.close(), newcomer.close()]);
  }
});
