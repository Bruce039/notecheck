// @vitest-environment node
import { gzipSync } from "node:zlib";
import { TESTNET_RECEIPT as F } from "@/receipt/fixtures";
import { MEMO_MAX } from "@/receipt/format";
import { toBech32 } from "@/tools/address/account";
import {
  REF_MAX, decodeRequest, encodeRequest, isRequestFragment, receiptMemoFor, requestUrl, validateRequest,
  type PaymentRequestV1,
} from "./format";

const TO = "mtst1ap6wl92rd8jfwsgehu25ukeh5ykn7970";
const base: PaymentRequestV1 = { v: 1, network: "testnet", to: TO, faucetId: F.faucetId, amount: "1500000" };
const raw = (obj: unknown) => "q1." + gzipSync(JSON.stringify(obj)).toString("base64url");

describe("payment request format", () => {
  it("round-trips a full request", async () => {
    const full = { ...base, memo: "Invoice #7", ref: "INV-0007", createdAt: "2026-10-09T10:00:00.000Z" };
    const f = await encodeRequest(full);
    expect(f.startsWith("q1.")).toBe(true);
    expect(isRequestFragment("#" + f)).toBe(true);
    expect(await decodeRequest("#" + f)).toEqual(full);
  });

  it("decodes a fragment built outside the app (Node zlib)", async () => {
    expect(await decodeRequest(raw({ ...base, memo: "Invoice #7" }))).toEqual({ ...base, memo: "Invoice #7" });
  });

  it("builds a Pay-tool URL", () => {
    expect(requestUrl("https://x.example/", "q1.abc")).toBe("https://x.example/?tool=pay#q1.abc");
  });

  it("cleans memo and reference, and drops empty ones", async () => {
    const r = await decodeRequest(raw({ ...base, memo: "✓ Paid‮  in\nfull", ref: "  ​ " }));
    expect(r.memo).toBe("Paid in full");
    expect(r.ref).toBeUndefined();
  });

  it("drops unknown fields and normalizes the faucet id", () => {
    const r = validateRequest({ ...base, extra: "x" });
    expect(r).toEqual(base);
  });

  it("rejects a network mismatch between the address and the network field", async () => {
    await expect(decodeRequest(raw({ ...base, network: "devnet" }))).rejects.toThrow(/not a devnet address/);
    expect(() => validateRequest({ ...base, to: toBech32(F.recipient, "devnet") })).toThrow(/not a testnet address/);
  });

  it.each([
    ["version", { v: 2 }, /version/],
    ["network", { network: "moon" }, /network/],
    ["hex address", { to: F.recipient }, /plain bech32/],
    ["routing suffix", { to: `${TO}_qruqqypuyph` }, /plain bech32/],
    ["bad address", { to: "mtst1nope" }, /not a valid address/],
    ["faucet bech32", { faucetId: toBech32(F.faucetId, "testnet") }, /faucet/],
    ["faucet junk", { faucetId: "0x" + "z".repeat(30) }, /faucet/],
    ["zero amount", { amount: "0" }, /amount/],
    ["negative amount", { amount: "-5" }, /amount/],
    ["decimal amount", { amount: "1.5" }, /amount/],
    ["number amount", { amount: 1500000 }, /amount/],
    ["2^63", { amount: (1n << 63n).toString() }, /amount/],
    ["long memo", { memo: "x".repeat(MEMO_MAX + 1) }, /Memo/],
    ["long ref", { ref: "x".repeat(REF_MAX + 1) }, /Reference/],
    ["bad date", { createdAt: "yesterday" }, /createdAt/],
  ])("rejects %s", (_name, patch, msg) => {
    expect(() => validateRequest({ ...base, ...patch })).toThrow(msg);
  });

  it("accepts the largest amount below 2^63", () => {
    const max = ((1n << 63n) - 1n).toString();
    expect(validateRequest({ ...base, amount: max }).amount).toBe(max);
  });

  it("rejects damaged, oversized and non-request fragments", async () => {
    await expect(decodeRequest("r1.abc")).rejects.toThrow(/Not a payment request/);
    await expect(decodeRequest("q1.***")).rejects.toThrow(/damaged/);
    await expect(decodeRequest("q1.AAAA")).rejects.toThrow(/damaged/);
    await expect(decodeRequest("q1." + "A".repeat(5000))).rejects.toThrow(/too long/);
    await expect(decodeRequest("q1." + gzipSync("not json").toString("base64url"))).rejects.toThrow(/JSON/);
    // A small link that expands past the cap.
    await expect(decodeRequest("q1." + gzipSync(" ".repeat(100_000)).toString("base64url"))).rejects.toThrow(/damaged/);
    await expect(decodeRequest(raw([1, 2]))).rejects.toThrow(/not an object/);
  });

  it("combines memo and reference for the receipt, within the memo limit", () => {
    expect(receiptMemoFor({ memo: "Invoice #7", ref: "INV-7" })).toBe("Invoice #7 · ref INV-7");
    expect(receiptMemoFor({ ref: "INV-7" })).toBe("ref INV-7");
    expect(receiptMemoFor({})).toBe("");
    expect(receiptMemoFor({ memo: "y".repeat(MEMO_MAX), ref: "INV-7" })).toHaveLength(MEMO_MAX);
  });
});
