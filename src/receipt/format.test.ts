// @vitest-environment node
import { fromBase64Url, gunzip, gzip, toBase64, toBase64Url } from "./bytes";
import { WrongPasswordError } from "./crypto";
import { PasswordRequiredError, decodeReceipt, encodeReceipt, isEncryptedFragment, receiptUrl, type ReceiptV1 } from "./format";
import { TESTNET_RECEIPT } from "./fixtures";

// Low PBKDF2 cost keeps tests fast; production uses PBKDF2_ITERATIONS.
const FAST = 1_000;

const receipt: ReceiptV1 = {
  v: 1,
  network: "testnet",
  noteFile: TESTNET_RECEIPT.noteFileB64,
  memo: "Invoice #42 – Oct design work ✓",
  createdAt: "2026-10-09T12:00:00.000Z",
  txId: TESTNET_RECEIPT.txId,
};

describe("bytes", () => {
  it("base64url round-trips all byte values", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64Url(toBase64Url(all))).toEqual(all);
    expect(toBase64Url(all)).not.toMatch(/[+/=]/);
    expect(toBase64(Uint8Array.of(0xfb, 0xff))).toBe("+/8=");
  });
  it("rejects non-base64url characters", () => {
    expect(() => fromBase64Url("ab+c")).toThrow();
  });
  it("gunzip enforces its output limit", async () => {
    const big = await gzip(new Uint8Array(100_000));
    expect(big.length).toBeLessThan(1_000);
    await expect(gunzip(big, 50_000)).rejects.toThrow(/larger/);
    expect((await gunzip(big, 100_000)).length).toBe(100_000);
  });
  it("gunzip rejects junk", async () => {
    await expect(gunzip(Uint8Array.of(1, 2, 3, 4), 1000)).rejects.toThrow(/gzip/);
  });
});

describe("receipt format", () => {
  it("round-trips a plain receipt", async () => {
    const f = await encodeReceipt(receipt);
    expect(f.startsWith("r1.")).toBe(true);
    expect(isEncryptedFragment(f)).toBe(false);
    expect(await decodeReceipt("#" + f)).toEqual(receipt);
  });

  it("keeps links reasonably short", async () => {
    const f = await encodeReceipt(receipt);
    expect(f.length).toBeLessThan(1_200);
  });

  it("round-trips an encrypted receipt and rejects a wrong password", async () => {
    const f = await encodeReceipt(receipt, "correct horse", FAST);
    expect(isEncryptedFragment(f)).toBe(true);
    await expect(decodeReceipt(f, undefined, FAST)).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(decodeReceipt(f, "wrong", FAST)).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await decodeReceipt(f, "correct horse", FAST)).toEqual(receipt);
  });

  it("encrypts with a fresh salt and IV each time", async () => {
    const a = await encodeReceipt(receipt, "pw", FAST);
    const b = await encodeReceipt(receipt, "pw", FAST);
    expect(a).not.toBe(b);
  });

  it("detects tampering with encrypted links", async () => {
    const f = await encodeReceipt(receipt, "pw", FAST);
    const body = fromBase64Url(f.slice(4));
    body[body.length - 1] ^= 1;
    await expect(decodeReceipt("r1e." + toBase64Url(body), "pw", FAST)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("drops unknown fields and validates known ones", async () => {
    const withExtra = { ...receipt, evil: "<script>" } as unknown as ReceiptV1;
    expect(await decodeReceipt(await encodeReceipt(withExtra))).toEqual(receipt);
    await expect(encodeReceipt({ ...receipt, memo: "x".repeat(281) })).rejects.toThrow(/Memo/);
    await expect(encodeReceipt({ ...receipt, network: "moon" as never })).rejects.toThrow(/network/);
    await expect(encodeReceipt({ ...receipt, txId: "0x12" })).rejects.toThrow(/transaction/);
    await expect(encodeReceipt({ ...receipt, noteFile: "not base64!" })).rejects.toThrow(/note file/);
  });

  it("rejects foreign or broken links", async () => {
    await expect(decodeReceipt("hello")).rejects.toThrow(/Not a Miden receipt/);
    await expect(decodeReceipt("r1.AAAA")).rejects.toThrow();
    await expect(decodeReceipt("r1.not-a-receipt")).rejects.toThrow(/damaged/);
    await expect(decodeReceipt("r1." + "A".repeat(20_000))).rejects.toThrow(/too long/);
    const notJson = toBase64Url(await gzip(new TextEncoder().encode("{nope")));
    await expect(decodeReceipt("r1." + notJson)).rejects.toThrow(/JSON/);
    const v2 = toBase64Url(await gzip(new TextEncoder().encode(JSON.stringify({ ...receipt, v: 2 }))));
    await expect(decodeReceipt("r1." + v2)).rejects.toThrow(/version/);
  });

  it("strips control, bidi and zero-width characters and leading verdict glyphs from memos", async () => {
    const hostile = "\u202E✓ Payment verified\u202C · 10,000\u200B USDCX\n\tnext";
    const r = await decodeReceipt(await encodeReceipt({ ...receipt, memo: hostile }));
    expect(r.memo).toBe("Payment verified · 10,000 USDCX next");
    const onlyJunk = await decodeReceipt(await encodeReceipt({ ...receipt, memo: "\u200B\u202E" }));
    expect(onlyJunk.memo).toBeUndefined();
  });

  it("builds the /r URL", () => {
    expect(receiptUrl("https://x.app/", "r1.abc")).toBe("https://x.app/r#r1.abc");
  });
});
