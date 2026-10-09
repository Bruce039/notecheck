// @vitest-environment node
import { MODULUS } from "@/tools/felt/felt";
import { encodeString, hashFelts, parseFelts } from "./hash";

const ZERO_WORD = "0x" + "0".repeat(64);

describe("parseFelts", () => {
  it("reads decimal, hex, separators and brackets", () => {
    expect(parseFelts("1, 2, 3")).toEqual([1n, 2n, 3n]);
    expect(parseFelts("[1 2\n0x3]")).toEqual([1n, 2n, 3n]);
    expect(parseFelts("  [ 0xFF,1 ] ")).toEqual([255n, 1n]);
    expect(parseFelts("1, 2,")).toEqual([1n, 2n]);
    expect(parseFelts(`${MODULUS - 1n}`)).toEqual([MODULUS - 1n]);
  });
  it("treats empty input and [] as an empty list", () => {
    expect(parseFelts("")).toEqual([]);
    expect(parseFelts("[]")).toEqual([]);
    expect(parseFelts("[ ]")).toEqual([]);
  });
  it("rejects junk with the offending index", () => {
    expect(() => parseFelts("1, x, 3")).toThrow(/Felt 1/);
    expect(() => parseFelts("1, -2")).toThrow(/Felt 1/);
    expect(() => parseFelts("1,,2")).toThrow(/Felt 1 is empty/);
    expect(() => parseFelts("1.5")).toThrow(/Felt 0/);
  });
  it("rejects values at or above p, including beyond u64", () => {
    expect(() => parseFelts(`1, ${MODULUS}`)).toThrow(/modulus/);
    expect(() => parseFelts(`${2n ** 64n}`)).toThrow(/modulus/);
    expect(() => parseFelts("0x" + "f".repeat(40))).toThrow(/modulus/);
  });
});

describe("encodeString", () => {
  it("packs UTF-8 bytes 4 per felt, little-endian, last chunk zero-padded", () => {
    expect(encodeString("")).toEqual([]);
    expect(encodeString("abc")).toEqual([0x636261n]);
    expect(encodeString("hello")).toEqual([0x6c6c6568n, 0x6fn]);
    expect(encodeString("é")).toEqual([0xa9c3n]);
  });
  it("is deterministic and always yields canonical felts", () => {
    const s = "Miden 🦀 ".repeat(20);
    expect(encodeString(s)).toEqual(encodeString(s));
    expect(encodeString(s).every((v) => v < 2n ** 32n)).toBe(true);
  });
});

describe("hashFelts", () => {
  it("matches known vectors for [1, 2, 3]", () => {
    const r = hashFelts([1n, 2n, 3n]);
    expect(r.poseidon2.hex).toBe("0xe5f7639e0e50bd1f68e39dc1f8f63302b71d81f641376ee86787ffe67bc8bcbc");
    expect(r.rpo256.hex).toBe("0x2f5d0913b615740fa193b141c1061790eca5c7a0b1e8fd430ebe02b7053032dc");
    expect(r.poseidon2.felts).toHaveLength(4);
    r.poseidon2.felts.forEach((f) => expect(f < MODULUS).toBe(true));
  });
  it("digest felts agree with the hex (8 little-endian bytes each)", () => {
    const { hex, felts } = hashFelts([1n, 2n, 3n]).poseidon2;
    const fromHex = [0, 1, 2, 3].map((i) => {
      const chunk = hex.slice(2 + i * 16, 2 + (i + 1) * 16).match(/../g)!.reverse().join("");
      return BigInt("0x" + chunk);
    });
    expect(felts).toEqual(fromHex);
  });
  it("hashes the empty list to the zero word", () => {
    const r = hashFelts([]);
    expect(r.poseidon2.hex).toBe(ZERO_WORD);
    expect(r.rpo256.hex).toBe(ZERO_WORD);
  });
  it("hashes strings deterministically and distinguishes inputs", () => {
    const a = hashFelts(encodeString("hello"));
    expect(hashFelts(encodeString("hello"))).toEqual(a);
    expect(hashFelts(encodeString("hellp")).poseidon2.hex).not.toBe(a.poseidon2.hex);
  });
  it("rejects out-of-field values before reaching the SDK", () => {
    expect(() => hashFelts([MODULUS])).toThrow();
    expect(() => hashFelts([2n ** 64n])).toThrow();
    expect(() => hashFelts([-1n])).toThrow();
  });
});
