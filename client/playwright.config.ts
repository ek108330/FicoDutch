import { defineConfig } from "@playwright/test";

const clientUrl = "http://127.0.0.1:15173";
const serverUrl = "http://127.0.0.1:15300";
const node = `"${process.execPath}"`;

export default defineConfig({
  testDir: "./e2e",
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: clientUrl,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
    trace: "retain-on-failure",
    screenshot: "on",
  },
  webServer: [
    {
      command: `${node} ../server/index.js`,
      env: { HOST: "127.0.0.1", PORT: "15300", CLIENT_ORIGINS: clientUrl },
      url: `${serverUrl}/healthz`,
    },
    {
      command: `${node} node_modules/vite/bin/vite.js --host 127.0.0.1 --port 15173 --strictPort`,
      env: { VITE_SERVER_URL: serverUrl },
      url: clientUrl,
    },
  ],
});
