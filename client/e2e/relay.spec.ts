import { expect, test } from "@playwright/test";
import { activeTurn, discard, drawDeck, drawnCard, fixDeckOrder, openTwoPlayerHub } from "./tableFlow";

test("la partie démarre avec le relais quand la liaison directe ne répond pas", async ({ page: host, browser, baseURL }, testInfo) => {
  test.setTimeout(60_000);
  await fixDeckOrder(host);
  const guest = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 } });
  const received: string[] = [];
  guest.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload === "string" && payload.includes('"hub:peer-relay"')) received.push(payload);
    });
  });
  try {
    await guest.addInitScript(() => {
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        createOffer(): Promise<RTCSessionDescriptionInit> {
          return new Promise(() => {});
        }
      };
    });
    const start = await openTwoPlayerHub(host, guest, "AliceRelais", "BobRelais");
    for (const page of [host, guest]) await expect(page.getByText("Le relais chiffré est actif.")).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("01-relais-actif-portrait.png"), fullPage: true });
    await start.click();
    await guest.getByRole("button", { name: "Carte 1 face cachée", exact: true }).click();
    await expect(guest.locator(".position-bottom .playing-card.face-up")).toHaveCount(1);
    await expect(host.locator(".position-top .playing-card.face-up")).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("02-carte-privee-portrait.png") });
    await expect(activeTurn(guest)).toHaveText("À toi de jouer", { timeout: 18_000 });
    await drawDeck(guest).click();
    await expect(drawnCard(guest)).toHaveAccessibleName("Carte tirée, 5 de pique");
    await guest.getByRole("button", { name: "Défausser la carte tirée" }).click();
    await expect(activeTurn(host)).toHaveText("À toi de jouer");
    await expect(discard(host)).toHaveAccessibleName("Défausse, 5 de pique");
    await discard(host).click();
    await expect(drawnCard(host)).toHaveCount(0);
    await expect(drawDeck(host)).toBeEnabled();
    expect(received.some((frame) => frame.includes('"ciphertext"'))).toBe(true);
    expect(received.every((frame) => !frame.includes('"drawnCard"') && !frame.includes('"round-view"'))).toBe(true);
  } finally {
    await guest.close();
  }
});
