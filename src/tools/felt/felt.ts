import { Felt, Word } from "@miden-sdk/miden-sdk";
import { release } from "@/lib/wasm";

/** Goldilocks field modulus: 2^64 - 2^32 + 1. */
export const MODULUS = 2n ** 64n - 2n ** 32n + 1n;
export const U64_MAX = 2n ** 64n - 1n;

/**
 * Parses a non-negative integer written in decimal or 0x-hex.
 * Range checks happen here, before anything reaches the SDK: a BigInt of 2^64
 * or more makes the WASM side panic instead of throwing.
 */
export function parseUint(input: string): bigint {
  const s = input.trim().replace(/[_\s]/g, "");
  if (!s) throw new Error("Enter a number.");
  if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s);
  if (/^\d+$/.test(s)) return BigInt(s);
  throw new Error("Not a decimal or 0x-hex integer.");
}

export const toHex64 = (v: bigint) => "0x" + v.toString(16).padStart(16, "0");

export type FeltInfo = {
  value: bigint;
  hex: string;
  /** Fits in u64. */
  fitsU64: boolean;
  /** Below the field modulus, i.e. a valid felt as-is. */
  canonical: boolean;
  /** value mod p; what a felt would hold after reduction. */
  reduced: bigint;
};

export function feltInfo(value: bigint): FeltInfo {
  return {
    value,
    hex: toHex64(value),
    fitsU64: value <= U64_MAX,
    canonical: value < MODULUS,
    reduced: value % MODULUS,
  };
}

/** A word as four felts and as the SDK's 32-byte hex (each felt little-endian). */
export type WordInfo = { felts: [bigint, bigint, bigint, bigint]; hex: string };

/** Accepts a 0x + 64 hex char word, or four integers separated by commas/spaces/brackets. */
export function parseWord(input: string): WordInfo {
  const s = input.trim();
  if (!s) throw new Error("Enter a word.");
  if (/^0x[0-9a-f]*$/i.test(s)) {
    if (s.length !== 66) throw new Error(`Word hex must be 0x + 64 hex chars (got ${s.length - 2}).`);
    const w = Word.fromHex(s.toLowerCase());
    try {
      const felts = w.toFelts().map((f) => f.asInt());
      return { felts: felts as WordInfo["felts"], hex: w.toHex() };
    } finally { release(w); }
  }
  const parts = s.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 4) throw new Error(`A word has 4 felts (got ${parts.length}).`);
  const values = parts.map(parseUint);
  values.forEach((v, i) => {
    if (v >= MODULUS) throw new Error(`Felt ${i} is not below the field modulus.`);
  });
  const w = Word.newFromFelts(values.map((v) => new Felt(v)));
  try {
    return { felts: values as WordInfo["felts"], hex: w.toHex() };
  } finally { release(w); }
}
