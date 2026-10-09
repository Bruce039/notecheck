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

export default defineConfig({
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
    },
  },
});
