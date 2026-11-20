import { createDeck } from "./deck";
import type { Card } from "./cards";
import type { GameVariants } from "./variants";

export type DealResult = {
  hands: Record<string, Card[]>;
  drawPile: Card[];
};

export function dealCards(
  playerIds: string[],
  variants: GameVariants
): DealResult {
  const cardsPerPlayer = variants.sixCards ? 6 : 4;
  const deck = createDeck(variants);

  if (playerIds.length * cardsPerPlayer > deck.length) {
    throw new Error("Pas assez de cartes pour la distribution.");
  }

  const hands: Record<string, Card[]> = {};

  for (const playerId of playerIds) {
    hands[playerId] = [];
  }

  // Distribution une carte à la fois, à chaque joueur.
  for (let i = 0; i < cardsPerPlayer; i++) {
    for (const playerId of playerIds) {
      const card = deck.pop();

      if (!card) {
        throw new Error("La pioche est vide.");
      }

      hands[playerId].push(card);
    }
  }

  return {
    hands,
    drawPile: deck,
  };
}