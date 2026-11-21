import { execFileSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function buildRevision() {
  const deployed = process.env.RENDER_GIT_COMMIT || process.env.FICODUTCH_BUILD_REVISION || process.env.GITHUB_SHA;
  if (deployed) return deployed;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_REVISION__: JSON.stringify(buildRevision()) },
});
