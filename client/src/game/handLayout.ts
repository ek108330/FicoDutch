export type HandLayout = { columns: number; slots: number[] };

// A slot encodes its column and row without depending on the total width of the hand.
export function getHandLayout(cardCount: number, layout?: HandLayout): HandLayout {
  if (layout) return layout;
  const columns = Math.max(1, Math.ceil(cardCount / 2));
  return {
    columns,
    slots: Array.from({ length: cardCount }, (_, index) => (index % columns) * 2 + Math.floor(index / columns)),
  };
}

export function addHandSlot(layout: HandLayout): HandLayout {
  for (const row of [0, 1]) {
    for (let column = 0; column < layout.columns; column++) {
      const slot = column * 2 + row;
      if (!layout.slots.includes(slot)) return { ...layout, slots: [...layout.slots, slot] };
    }
  }
  return { columns: layout.columns + 1, slots: [...layout.slots, layout.columns * 2] };
}
