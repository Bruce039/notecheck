import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { midenVitePlugin } from "@miden-sdk/vite-plugin";

// `vite preview` serves the same security headers as vercel.json, so the CSP is tested locally.
const vercel = JSON.parse(readFileSync(path.resolve(__dirname, "vercel.json"), "utf8"));
const productionHeaders: Record<string, string> = Object.fromEntries(
  vercel.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]),
);

// Short commit shown in the footer: Vercel's env var on deploys, git locally.
function buildId(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "dev"; }
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId()) },
  // Single-threaded SDK build: no COOP/COEP needed, and they would break wallet popups and embeds.
  plugins: [react(), midenVitePlugin()],
  preview: { headers: productionHeaders },
  build: {
    // Fonts stay separate files: the CSP allows fonts from 'self' only, not data: URIs.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The app uses the notecheck package from source (packages/notecheck), not from npm.
      notecheck: path.resolve(__dirname, "./packages/notecheck/src/index.ts"),
    },
  },
});
