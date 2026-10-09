import { chromium } from "playwright-core";
// Browser smoke test against a running dev/preview server, in system Chrome.
// The Node binding used by vitest does not reproduce WASM ownership rules
// (arrays of SDK objects are consumed in the browser), so this catches what unit tests can't.
// Usage: yarn dev --port 5199 & yarn smoke [baseUrl] [screenshotDir]
import { mkdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const base = process.argv[2] ?? "http://localhost:5199";
const out = process.argv[3] ?? "node_modules/.smoke";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const t0 = Date.now();
await page.goto(base + "/?tool=address");
await page.getByRole("heading", { name: "NoteCheck" }).waitFor({ timeout: 90000 });
console.log("app rendered in", Date.now() - t0, "ms");

// M1
await page.getByRole("button", { name: "example", exact: true }).first().click();
const fields = await page.locator(".field").evaluateAll((els) => els.map((e) => e.querySelector(".field-label").textContent + " = " + e.querySelector("code").textContent));
console.log("M1:", fields.slice(0, 6).join("\n    "));
await page.screenshot({ path: `${out}/address.png`, fullPage: true });

// M2
await page.getByRole("button", { name: "Felt / Word" }).click();
await page.getByLabel(/Integer/).fill("18446744069414584321");
console.log("M2 badge:", await page.locator(".badge").first().textContent());
await page.getByLabel(/Four felts/).fill("[1,2,3,4]");
console.log("M2 word:", await page.locator(".field code").last().textContent(), await page.locator(".field code").nth(-2).textContent());
await page.getByLabel(/Integer/).fill("99999999999999999999999");
console.log("M2 >u64 badge:", await page.locator(".badge").first().textContent(), "| page still alive:", await page.getByRole("heading", { name: "NoteCheck" }).isVisible());
await page.screenshot({ path: `${out}/felt.png`, fullPage: true });

// M4
await page.getByRole("button", { name: "Note tag" }).click();
await page.getByRole("button", { name: "example", exact: true }).first().click();
console.log("M4 tag:", await page.locator(".field code").first().textContent());
await page.screenshot({ path: `${out}/tag.png`, fullPage: true });

// M3
await page.getByRole("button", { name: "Hash", exact: true }).click();
await page.getByRole("button", { name: "example", exact: true }).first().click();
console.log("M3 digests:", (await page.locator(".field code").allTextContents()).filter((t) => t.startsWith("0x")).join(" | "));
await page.locator(".input input").first().fill("[1, 2, 3, 4, 5]");
await page.locator(".input input").first().fill("[]");
await page.locator(".input input").first().fill("[7]");
console.log("M3 errors shown:", await page.locator(".notice-bad").count());
console.log("M3 after refills:", (await page.locator(".field code").allTextContents()).filter((t) => t.startsWith("0x")).length, "digests");
await page.screenshot({ path: `${out}/hash.png`, fullPage: true });

// M5
await page.getByRole("button", { name: "Fee", exact: true }).click();
await page.getByRole("button", { name: /Fetch from/ }).click();
await page.waitForTimeout(2500);
await page.locator(".tool input").first().fill("100000");
await page.waitForTimeout(300);
console.log("M5:", (await page.locator(".tool").innerText()).replace(/\s+/g, " ").slice(0, 420));
await page.screenshot({ path: `${out}/fee.png`, fullPage: true });

// M6
await page.getByRole("button", { name: "Allowlist", exact: true }).click();
await page.getByRole("button", { name: "example", exact: true }).first().click().catch(() => page.locator(".tool input").first().fill("mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk"));
await page.getByRole("button", { name: /^Check on/ }).click();
await page.waitForTimeout(2500);
console.log("M6:", (await page.locator(".tool").innerText()).replace(/\s+/g, " ").slice(0, 420));
await page.screenshot({ path: `${out}/allowlist.png`, fullPage: true });

// S1 in a real browser: RpcClient over grpc-web from page context
const s1 = await page.evaluate(async () => {
  const mods = performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /miden[-_]sdk/.test(n));
  const url = mods.find((n) => n.includes("/dist/st/eager.js"));
  if (!url) return "skipped (production bundle; receipts below exercise the RPC)";
  const m = await import(url);
  const rpc = new m.RpcClient(m.Endpoint.testnet());
  const t = performance.now();
  const h = await rpc.getBlockHeaderByNumber();
  return { block: h.blockNum(), baseFee: h.verificationBaseFee(), ms: Math.round(performance.now() - t), crossOriginIsolated };
}).catch((e) => "ERR " + e.message);
console.log("S1 browser:", JSON.stringify(s1));

// M7 without a wallet extension: must explain, not crash
await page.getByRole("button", { name: "Pay", exact: true }).click();
await page.getByText(/No Miden wallet detected|Connect wallet/).waitFor({ timeout: 10000 });
console.log("M7 no-wallet:", (await page.locator(".wallet").innerText()).replace(/\s+/g, " "));
await page.screenshot({ path: `${out}/pay.png`, fullPage: true });

// Receipts (M8 / M9) with the real testnet fixture
const fixture = readFileSync("src/receipt/fixtures.ts", "utf8").match(/noteFileB64:\s*"([^"]+)"/)[1];
const plainFragment = "r1." + gzipSync(JSON.stringify({ v: 1, network: "testnet", noteFile: fixture, memo: "Invoice #42" }))
  .toString("base64url");
await page.goto(base + "/r#" + plainFragment);
await page.getByRole("heading", { name: /Payment confirmed|Payment committed|Not found|does not match/ }).waitFor({ timeout: 30000 });
await page.waitForTimeout(2500); // token lookup
console.log("R plain:", (await page.locator(".receipt").innerText()).replace(/\s+/g, " ").slice(0, 330));
await page.screenshot({ path: `${out}/receipt.png`, fullPage: true });

await page.goto(base + "/r#r1.not-a-receipt");
await page.locator(".notice-bad").waitFor({ timeout: 15000 });
console.log("R broken:", await page.locator(".notice-bad").innerText());

// create from NoteFile with a password, then open it
await page.goto(base + "/?tool=receipt");
await page.getByLabel(/paste it as base64/).fill(fixture);
await page.getByRole("button", { name: "Read", exact: true }).click();
await page.getByText(/on testnet, block|not found on testnet/).waitFor({ timeout: 30000 });
await page.getByLabel(/Memo/).fill("Smoke test");
await page.getByLabel("Password (optional)").fill("hunter22");
await page.getByRole("button", { name: "Create link" }).click();
const link = await page.locator(".receipt-link code").textContent({ timeout: 20000 });
console.log("R created link length:", link.length, link.slice(0, 40) + "…");
await page.screenshot({ path: `${out}/receipt-create.png`, fullPage: true });
await page.goto(link.replace(/^https?:\/\/[^/]+/, base));
await page.getByLabel("Password").fill("wrong");
await page.getByRole("button", { name: "Open receipt" }).click();
await page.locator(".notice-bad").waitFor({ timeout: 20000 });
console.log("R wrong pw:", await page.locator(".notice-bad").innerText());
await page.getByLabel("Password").fill("hunter22");
await page.getByRole("button", { name: "Open receipt" }).click();
await page.getByRole("heading", { name: /Payment confirmed|Payment committed|Not found/ }).waitFor({ timeout: 30000 });
console.log("R encrypted:", (await page.locator(".receipt h2").first().innerText()), "| memo:", await page.locator(".rc-memo-text").innerText().catch(() => "-"));
await page.goto(base + "/?tool=address");

// mobile
await page.setViewportSize({ width: 375, height: 800 });
await page.getByRole("button", { name: "Address", exact: true }).click();
await page.getByRole("button", { name: "example", exact: true }).first().click();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log("mobile horizontal overflow:", overflow);
await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length) process.exit(1);
