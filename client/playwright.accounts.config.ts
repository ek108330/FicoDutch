import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

const servers = config.webServer;
if (!Array.isArray(servers)) throw new Error("Serveurs Playwright FicoDutch manquants.");
const serverUrl = "http://127.0.0.1:15301";
const clientUrl = "http://127.0.0.1:15174";

export default defineConfig({
  ...config,
  testIgnore: [],
  testMatch: "**/accounts.spec.ts",
  workers: 1,
  use: { ...config.use, baseURL: clientUrl },
  outputDir: "test-results/comptes-et-bilans",
  webServer: [
    {
      ...servers[0], url: `${serverUrl}/healthz`,
      env: { ...servers[0].env, PORT: "15301", CLIENT_ORIGINS: clientUrl, FICODUTCH_LOCAL_DB: "memory://", DATABASE_URL: "", FICODUTCH_DEMO: "1" },
    },
    {
      ...servers[1], url: clientUrl,
      command: servers[1].command.replace("--port 15173", "--port 15174"),
      env: { ...servers[1].env, VITE_SERVER_URL: serverUrl },
    },
  ],
});
