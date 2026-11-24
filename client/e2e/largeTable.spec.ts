import { expect, test, type Page } from "@playwright/test";
import { discardDrawn, activeTurn, drawDeck, expectScreenFits, fixDeckOrder, openLobby, openTwoPlayerHub,
  expectLocalTurn, expectCenteredTurnPanel } from "./tableFlow";

const viewports = [
  { name: "ordinateur", width: 1280, height: 800 },
  { name: "portrait", width: 390, height: 844 },
  { name: "portrait-android", width: 393, height: 702 },
  { name: "portrait-compact", width: 360, height: 640 },
  { name: "paysage", width: 844, height: 390 },
];

async function expectClockwiseOrder(page: Page, order: string[], ownIndex: number) {
  const clockwise = await page.locator(".game-table").evaluate((table) => {
    const { x, y, width, height } = table.getBoundingClientRect();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const seats = Array.from(table.querySelectorAll(".table-player"), (seat) => {
      const box = seat.getBoundingClientRect();
      const angle = Math.atan2(centerX - (box.x + box.width / 2), box.y + box.height / 2 - centerY);
      return { own: seat.classList.contains("position-bottom"), angle: (angle + 2 * Math.PI) % (2 * Math.PI),
        name: seat.querySelector(".player-name-label")!.textContent!.replace(/ \(Moi\)$/, "") };
    });
    return seats.sort((a, b) => Number(b.own) - Number(a.own) || a.angle - b.angle).map(({ name }) => name);
  });
  expect(clockwise).toEqual([...order.slice(ownIndex), ...order.slice(0, ownIndex)]);
}

async function checkSeats(page: Page, count: number, cards: number) {
  const table = page.locator(`.game-table[data-player-count="${count}"]`);
  await expect(table).toBeVisible();
  await expectScreenFits(page);
  await expect(table.locator(".position-bottom .playing-card")).toHaveCount(cards);
  const boxes = await table.locator(".table-player, .table-center").evaluateAll((items) =>
    items.map((node) => {
      const { left, right, top, bottom } = node.getBoundingClientRect();
      return { label: node.className, left, right, top, bottom };
    }));
  expect(boxes).toHaveLength(count + 1);
  const tableBox = (await table.boundingBox())!;
  const toolbar = (await page.getByRole("group", { name: "Emojis de la table" }).boundingBox())!;
  expect(toolbar.y).toBeGreaterThan(tableBox.y + tableBox.height);
  for (const [index, box] of boxes.entries()) {
    expect(box.left, box.label).toBeGreaterThanOrEqual(tableBox.x);
    expect(box.right, box.label).toBeLessThanOrEqual(tableBox.x + tableBox.width);
    expect(box.bottom, box.label).toBeLessThanOrEqual(tableBox.y + tableBox.height);
    for (const other of boxes.slice(index + 1)) {
      const overlap = box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
      expect(overlap, `${box.label} / ${other.label}`).toBe(false);
    }
  }
  const hands = await table.locator(".player-cards").evaluateAll((items) => items.map((hand) => {
    const cards = [...hand.querySelectorAll(".playing-card")];
    const rows = new Set(cards.map((card) => (card as HTMLElement).offsetTop)).size;
    const rects = cards.map((card) => card.getBoundingClientRect());
    const style = getComputedStyle(cards[0]);
    return { rows, minWidth: Math.min(...rects.map(({ width }) => width)), ratios: rects.map(({ width, height }) => width / height),
      opponent: !hand.closest(".position-bottom"), border: Number.parseFloat(style.borderTopWidth),
      corner: style.borderTopLeftRadius.split(" ").map(Number.parseFloat) };
  }));
  for (const hand of hands) {
    expect(hand.rows).toBe(2);
    expect(hand.minWidth).toBeGreaterThanOrEqual(24);
    for (const ratio of hand.ratios) expect(ratio).toBeCloseTo(63 / 88, 2);
    if (hand.opponent) expect(hand.border).toBe(1);
    expect(hand.corner[0]).toBeCloseTo(100 * 3 / 63, 2);
    expect(hand.corner[1]).toBeCloseTo(100 * 3 / 88, 2);
  }
  const { width, height } = page.viewportSize()!;
  if (width < height) {
    if (count === 6) {
      const inset = await table.evaluate((element) => parseFloat(getComputedStyle(element).borderBottomWidth) + 3);
      const hand = (await table.locator(".position-bottom .player-cards").boundingBox())!;
      expect(hand.y + hand.height).toBeLessThanOrEqual(tableBox.y + tableBox.height - inset);
    }
    for (const seat of boxes) {
      if (seat.label.includes("position-left")) expect(seat.left - tableBox.x, seat.label).toBeLessThan(30);
      if (seat.label.includes("position-right")) expect(tableBox.x + tableBox.width - seat.right, seat.label).toBeLessThan(30);
    }
  }
}

for (const count of [4, 5, 6]) {
  for (const cards of [4, 6]) {
    test(`table à ${count} joueurs et ${cards} cartes sur trois formats`, async ({ page: host, browser, baseURL }, testInfo) => {
      test.setTimeout(75_000);
      await fixDeckOrder(host);
      const guests = await Promise.all(Array.from({ length: count - 1 }, () => browser.newPage({ baseURL })));
      const hostName = `Table${count}C${cards}`;
      const guestNames = guests.map((_, index) => `I${count}C${cards}J${index + 1}`);
      const joker = count === 6 && cards === 6;
      const seatsViewports = count === 6 ? [...viewports, { name: "portrait-320", width: 320, height: 568 }] : viewports;
      try {
        const start = await openTwoPlayerHub(host, guests[0], hostName, guestNames[0]);
        for (const [index, guest] of guests.slice(1).entries()) {
          await openLobby(guest, guestNames[index + 1]);
          await guest.locator(".hub-item").filter({ hasText: `Hub de ${hostName}` })
            .getByRole("button", { name: "Rejoindre" }).click();
          await expect(guest.getByText("Salle d'attente")).toBeVisible();
        }
        if (cards === 6) {
          await host.getByRole("button", { name: "6 cartes", exact: true }).click();
          if (joker) await host.getByRole("button", { name: "Joker +", exact: true }).click();
        }
        await expect(host.getByText(`${count}/6 joueurs`, { exact: true })).toBeVisible();
        if (joker) {
          for (const [width, height] of [[360, 640], [740, 360]]) {
            await host.setViewportSize({ width, height });
            await expectScreenFits(host);
            await expect(host.getByRole("list", { name: "Joueurs présents" }).getByText(guestNames.at(-1)!, { exact: true })).toBeInViewport({ ratio: 1 });
            await expect(host.getByRole("textbox", { name: "Message du Hub" })).toBeInViewport({ ratio: 1 });
            await expect(start).toBeInViewport({ ratio: 1 });
            await host.screenshot({ path: testInfo.outputPath(`hub-${width}.png`) });
          }
        }
        if (count === 4 && cards === 4) {
          await host.setViewportSize({ width: 393, height: 702 });
          await start.click();
          await expect(host.getByRole("region", { name: "Mémorisation" })).toBeVisible();
          await expect(host.getByRole("button", { name: "Gérer la table" })).toHaveCount(0);
          await checkSeats(host, count, cards);
          await host.screenshot({ path: testInfo.outputPath("memorisation-portrait-android.png"), fullPage: true });
        } else await start.click();
        const last = guests.at(-1)!;
        await expectLocalTurn(last, 21_000);
        const order = [hostName, ...guestNames];
        await Promise.all([host, ...guests].map((page, ownIndex) => expectClockwiseOrder(page, order, ownIndex)));
        for (const { name, width, height } of seatsViewports) {
          await last.setViewportSize({ width, height });
          await checkSeats(last, count, cards);
          await expectClockwiseOrder(last, order, count - 1);
          await expect(drawDeck(last)).toBeEnabled();
          await last.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
        }
        if (!joker) return;

        await drawDeck(last).click();
        await last.getByRole("button", { name: "Annoncer Dutch en fin de tour" }).click();
        await discardDrawn(last);
        await expectLocalTurn(host);
        await host.setViewportSize({ width: 320, height: 568 });
        const opponents = host.locator(".table-player:not(.position-bottom) .player-cards");
        const handPositions = () => opponents.evaluateAll((hands) => hands.map((hand) => hand.getBoundingClientRect().toJSON()));
        const beforePower = await handPositions();
        await drawDeck(host).click();
        await host.getByRole("button", { name: "Remplacer la carte 1", exact: true }).click();
        await expect(host.getByRole("heading", { name: "Pouvoir du Joker+" })).toBeVisible();
        await expectCenteredTurnPanel(host);
        expect(await handPositions()).toEqual(beforePower);
        await expectScreenFits(host);
        await expect(host.locator('[data-card-animation="discard"]')).toHaveCount(0);
        await host.screenshot({ path: testInfo.outputPath("joker-consigne-centree-320.png") });
        await host.setViewportSize({ width: 740, height: 360 });
        await expectCenteredTurnPanel(host);
        await host.screenshot({ path: testInfo.outputPath("joker-consigne-centree-740.png") });
        await host.getByRole("button", { name: "Carte de la pioche à donner" }).press("Enter");
        await expect(host.getByRole("button", { name: `Donner une carte à ${guestNames.at(-1)}`, exact: true })).toHaveCount(0);
        await host.getByRole("button", { name: `Donner une carte à ${guestNames[0]}`, exact: true }).press("Enter");
        const recipient = guests[0];
        for (const { name, width, height } of seatsViewports) {
          await recipient.setViewportSize({ width, height });
          await checkSeats(recipient, 6, 7);
          await recipient.screenshot({ path: testInfo.outputPath(`${name}-joker.png`), fullPage: true });
        }
        for (const guest of guests.slice(0, -1)) {
          await expectLocalTurn(guest);
          const label = await activeTurn(guest).textContent();
          await drawDeck(guest).click();
          await discardDrawn(guest);
          const pass = guest.getByRole("button", { name: "Passer le pouvoir" });
          await expect.poll(async () => (await activeTurn(guest).allTextContents())[0] !== label || await pass.isVisible()).toBe(true);
          if (await pass.isVisible()) await pass.click();
        }

        await expect(host.locator(".result-screen").getByRole("heading", { name: "Manche 1" })).toBeVisible();
        for (const [width, height] of [[320, 568], [740, 360]]) {
          await host.setViewportSize({ width, height });
          const hands = host.getByRole("region", { name: /^Main de / });
          await expect(hands).toHaveCount(6);
          for (const hand of await hands.all()) await expect(hand).toBeInViewport({ ratio: 1 });
          await expectScreenFits(host);
          const clippedFaces = await host.locator(".result-cards .card-face").evaluateAll((faces) => faces.filter((face) => {
            const text = face.getBoundingClientRect();
            const card = face.parentElement!.getBoundingClientRect();
            return text.top < card.top || text.bottom > card.bottom || text.left < card.left || text.right > card.right;
          }).map((face) => face.textContent));
          expect(clippedFaces, `Valeurs de carte à ${width} × ${height}`).toEqual([]);
          await expect(host.getByRole("region", { name: `Main de ${guestNames.at(-1)}` }).getByRole("img", { name: /Annonce Dutch/ })).toBeVisible();
          const variants = host.getByRole("group", { name: "Variantes de la prochaine manche", exact: true }).getByRole("button");
          const rows = await variants.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
          expect(rows).toHaveLength(4);
          expect(new Set(rows).size).toBe(1);
          for (const total of await host.locator(".result-total").all()) await expect(total).toBeInViewport({ ratio: 1 });
          await expect(host.getByRole("button", { name: "Lancer la manche suivante" })).toBeInViewport({ ratio: 1 });
          await host.screenshot({ path: testInfo.outputPath(`resultats-six-${width}.png`) });
        }
      } finally {
        await Promise.all(guests.map((guest) => guest.close()));
      }
    });
  }
}
