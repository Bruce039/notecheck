// Regenerates the README images in .github/assets from a running build:
//   yarn preview --port 5200 &  node brand/readme-assets.mjs [baseUrl]
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".github/assets");
const tmp = path.join(root, "node_modules/.readme-assets");
const base = process.argv[2] ?? "http://localhost:5200";
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

const fixture = readFileSync(path.join(root, "packages/notecheck/test/fixtures.ts"), "utf8").match(/noteFileB64:\s*"([^"]+)"/)[1];
const receipt = "/r#r1." + gzipSync(JSON.stringify({ v: 1, network: "testnet", noteFile: fixture, memo: "Invoice #42" })).toString("base64url");

const browser = await chromium.launch({ channel: "chrome" });
async function page(theme, width, height, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, ...opts });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  return { ctx, p: await ctx.newPage() };
}

// 1. Banner / social preview
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 640 } });
  const p = await ctx.newPage();
  await p.goto("file://" + path.join(root, "brand/banner.html"));
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, "banner.png") });
  await ctx.close();
}

// 2. Raw screenshots
const shots = {};
for (const [name, theme, w, h, url, wait] of [
  ["receipt-light", "light", 1100, 1300, receipt, /Payment confirmed/],
  ["receipt-dark-m", "dark", 390, 1500, receipt, /Payment confirmed/],
  ["hero-dark-m", "dark", 390, 1500, "/", /Private payments/],
  ["home-light", "light", 1280, 900, "/", /Private payments/],
  ["docs-light", "light", 1280, 900, "/?tool=docs", /How to use NoteCheck/],
  ["tool-dark", "dark", 1280, 900, "/?tool=fee", /Fee/],
]) {
  const { ctx, p } = await page(theme, w, h);
  await p.goto(base + url);
  await p.getByRole("heading", { name: wait }).first().waitFor({ timeout: 90000 });
  if (name.startsWith("tool")) { await p.getByRole("button", { name: /Fetch from/ }).click().catch(() => {}); await p.locator(".tool input").first().fill("100000"); }
  await p.waitForTimeout(name.startsWith("receipt") ? 3500 : 7000);
  const file = path.join(tmp, name + ".png");
  await p.screenshot({ path: file, fullPage: name.endsWith("-m") || name.startsWith("receipt") });
  shots[name] = "file://" + file;
  await ctx.close();
}

// 3. Showcase composite: browser window + two phones
{
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}body{width:1600px;height:900px;overflow:hidden;font-family:system-ui;
  background:radial-gradient(800px 500px at 15% 10%,rgba(59,47,201,.25),transparent 60%),radial-gradient(700px 500px at 90% 90%,rgba(124,108,255,.22),transparent 60%),#0f0f14}
  .win{position:absolute;left:70px;top:70px;width:980px;height:760px;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 40px 100px -30px rgba(0,0,0,.7)}
  .bar{height:38px;background:#ececf1;display:flex;align-items:center;gap:8px;padding:0 14px}.bar i{width:12px;height:12px;border-radius:50%;background:#d0d0da}
  .bar span{margin-left:16px;flex:1;height:22px;border-radius:7px;background:#fff;font:12px ui-monospace,monospace;color:#77778a;display:flex;align-items:center;padding:0 10px}
  .win img{width:100%;display:block}
  .ph{position:absolute;width:300px;height:640px;border-radius:44px;border:10px solid #1d1d24;overflow:hidden;background:#101014;box-shadow:0 40px 90px -25px rgba(0,0,0,.8)}
  .ph img{width:100%;display:block}
  </style></head><body>
  <div class="win"><div class="bar"><i></i><i></i><i></i><span>notecheck-miden.vercel.app/r#r1.H4sIAAAA…</span></div><img src="${shots["receipt-light"]}"></div>
  <div class="ph" style="left:1000px;top:190px;transform:rotate(-4deg)"><img src="${shots["hero-dark-m"]}"></div>
  <div class="ph" style="left:1240px;top:110px;transform:rotate(3deg)"><img src="${shots["receipt-dark-m"]}"></div>
  </body></html>`;
  writeFileSync(path.join(tmp, "showcase.html"), html);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const p = await ctx.newPage();
  await p.goto("file://" + path.join(tmp, "showcase.html"));
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, "showcase.png") });
  await ctx.close();
}

// 4. Two-up: docs (light) and a developer tool (dark)
{
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}body{width:1600px;height:620px;overflow:hidden;background:#f2f2f7;display:flex;gap:40px;padding:50px}
  div{flex:1;border-radius:14px;overflow:hidden;box-shadow:0 30px 70px -30px rgba(40,30,120,.45);border:1px solid #e3e3ea}
  img{width:100%;display:block}</style></head><body>
  <div><img src="${shots["docs-light"]}"></div><div><img src="${shots["tool-dark"]}"></div></body></html>`;
  writeFileSync(path.join(tmp, "twoup.html"), html);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 620 } });
  const p = await ctx.newPage();
  await p.goto("file://" + path.join(tmp, "twoup.html"));
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(out, "docs-and-tools.png") });
  await ctx.close();
}

// 5. Demo GIF of the landing animation: slow the page's animations 4x and grab frames,
// so each frame stands for 1/15 s of real time regardless of screenshot speed.
{
  const fdir = path.join(tmp, "frames");
  rmSync(fdir, { recursive: true, force: true });
  mkdirSync(fdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem("theme", "light"));
  const p = await ctx.newPage();
  await p.goto(base + "/");
  await p.getByRole("heading", { name: /Private payments/ }).waitFor({ timeout: 90000 });
  await p.waitForTimeout(800);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.25 });
  const box = await p.locator(".nch").first().boundingBox();
  const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 820 - box.y) };
  const fps = 15, seconds = 8, slow = 4;
  const t0 = Date.now();
  for (let i = 0; i < fps * seconds; i++) {
    const due = t0 + (i * 1000 * slow) / fps;
    const wait = due - Date.now();
    if (wait > 0) await p.waitForTimeout(wait);
    await p.screenshot({ path: path.join(fdir, `f${String(i).padStart(3, "0")}.png`), clip });
  }
  await ctx.close();
  execFileSync("ffmpeg", ["-y", "-framerate", String(fps), "-i", path.join(fdir, "f%03d.png"), "-vf",
    "scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
    path.join(out, "demo.gif")], { stdio: "ignore" });
}

await browser.close();
console.log("done:", readdirSync(out).join(", "));
