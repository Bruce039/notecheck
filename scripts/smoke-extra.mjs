import { chromium } from "playwright-core";
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync } from "node:fs";
import {
  AccountId, Address, FungibleAsset, InputNote, Note, NoteAssets, NoteAttachment, NoteFile,
  NoteInclusionProof, NoteType, NetworkId,
} from "@miden-sdk/miden-sdk";
// Extra browser checks in system Chrome, next to scripts/smoke.mjs. They cover browser-only
// paths (WASM ownership rules of the real build) that vitest's Node binding can't reproduce:
//   1. P2IDE and public-note receipts deserialized and inspected in the browser
//   2. Receipts tab: create a link from a P2IDE NoteFile, then open it
//   3. Keyboard-only navigation through the tool tabs
//   4. Pay flow against an injected fake `window.midenWallet` (the object the Bread extension
//      provides): connect -> assets -> form -> requestSend -> waitForTransaction returning a real
//      serialized note -> receipt polling. Also wallet reject / failure / timeout / reload-resume.
// Notes built here are never on chain, so receipts show "Not found" and the pay flow stays in
// its "waiting for commit" state; that is expected.
// Usage: node scripts/smoke-extra.mjs [baseUrl] [screenshotDir]
const base = process.argv[2] ?? "http://localhost:5199";
const out = process.argv[3] ?? "node_modules/.smoke-extra";
mkdirSync(out, { recursive: true });

const failures = [];
const notes = [];
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures.push(msg); };
const flat = (s) => s.replace(/\s+/g, " ").trim();

// --- Fixture accounts (from src/receipt/fixtures.ts: a real testnet payment) ---
const fx = readFileSync("src/receipt/fixtures.ts", "utf8");
const pick = (k) => fx.match(new RegExp(`${k}:\\s*"([^"]+)"`))[1];
const SENDER = pick("sender"), RECIPIENT = pick("recipient"), FAUCET = pick("faucetId");
const b32 = (hex) => Address.fromAccountId(AccountId.fromHex(hex)).toBech32(NetworkId.testnet());
const b64 = (x) => Buffer.from(Uint8Array.from(x)).toString("base64");
const assets = (amount) => new NoteAssets([new FungibleAsset(AccountId.fromHex(FAUCET), amount)]);
const fullFile = (note, block) =>
  b64(NoteFile.fromInputNote(InputNote.authenticated(note, NoteInclusionProof.mockAtBlock(block))).serialize());
const fragmentFor = (noteFile, extra = {}) =>
  "r1." + gzipSync(JSON.stringify({ v: 1, network: "testnet", noteFile, ...extra })).toString("base64url");

const p2ideNote = Note.createP2IDENote(
  AccountId.fromHex(SENDER), AccountId.fromHex(RECIPIENT), assets(2_500_000n), 1_000, 600, NoteType.Private, new NoteAttachment(),
);
const p2ideFile = fullFile(p2ideNote, 90_000);
const p2ideId = p2ideNote.id().toString();
const publicNote = Note.createP2IDNote(
  AccountId.fromHex(SENDER), AccountId.fromHex(RECIPIENT), assets(3n), NoteType.Public, new NoteAttachment(),
);
const publicFile = fullFile(publicNote, 90_001);
const publicId = publicNote.id().toString();

// --- Fake wallet: the payment note the "wallet" reports after the send ---
const PAY_AMOUNT = 1_500_000n; // 1.5 USDCX (6 decimals)
const payNote = Note.createP2IDNote(
  AccountId.fromHex(SENDER), AccountId.fromHex(RECIPIENT), assets(PAY_AMOUNT), NoteType.Private, new NoteAttachment(),
);
const wallet = {
  address: `${b32(SENDER)}_qruqqypuyph`,
  faucet: b32(FAUCET),
  recipient: b32(RECIPIENT),
  noteB64: b64(payNote.serialize()),
  noteId: payNote.id().toString(),
  txHash: "0x" + "cd".repeat(32),
};

/** Installed before any page script: mimics the extension's `window.midenWallet`. */
function fakeWallet(w) {
  const log = (window.__walletLog = []);
  window.__walletMode = "ok";
  window.midenWallet = {
    address: null,
    publicKey: null,
    async connect(permission, network, allowed) {
      log.push(["connect", permission, network, allowed]);
      this.address = w.address;
      this.publicKey = new Uint8Array(32);
    },
    async disconnect() { log.push(["disconnect"]); },
    async requestAssets() {
      log.push(["requestAssets"]);
      return { assets: [{ faucetId: w.faucet, amount: "5000000" }] };
    },
    async requestSend(payload) {
      log.push(["requestSend", JSON.parse(JSON.stringify(payload))]);
      if (window.__walletMode === "reject") throw new Error("User rejected the request");
      return { transactionId: "mock-tx-" + log.length };
    },
    async requestTransaction(tx) {
      log.push(["requestTransaction", tx?.type]);
      throw new Error("the app should use requestSend for a send");
    },
    async waitForTransaction(txId, timeout) {
      log.push(["waitForTransaction", txId, timeout ?? null]);
      if (window.__walletMode === "fail") return { errorMessage: "Transaction failed: insufficient fee balance" };
      if (window.__walletMode === "timeout") throw new Error("Transaction timed out");
      return { txHash: w.txHash, outputNotes: [w.noteB64] };
    },
    async importPrivateNote(bytes) { log.push(["importPrivateNote", bytes?.length]); return { noteId: w.noteId }; },
  };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
async function newPage({ withWallet = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  if (withWallet) await context.addInitScript(fakeWallet, wallet);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  return page;
}
const receiptText = async (page) => flat(await page.locator(".receipt").innerText());

// 1. P2IDE and public-note receipts rendered in the browser
{
  const page = await newPage();
  await page.goto(base + "/r#" + fragmentFor(p2ideFile, { memo: "P2IDE smoke" }));
  await page.getByRole("heading", { name: /Not found on testnet|Payment confirmed|Payment committed|does not match/ }).waitFor({ timeout: 60_000 });
  let t = await receiptText(page);
  check(/Not found on testnet/.test(t), "P2IDE receipt is inspected in the browser and looked up (not on chain → Not found)");
  check(t.includes(p2ideId), "P2IDE receipt shows the note ID recomputed in the browser");
  check(!/P2IDE smoke|2\.5|USDCX/.test(t), "P2IDE not-found receipt hides memo and amounts");
  await page.screenshot({ path: `${out}/receipt-p2ide.png`, fullPage: true });

  // "Check again" re-runs inspect + RPC on the same page (a second pass over freed objects).
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByRole("heading", { name: /Not found on testnet/ }).waitFor({ timeout: 60_000 });
  check(true, "P2IDE receipt survives 'Check again'");

  await page.goto(base + "/r#" + fragmentFor(publicFile));
  await page.getByRole("heading", { name: /Not found on testnet|Payment confirmed|Payment committed|does not match/ }).waitFor({ timeout: 60_000 });
  t = await receiptText(page);
  check(/Not found on testnet/.test(t) && t.includes(publicId), "public P2ID receipt is inspected in the browser (Not found)");
  await page.context().close();
}

// 2. Receipts tab: create from a P2IDE NoteFile, then open it
{
  const page = await newPage();
  await page.goto(base + "/?tool=receipt");
  await page.getByLabel(/paste it as base64/).fill(p2ideFile);
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.getByText(/not found on testnet|on testnet, block|couldn't reach/).waitFor({ timeout: 60_000 });
  const badges = flat(await page.locator(".tool .badges").first().innerText());
  check(/P2IDE/.test(badges) && /not found on testnet/.test(badges), `Receipts tab reads a P2IDE NoteFile (${badges})`);
  check((await page.locator(".tool").innerText()).includes(p2ideId), "Receipts tab shows the P2IDE note ID");
  await page.getByLabel(/Memo/).fill("from the receipts tab");
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.locator(".field", { hasText: "Receipt link" }).locator("code").textContent({ timeout: 20_000 });
  check(/\/r#r1\./.test(link), "Receipts tab creates an unprotected r1. link");
  await page.locator(".receipt-link").getByRole("link", { name: "Open" }).click();
  await page.getByRole("heading", { name: /Not found on testnet/ }).waitFor({ timeout: 60_000 });
  check((await receiptText(page)).includes(p2ideId), "the created P2IDE link opens to the same note ID");
  await page.context().close();
}

// 3. Keyboard only
{
  const page = await newPage();
  await page.goto(base + "/?tool=address");
  await page.getByRole("navigation", { name: "Tools" }).waitFor({ timeout: 90_000 });
  await page.locator(".tab").first().focus();
  const visited = [];
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    visited.push(await page.evaluate(() => document.activeElement?.textContent));
  }
  check(visited.join("|") === "Receipts|Address|Felt / Word|Note tag|Hash|Fee|Allowlist", `Tab walks the tool tabs in order (${visited.join("|")})`);
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Allowlist", exact: true }).waitFor({ timeout: 5000 });
  check(page.url().includes("tool=allowlist"), "Enter on a tab opens that tool");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  check(outline !== "none", `focused tab has a visible focus outline (outline-style: ${outline})`);
  // Into the tool content without the mouse: past the remaining tabs (Docs), then into the card.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => !!document.activeElement?.closest(".tool"))) break;
  }
  const into = await page.evaluate(() => {
    const el = document.activeElement;
    return (el?.closest(".tool") ? "in-tool:" : "outside:") + el?.tagName + ":" + (el?.textContent || el?.id || "");
  });
  check(into.startsWith("in-tool:"), `Tab from the last tab moves into the tool (${into})`);
  // Network select from the keyboard (type-ahead; arrow keys open the native popup on macOS).
  await page.locator("header select").focus();
  await page.keyboard.press("d");
  await page.waitForTimeout(200);
  check(page.url().includes("net=devnet"), "network select works from the keyboard");
  await page.context().close();
}

// 4. Pay flow with a fake wallet
{
  const page = await newPage({ withWallet: true });
  const walletLog = () => page.evaluate(() => window.__walletLog);
  const pending = () => page.evaluate(() => JSON.parse(localStorage.getItem("pending-payments-v2") ?? "[]"));
  await page.goto(base + "/?tool=pay");
  await page.getByRole("button", { name: "Connect wallet" }).click({ timeout: 15_000 });
  await page.locator(".wallet .badge-good").waitFor({ timeout: 15_000 });
  const shown = await page.locator(".wallet code").textContent();
  check(wallet.address.startsWith(shown.slice(0, 8)) && !shown.includes("_"), `connected; address shown without routing suffix (${shown})`);
  const connectCall = (await walletLog()).find((c) => c[0] === "connect");
  check(!!connectCall, `adapter called window.midenWallet.connect(${connectCall?.slice(1).join(", ")})`);

  await page.getByRole("button", { name: "Load my tokens" }).click();
  await page.locator("#pay-token option", { hasText: /USDCX/ }).waitFor({ state: "attached", timeout: 60_000 });
  check(true, "assets loaded and the fee token resolved to USDCX");

  const fillForm = async () => {
    await page.getByLabel("Recipient address").fill(wallet.recipient);
    await page.getByLabel(/^Amount/).fill("1.5");
    await page.getByLabel(/Memo for the receipt/).fill("smoke-extra");
  };
  const reviewBtn = () => page.getByRole("button", { name: "Review in wallet" });

  // Self-send guard sees through the wallet's suffixed address.
  await page.getByLabel("Recipient address").fill(b32(SENDER));
  await page.getByLabel(/^Amount/).fill("1");
  check(await page.getByText("That's the connected account.").isVisible(), "self-send is refused");

  // 4a. Wallet rejects
  await page.evaluate(() => { window.__walletMode = "reject"; });
  await fillForm();
  await reviewBtn().click();
  await page.locator(".notice-bad").waitFor({ timeout: 15_000 });
  const rejectMsg = flat(await page.locator(".notice-bad").innerText());
  check(/didn't send the payment.*User rejected/.test(rejectMsg), `reject → ${rejectMsg}`);
  check((await pending()).length === 0, "reject → nothing pending");
  const sendCall = (await walletLog()).find((c) => c[0] === "requestSend");
  check(sendCall && sendCall[1].recipientAddress === wallet.recipient && sendCall[1].faucetId === wallet.faucet
    && sendCall[1].noteType === "private" && sendCall[1].amount === 1_500_000 && sendCall[1].senderAddress === wallet.address,
  `requestSend payload is right (${JSON.stringify(sendCall?.[1])})`);
  check(!(await walletLog()).some((c) => c[0] === "requestTransaction"), "a send goes through requestSend, not requestTransaction");
  await page.getByRole("button", { name: "Back" }).click();

  // 4b. Wallet reports failure
  await page.evaluate(() => { window.__walletMode = "fail"; });
  await fillForm();
  await reviewBtn().click();
  await page.locator(".notice-bad").waitFor({ timeout: 15_000 });
  const failMsg = flat(await page.locator(".notice-bad").innerText());
  check(/transaction failed.*insufficient fee balance/i.test(failMsg), `failure → ${failMsg}`);
  check((await pending()).length === 0, "failure → pending cleared");
  check(!(await page.getByText(/Don't send it again/).isVisible()), "failure → no 'don't send again'");
  await page.getByRole("button", { name: "Back" }).click();

  // 4c. Wallet times out
  await page.evaluate(() => { window.__walletMode = "timeout"; });
  await fillForm();
  await reviewBtn().click();
  await page.getByText(/Don't send it again/).waitFor({ timeout: 15_000 });
  let p = await pending();
  check(p.length === 1 && !p[0].noteB64 && p[0].amount === "1500000", "timeout → payment kept pending (without note yet)");
  await page.getByRole("button", { name: "Back" }).click();
  check(await page.getByText(/from an earlier visit still need a receipt/).isVisible(), "timeout → pending notice offered");
  await page.getByRole("button", { name: "discard" }).click();
  check((await pending()).length === 0, "discard removes the pending payment");

  // 4d. Success up to "waiting for commit": waitForTransaction returns a real serialized note,
  // which the adapter deserializes with the browser SDK and the app inspects and re-serializes.
  await page.evaluate(() => { window.__walletMode = "ok"; });
  await fillForm();
  await page.getByLabel("Receipt password (optional)").fill("correct horse");
  await reviewBtn().click();
  await page.getByText(/Your wallet is building, proving and sending the payment/).waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("pending-payments-v2") ?? "[]")[0]?.noteB64, null, { timeout: 15_000 });
  p = await pending();
  check(p.length === 1 && p[0].noteB64 === wallet.noteB64, "wallet note accepted by pickPaymentNote in the browser and saved byte-identical");
  check(p[0].chainTxId === wallet.txHash && p[0].memo === "smoke-extra", "pending record carries the tx hash and memo");
  await page.waitForTimeout(7000); // a couple of commit polls against the real RPC
  check(await page.getByText(/Your wallet is building, proving and sending the payment/).isVisible(), "still waiting for commit after several RPC polls (note is not on chain)");
  await page.screenshot({ path: `${out}/pay-waiting.png`, fullPage: true });

  // 4e. Reload: the pending payment is offered again.
  await page.reload();
  await page.getByText(/from an earlier visit still need a receipt/).waitFor({ timeout: 30_000 });
  check(true, "after reload the pending payment is offered (finish receipt / discard)");
  await page.getByRole("button", { name: "discard" }).click();

  // 4f. Resume of a tx-id-only payment while the selected wallet is not connected must keep the record.
  await page.evaluate((r) => localStorage.setItem("pending-payments-v2", JSON.stringify([r])), {
    txId: "mock-tx-old", network: "testnet", recipient: RECIPIENT, faucetId: FAUCET, amount: "1500000", createdAt: new Date().toISOString(),
  });
  await page.reload();
  await page.getByText(/from an earlier visit still need a receipt/).waitFor({ timeout: 30_000 });
  check(await page.getByRole("button", { name: "Connect wallet" }).isVisible(), "after reload the wallet is selected but not connected");
  check(await page.getByRole("button", { name: "finish receipt" }).isDisabled(), "finish receipt waits for the sending wallet to connect");
  check((await pending()).length === 1, "the pending payment is kept while the wallet is disconnected");
  await page.context().close();
}

await browser.close();
const relevant = errors.filter((e) => !/Failed to load resource/.test(e));
check(relevant.length === 0, `no page or console errors${relevant.length ? ": " + relevant.join(" | ") : ""}`);
if (errors.length !== relevant.length) console.log("info ignored:", errors.filter((e) => !relevant.includes(e)));
for (const n of notes) console.log(n);
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
