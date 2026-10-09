// Renders brand/*.html to PNGs in public/ with system Chrome: node brand/render.mjs
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto("file://" + path.join(dir, "og.html"));
await p.screenshot({ path: path.join(dir, "..", "public", "og.png") });
await b.close();
