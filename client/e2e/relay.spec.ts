import { expect, test } from "@playwright/test";
import { discard, drawDeck, drawnCard, fixDeckOrder, openTwoPlayerHub, expectLocalTurn } from "./tableFlow";

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
    await expectLocalTurn(guest, 18_000);
    await expect(guest.locator(".deck-slot .card-back-pattern")).toBeVisible();
    await expect(guest.locator(".deck-slot")).not.toContainText(/\d/);
    await drawDeck(guest).click();
    await expect(drawnCard(guest)).toHaveAccessibleName("Carte tirée, 5 de pique");
    await expect(drawnCard(host)).toHaveCount(0);
    await expect(guest.locator(".table-piles .drawn-card")).toHaveCount(0);
    await expect(guest.locator(".position-bottom .drawn-card")).toHaveAttribute("data-animated", "true");
    expect(await drawnCard(guest).evaluate((element) => getComputedStyle(element).animationName)).toBe("draw-travel");
    expect(await drawnCard(guest).locator(".drawn-card-turn").evaluate((element) => getComputedStyle(element).animationName)).toBe("draw-flip");
    const hand = (await guest.locator(".position-bottom .player-cards").boundingBox())!;
    await expect.poll(async () => (await drawnCard(guest).boundingBox())!.x).toBeGreaterThan(hand.x + hand.width);
    await drawnCard(guest).locator(".drawn-card-turn").evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await guest.screenshot({ path: testInfo.outputPath("03-carte-tiree-a-droite.png") });
    await guest.getByRole("button", { name: "Défausser la carte tirée" }).click();
    await expectLocalTurn(host);
    await expect(discard(host)).toHaveAccessibleName("Défausse, 5 de pique");
    await discard(host).click();
    await expect(drawnCard(host)).toHaveCount(0);
    await expect(drawDeck(host)).toBeEnabled();
    await host.setViewportSize({ width: 740, height: 360 });
    const pile = (await host.locator(".discard-slot").boundingBox())!;
    const name = (await host.locator(".position-bottom .player-name").boundingBox())!;
    expect(pile.y + pile.height + 7).toBeLessThan(name.y);
    await host.screenshot({ path: testInfo.outputPath("04-tour-paysage-compact.png") });
    expect(received.some((frame) => frame.includes('"ciphertext"'))).toBe(true);
    expect(received.every((frame) => !frame.includes('"drawnCard"') && !frame.includes('"round-view"'))).toBe(true);
  } finally {
    await guest.close();
  }
});
