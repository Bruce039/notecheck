// @vitest-environment node
import { MODULUS, feltInfo, parseUint, parseWord } from "./felt";

describe("parseUint", () => {
  it("reads decimal, hex and separators", () => {
    expect(parseUint("42")).toBe(42n);
    expect(parseUint(" 0xFF ")).toBe(255n);
    expect(parseUint("1_000_000")).toBe(1_000_000n);
  });
  it("rejects junk and negatives", () => {
    expect(() => parseUint("")).toThrow();
    expect(() => parseUint("-1")).toThrow();
    expect(() => parseUint("0xg1")).toThrow();
    expect(() => parseUint("1.5")).toThrow();
  });
});

describe("feltInfo", () => {
  it("flags values at and above the modulus", () => {
    expect(feltInfo(MODULUS - 1n).canonical).toBe(true);
    const p = feltInfo(MODULUS);
    expect(p.canonical).toBe(false);
    expect(p.fitsU64).toBe(true);
    expect(p.reduced).toBe(0n);
  });
  it("flags values beyond u64 without touching the SDK", () => {
    const v = feltInfo(2n ** 64n);
    expect(v.fitsU64).toBe(false);
    expect(v.reduced).toBe(2n ** 32n - 1n);
  });
  it("pads hex to 16 digits", () => {
    expect(feltInfo(1n).hex).toBe("0x0000000000000001");
  });
});

describe("parseWord", () => {
  const hex = "0x0100000000000000020000000000000003000000000000000400000000000000";
  it("felts -> hex (little-endian per felt)", () => {
    expect(parseWord("[1, 2, 3, 4]").hex).toBe(hex);
    expect(parseWord("1 2 3 4").hex).toBe(hex);
  });
  it("hex -> felts", () => {
    expect(parseWord(hex).felts).toEqual([1n, 2n, 3n, 4n]);
    expect(parseWord(hex.toUpperCase().replace("0X", "0x")).felts).toEqual([1n, 2n, 3n, 4n]);
  });
  it("rejects wrong sizes and out-of-field felts", () => {
    expect(() => parseWord("0x01")).toThrow(/64 hex/);
    expect(() => parseWord("1,2,3")).toThrow(/4 felts/);
    expect(() => parseWord(`1,2,3,${MODULUS}`)).toThrow(/modulus/);
    expect(() => parseWord(`1,2,3,${2n ** 64n}`)).toThrow(/modulus/);
    expect(() => parseWord("0x" + "ff".repeat(32))).toThrow();
  });
});
