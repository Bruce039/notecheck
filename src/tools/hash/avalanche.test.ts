// @vitest-environment node
import { MODULUS } from "@/tools/felt/felt";
import { diffBits, diffHex, percent, tweakFelts, tweakString } from "./avalanche";
import { encodeString, hashFelts } from "./hash";

const Z = "0x" + "0".repeat(64);
const F = "0x" + "f".repeat(64);

describe("tweakFelts", () => {
  it("adds one to the last felt, wrapping at p", () => {
    expect(tweakFelts([1n, 2n, 3n])).toMatchObject({ values: [1n, 2n, 4n], index: 2, before: 3n, after: 4n });
    expect(tweakFelts([MODULUS - 1n]).values).toEqual([0n]);
    expect(tweakFelts([]).values).toEqual([0n]);
    expect(tweakFelts([]).before).toBeNull();
  });
  it("never hands the SDK an out-of-field value", () => {
    for (const v of [0n, 1n, MODULUS - 2n, MODULUS - 1n]) {
      expect(tweakFelts([v]).values.every((x) => x >= 0n && x < MODULUS)).toBe(true);
    }
  });
});

describe("tweakString", () => {
  it("moves the last character to the next code point", () => {
    expect(tweakString("hello")).toMatchObject({ text: "hellp", index: 4, before: "o", after: "p" });
    expect(tweakString("a").text).toBe("b");
    expect(tweakString("hi 🦀").text).toBe("hi 🦁");
    expect(tweakString("x\0").text).toBe("x\u0001");
  });
  it("steps back at the end of the code space and around surrogates", () => {
    expect(tweakString("\u{10FFFF}").text).toBe("\u{10FFFE}");
    expect(tweakString("퟿").text).toBe("퟾");
    expect(tweakString("\uDC00").text).toBe("￾"); // a lone surrogate encodes as U+FFFD
    expect(() => tweakString("")).toThrow();
  });
  it("always changes the encoded felts", () => {
    for (const s of ["hello", "a\0", "\u0001", "abcd", "é", "🦀", "￿", "\uDC00", "x\u{10FFFF}"]) {
      expect(encodeString(tweakString(s).text)).not.toEqual(encodeString(s));
    }
  });
});

describe("diff", () => {
  it("counts differing hex digits and bits", () => {
    expect(diffHex(Z, Z)).toMatchObject({ changed: 0, total: 64 });
    expect(diffBits(Z, Z)).toMatchObject({ changed: 0, total: 256 });
    expect(diffHex(Z, F).changed).toBe(64);
    expect(diffBits(Z, F).changed).toBe(256);
    const one = "0x" + "0".repeat(63) + "1";
    expect(diffHex(Z, one).mask.indexOf(true)).toBe(63);
    expect(diffBits(Z, one).mask.indexOf(true)).toBe(255);
    const eight = "0x8" + "0".repeat(63);
    expect(diffBits(Z, eight).mask.indexOf(true)).toBe(0);
    expect(diffBits(Z.toUpperCase().replace("0X", "0x"), Z).changed).toBe(0);
    expect(percent(diffBits(Z, eight))).toBe(0);
    expect(percent(diffHex(Z, F))).toBe(100);
  });
  it("rejects anything that is not a 32-byte word", () => {
    expect(() => diffHex("0x12", Z)).toThrow(/64 hex/);
    expect(() => diffBits(Z, "0x" + "g".repeat(64))).toThrow();
  });
  it("shows the avalanche on a known vector", () => {
    const a = hashFelts([1n, 2n, 3n]).poseidon2.hex;
    const b = hashFelts(tweakFelts([1n, 2n, 3n]).values).poseidon2.hex;
    expect(diffHex(a, b).changed).toBe(62);
    expect(diffBits(a, b).changed).toBe(131);
  });
});
