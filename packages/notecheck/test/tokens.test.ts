// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountId } from "@miden-sdk/miden-sdk";
import { formatAmount, parseTokenList, tokenListUrl } from "../src/tokens.js";

type TokensModule = typeof import("../src/tokens.js");

// From testnet.json in 0xMiden/token-list.
const MIDEN_B32 = "mtst1aqvpq8a9ytqhfvt9al20wzsrs56g83ec";
const MIDEN_HEX = "0x18101fa522c174b165efd4f70a0385";
const IMIDEN_B32 = "mtst1arqxg9er3xclayt95nud82jnpggl9azj";
const IMIDEN_HEX = "0xc064172389b1fe9165a4f8d3aa530a";
// Testnet fee faucet (public).
const FEE_FAUCET_HEX = "0x4cbdcaffe75f0a317482224dae6436";
// The fee faucet ID with its storage-mode bits changed to private.
const PRIVATE_HEX = "0x4cbdcaffe75f0a217482224dae6436";

function list(tokens: unknown[], network = "testnet") {
  return { name: "x", timestamp: "2026-10-07T00:00:00.000Z", version: { major: 1, minor: 0, patch: 0 }, tokens: tokens.map((t) => ({ network, ...(t as object) })) };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("formatAmount", () => {
  it.each([
    [1000000n, 6, "1"],
    [1500000n, 6, "1.5"],
    [1n, 6, "0.000001"],
    [0n, 6, "0"],
    [0n, 0, "0"],
    [1234500n, 3, "1,234.5"],
    [123n, 0, "123"],
    [1234n, 0, "1,234"],
    [1234567n, 0, "1,234,567"],
    [999n, 0, "999"],
    [100000n, 2, "1,000"],
    [123456789012n, 6, "123,456.789012"],
    [10n, 1, "1"],
    [5n, 18, "0.000000000000000005"],
    [10n ** 18n, 18, "1"],
    [-1500000n, 6, "-1.5"],
    // Beyond Number.MAX_SAFE_INTEGER stays exact.
    [9007199254740993n, 0, "9,007,199,254,740,993"],
    [9223372036854775807n, 6, "9,223,372,036,854.775807"],
  ])("formatAmount(%s, %s) = %s", (amount, decimals, want) => {
    expect(formatAmount(amount, decimals)).toBe(want);
  });

  it("rejects negative or non-integer decimals", () => {
    expect(() => formatAmount(1n, -1)).toThrow(RangeError);
    expect(() => formatAmount(1n, 1.5)).toThrow(RangeError);
    expect(() => formatAmount(1n, Number.NaN)).toThrow(RangeError);
  });
});

describe("parseTokenList", () => {
  it("normalizes bech32 faucet IDs to hex", () => {
    const m = parseTokenList(list([{ faucetId: MIDEN_B32, symbol: "MIDEN", name: "Miden", decimals: 6 }]), "testnet");
    expect([...m.entries()]).toEqual([[MIDEN_HEX, { symbol: "MIDEN", name: "Miden", decimals: 6, source: "token-list", verified: true }]]);
    const id = AccountId.fromBech32(MIDEN_B32);
    expect(id.toString()).toBe(MIDEN_HEX);
  });

  it("skips malformed entries and keeps valid ones", () => {
    const m = parseTokenList(
      list([
        null,
        42,
        "str",
        { faucetId: MIDEN_B32, symbol: "", decimals: 6 },
        { faucetId: MIDEN_B32, symbol: "<script>", decimals: 6 },
        { faucetId: MIDEN_B32, symbol: "A".repeat(21), decimals: 6 },
        { faucetId: MIDEN_B32, symbol: 7, decimals: 6 },
        { faucetId: MIDEN_B32, symbol: "OK", decimals: 19 },
        { faucetId: MIDEN_B32, symbol: "OK", decimals: -1 },
        { faucetId: MIDEN_B32, symbol: "OK", decimals: 1.5 },
        { faucetId: MIDEN_B32, symbol: "OK", decimals: "6" },
        { faucetId: MIDEN_B32, symbol: "OK" },
        { faucetId: 123, symbol: "OK", decimals: 6 },
        { faucetId: "mtst1notvalid", symbol: "OK", decimals: 6 },
        { faucetId: MIDEN_HEX, symbol: "OK", decimals: 6 },
        { faucetId: MIDEN_B32.slice(0, -1) + "q", symbol: "OK", decimals: 6 },
        { faucetId: IMIDEN_B32, symbol: "IMIDEN", name: "‮IMIDEN\u0000", decimals: 8 },
      ]),
      "testnet",
    );
    expect([...m.entries()]).toEqual([[IMIDEN_HEX, { symbol: "IMIDEN", name: "IMIDEN", decimals: 8, source: "token-list", verified: true }]]);
  });

  it("drops an invalid name but keeps the token", () => {
    const m = parseTokenList(list([{ faucetId: MIDEN_B32, symbol: "MIDEN", name: "x".repeat(61), decimals: 0 }]), "testnet");
    expect(m.get(MIDEN_HEX)).toEqual({ symbol: "MIDEN", decimals: 0, source: "token-list", verified: true });
  });

  it("ignores entries for another network or with another network's prefix", () => {
    expect(parseTokenList(list([{ faucetId: MIDEN_B32, symbol: "MIDEN", decimals: 6 }], "devnet"), "testnet").size).toBe(0);
    expect(parseTokenList(list([{ faucetId: MIDEN_B32, symbol: "MIDEN", decimals: 6 }], "devnet"), "devnet").size).toBe(0);
  });

  it("drops a faucet ID that appears more than once", () => {
    const m = parseTokenList(
      list([
        { faucetId: MIDEN_B32, symbol: "MIDEN", decimals: 6 },
        { faucetId: MIDEN_B32, symbol: "FAKE", decimals: 0 },
        { faucetId: IMIDEN_B32, symbol: "IMIDEN", decimals: 8 },
      ]),
      "testnet",
    );
    expect([...m.keys()]).toEqual([IMIDEN_HEX]);
  });

  it("returns an empty map for non-list documents", () => {
    for (const doc of [null, undefined, 1, "x", [], {}, { tokens: "x" }, { tokens: {} }]) {
      expect(parseTokenList(doc, "testnet").size).toBe(0);
    }
  });
});

describe("tokenInfo", () => {
  let mod: TokensModule;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("../src/tokens.js");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the network's list and caches it", async () => {
    fetchMock.mockResolvedValue(jsonResponse(list([{ faucetId: MIDEN_B32, symbol: "MIDEN", name: "Miden", decimals: 6 }])));
    const a = await mod.tokenInfo("testnet", MIDEN_HEX);
    const b = await mod.tokenInfo("testnet", MIDEN_HEX.toUpperCase().replace("0X", "0x"));
    expect(a).toEqual({ symbol: "MIDEN", name: "Miden", decimals: 6, source: "token-list", verified: true });
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(tokenListUrl("testnet"));
  });

  it("returns null for an invalid ID without fetching", async () => {
    expect(await mod.tokenInfo("testnet", "nope")).toBeNull();
    expect(await mod.tokenInfo("testnet", "0x1234")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for an unlisted mainnet faucet (no RPC) and caches it", async () => {
    fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));
    expect(await mod.tokenInfo("mainnet", FEE_FAUCET_HEX)).toBeNull();
    expect(await mod.tokenInfo("mainnet", FEE_FAUCET_HEX)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(tokenListUrl("mainnet"));
  });

  it("does not query the chain for a private faucet", async () => {
    expect(AccountId.fromHex(PRIVATE_HEX).isPrivate()).toBe(true);
    fetchMock.mockResolvedValue(jsonResponse(list([])));
    expect(await mod.tokenInfo("testnet", PRIVATE_HEX)).toBeNull();
  });

  it("does not cache a failed list fetch", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await mod.tokenInfo("mainnet", MIDEN_HEX)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("err", { status: 500 }));
    expect(await mod.tokenInfo("mainnet", MIDEN_HEX)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("{not json", { status: 200 }));
    expect(await mod.tokenInfo("mainnet", MIDEN_HEX)).toBeNull();
    fetchMock.mockResolvedValueOnce(jsonResponse(list([{ faucetId: MIDEN_B32.replace("mtst", "mm"), symbol: "X", decimals: 1 }], "mainnet")));
    // Wrong checksum for the mm prefix, so still unknown, but this time from a good list.
    expect(await mod.tokenInfo("mainnet", MIDEN_HEX)).toBeNull();
    expect(await mod.tokenInfo("mainnet", MIDEN_HEX)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("shares one in-flight lookup between concurrent callers", async () => {
    fetchMock.mockResolvedValue(jsonResponse(list([{ faucetId: IMIDEN_B32, symbol: "IMIDEN", decimals: 8 }])));
    const [a, b] = await Promise.all([mod.tokenInfo("testnet", IMIDEN_HEX), mod.tokenInfo("testnet", IMIDEN_HEX)]);
    expect(a).toEqual({ symbol: "IMIDEN", decimals: 8, source: "token-list", verified: true });
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe.runIf(process.env.LIVE === "1")("tokenInfo (live testnet)", () => {
  it("reads the fee faucet's on-chain metadata", async () => {
    vi.resetModules();
    const mod: TokensModule = await import("../src/tokens.js");
    const info = await mod.tokenInfo("testnet", FEE_FAUCET_HEX);
    expect(info?.verified).toBe(true); // pinned native fee faucet
    console.log("fee faucet:", info);
    expect(info).not.toBeNull();
    expect(info!.source).toBe("chain");
    expect(info!.decimals).toBe(6);
    expect(info!.symbol).toMatch(/^[A-Z0-9]{1,20}$/);
  }, 30_000);

  it("reads the live token list", async () => {
    vi.resetModules();
    const mod: TokensModule = await import("../src/tokens.js");
    expect(await mod.tokenInfo("testnet", MIDEN_HEX)).toMatchObject({ symbol: "MIDEN", decimals: 6, source: "token-list", verified: true });
  }, 30_000);
});
