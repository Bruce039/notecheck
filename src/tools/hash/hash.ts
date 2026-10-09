import { Felt, FeltArray, Poseidon2, Rpo256, type Word } from "@miden-sdk/miden-sdk";
import { release } from "@/lib/wasm";
import { MODULUS, parseUint } from "@/tools/felt/felt";

/** Bytes packed into one felt by `encodeString`. 2^32 - 1 < p, so every chunk is a valid felt. */
export const BYTES_PER_FELT = 4;

/**
 * Parses felts written in decimal or 0x hex, separated by commas/whitespace,
 * optionally wrapped in brackets; one trailing comma is ignored. An empty list ("" or "[]") is allowed.
 * Every value is range-checked here so nothing >= p reaches the SDK.
 */
export function parseFelts(input: string): bigint[] {
  const s = input.trim().replace(/^\[/, "").replace(/\]$/, "").trim().replace(/,$/, "");
  if (!s) return [];
  const parts = s.split(/\s*,\s*|\s+/);
  return parts.map((part, i) => {
    if (!part) throw new Error(`Felt ${i} is empty (check for doubled commas).`);
    let v: bigint;
    try {
      v = parseUint(part);
    } catch {
      throw new Error(`Felt ${i} ("${part}") is not a decimal or 0x-hex integer.`);
    }
    if (v >= MODULUS) throw new Error(`Felt ${i} (${part}) is not below the field modulus.`);
    return v;
  });
}

/**
 * This tool's string convention, not a protocol standard: UTF-8 bytes split
 * into 4-byte chunks, each read as a little-endian u32 felt; the last chunk is
 * zero-padded. No length prefix, so trailing NUL bytes do not change the result.
 */
export function encodeString(text: string): bigint[] {
  const bytes = new TextEncoder().encode(text);
  const felts: bigint[] = [];
  for (let i = 0; i < bytes.length; i += BYTES_PER_FELT) {
    let v = 0n;
    for (let j = 0; j < BYTES_PER_FELT && i + j < bytes.length; j++) {
      v |= BigInt(bytes[i + j]) << BigInt(8 * j);
    }
    felts.push(v);
  }
  return felts;
}

export type Digest = { hex: string; felts: [bigint, bigint, bigint, bigint] };
export type HashResult = { input: bigint[]; poseidon2: Digest; rpo256: Digest };

function digest(hashFn: (a: FeltArray) => Word, values: bigint[]): Digest {
  // In the browser build, `new FeltArray(felts)` consumes each Felt and
  // hashElements consumes the array, so neither is released here.
  const w = hashFn(new FeltArray(values.map((v) => new Felt(v))));
  try {
    const out = w.toFelts();
    const nums = out.map((f) => f.asInt());
    release(...out);
    return { hex: w.toHex(), felts: nums as Digest["felts"] };
  } finally { release(w); }
}

/** Hashes canonical felts with both Poseidon2 and Rpo256. The empty list hashes to the zero word. */
export function hashFelts(values: bigint[]): HashResult {
  values.forEach((v, i) => {
    if (v < 0n || v >= MODULUS) throw new Error(`Felt ${i} is not a valid field element.`);
  });
  return {
    input: values,
    poseidon2: digest((a) => Poseidon2.hashElements(a), values),
    rpo256: digest((a) => Rpo256.hashElements(a), values),
  };
}
