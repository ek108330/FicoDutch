
import type { HubStatus } from "../../../shared/hubTypes";

declare const __BUILD_REVISION__: string;
export const buildRevision = typeof __BUILD_REVISION__ === "string" ? __BUILD_REVISION__ : "";

export const hubStatusLabels: Record<HubStatus, string> = {
  waiting: "En attente",
  "in-progress": "En cours",
  full: "Complet",
  finished: "Terminée",
};

export const GAME_CONFIG = {
  name: "FicoDutch",
  version: buildRevision ? `0.1.0+${buildRevision.slice(0, 7)}` : "0.1.0",

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
    historyLength: 8,
  },

  round: {
    resultsMs: 60_000,
    transitionMs: 5_000,
    dealingMs: 600,
    memorizationMs: 15_000,
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
