
export const GAME_CONFIG = {
  name: "FicoDutch",
  version: "0.1.0",

  players: {
    min: 2,
    max: 6,
  },

  cards: {
    standardCount: 4,
    variantCount: 6,
    jokersDefault: false,
    jokerVariantCount: 2,
  },

  scoring: {
    defaultEndThreshold: 100,
  },

  player: {
    pseudoMinLength: 2,
    pseudoMaxLength: 20,
    allowedPseudoPattern: /^[A-Za-z0-9]+$/,
  },

  network: {
    serverUrl: "",
    reconnectGracePeriodSeconds: 120,
  },
} as const;
