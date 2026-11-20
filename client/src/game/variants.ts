
export type GameVariants = {
  sixCards: boolean;
  infinitePose: boolean;
  plusMinusOne: boolean;
  jokerPlus: boolean;
};

export const DEFAULT_VARIANTS: GameVariants = {
  sixCards: false,
  infinitePose: false,
  plusMinusOne: false,
  jokerPlus: false,
};

export const VARIANT_LABELS = {
  sixCards: "6 cartes",
  infinitePose: "Pose infinie",
  plusMinusOne: "+1 / -1",
  jokerPlus: "Joker +",
} as const;
