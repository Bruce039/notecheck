/**
 * Avalanche helpers: a deterministic one-step change to the input and a
 * digit/bit diff between two digests. Pure (no SDK); hashing stays in hash.ts.
 */
import { MODULUS } from "@/tools/felt/felt";

export type FeltTweak = { values: bigint[]; index: number; before: bigint | null; after: bigint; summary: string };

/** Adds 1 (mod p) to the last felt; an empty list gets a single 0 felt. */
export function tweakFelts(values: bigint[]): FeltTweak {
  if (values.length === 0) {
    return { values: [0n], index: 0, before: null, after: 0n, summary: "Append felt 0" };
  }
  const index = values.length - 1;
  const before = values[index];
  const after = (before + 1n) % MODULUS;
  return { values: [...values.slice(0, index), after], index, before, after, summary: `Last felt + 1 (mod p)` };
}

export type StringTweak = { text: string; index: number; before: string; after: string; summary: string };

const isSurrogate = (cp: number) => cp >= 0xd800 && cp <= 0xdfff;

/**
 * Moves the last character to the next code point ("hello" -> "hellp"),
 * or the previous one when the next is not a valid scalar value.
 * Never produces U+0000, which the string encoding could not tell apart from padding.
 */
export function tweakString(text: string): StringTweak {
  const chars = Array.from(text);
  if (chars.length === 0) throw new Error("Nothing to change in an empty string.");
  const index = chars.length - 1;
  const before = chars[index];
  // A lone surrogate is encoded as U+FFFD, so start from that.
  const raw = before.codePointAt(0)!;
  const cp = isSurrogate(raw) ? 0xfffd : raw;
  let next = cp + 1;
  if (next > 0x10ffff || isSurrogate(next)) next = cp - 1;
  const after = String.fromCodePoint(next);
  return {
    text: [...chars.slice(0, index), after].join(""),
    index, before, after, summary: "Last character + 1 code point",
  };
}

const hexBody = (h: string) => {
  const s = h.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error("Expected a 32-byte word as 0x + 64 hex digits.");
  return s;
};

export type Diff = { mask: boolean[]; changed: number; total: number };

/** Which hex digits differ between two word digests. */
export function diffHex(a: string, b: string): Diff {
  const x = hexBody(a), y = hexBody(b);
  const mask = Array.from(x, (c, i) => c !== y[i]);
  return { mask, changed: mask.filter(Boolean).length, total: mask.length };
}

/** Which of the 256 bits differ, in hex-string order, most significant bit of each digit first. */
export function diffBits(a: string, b: string): Diff {
  const x = hexBody(a), y = hexBody(b);
  const mask: boolean[] = [];
  for (let i = 0; i < 64; i++) {
    const d = parseInt(x[i], 16) ^ parseInt(y[i], 16);
    for (let bit = 3; bit >= 0; bit--) mask.push(((d >> bit) & 1) === 1);
  }
  return { mask, changed: mask.filter(Boolean).length, total: mask.length };
}

export const percent = (d: Diff) => Math.round((d.changed / d.total) * 100);
