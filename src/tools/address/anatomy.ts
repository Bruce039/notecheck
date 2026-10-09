/**
 * Bit-level view of an account ID for the anatomy diagram. Pure: works on the
 * prefix/suffix felts that `decodeAccount` already read, so it needs no SDK.
 * Layout as documented in account.ts (positions count from the most significant bit, 0..63):
 *   prefix: [hash 0..57 | asset callback flag 58 | account type 59 | version 60..63]
 *   suffix: [zero bit 0 | hash 1..55 | 8 zero bits 56..63, left out of the 15-byte ID]
 */
import { DEFAULT_TAG_LENGTH } from "@/tools/tag/tag";

export type Row = "prefix" | "suffix";
export type SegmentId = "tag" | "hash" | "callbacks" | "type" | "version" | "zero" | "dropped";
/** Half-open range of bit positions [start, end) in one felt, MSB first. */
export type BitRange = { row: Row; start: number; end: number };
export type Segment = {
  id: SegmentId;
  label: string;
  ranges: BitRange[];
  /** Total bits across ranges. */
  bits: number;
  /** Short decoded value, e.g. "off", "private", "1". */
  value: string;
  /** The value as a phrase, e.g. "callbacks off", "private", "version 1". */
  phrase: string;
  detail: string;
};

export type AnatomyInput = {
  prefix: bigint;
  suffix: bigint;
  version: number;
  visibility: "public" | "private";
  assetCallbacks: boolean;
  /** Default note tag as hex, if known. */
  tagHex?: string;
};

/** 64-char binary string of a felt, most significant bit first. */
export function feltBits(v: bigint): string {
  if (v < 0n || v >= 1n << 64n) throw new Error("Not a 64-bit value.");
  return v.toString(2).padStart(64, "0");
}

const r = (row: Row, start: number, end: number): BitRange => ({ row, start, end });

export function accountSegments(a: AnatomyInput): Segment[] {
  const seg = (id: SegmentId, label: string, ranges: BitRange[], value: string | [string, string], detail: string): Segment => ({
    id, label, ranges, detail,
    value: typeof value === "string" ? value : value[0],
    phrase: typeof value === "string" ? value : value[1],
    bits: ranges.reduce((n, x) => n + x.end - x.start, 0),
  });
  return [
    seg("tag", "Note tag", [r("prefix", 0, DEFAULT_TAG_LENGTH)], a.tagHex ?? `${DEFAULT_TAG_LENGTH} bits`,
      `The top ${DEFAULT_TAG_LENGTH} bits of the prefix. P2ID notes to this account carry them as their tag, ` +
      "so clients can sync matching notes without revealing the full ID."),
    seg("hash", "Hash", [r("prefix", 0, 58), r("suffix", 1, 56)], "58 + 55 bits",
      "Derived from the account seed and its initial code and storage when the account is created. These bits make the ID unique."),
    seg("callbacks", "Asset callbacks", [r("prefix", 58, 59)], a.assetCallbacks ? ["on", "callbacks on"] : ["off", "callbacks off"],
      a.assetCallbacks
        ? "Set: assets issued by this account (as a faucet) run its asset callbacks. Fixed when the ID is created."
        : "Clear: assets issued by this account run no asset callbacks. Fixed when the ID is created."),
    seg("type", "Storage mode", [r("prefix", 59, 60)], a.visibility,
      a.visibility === "public"
        ? "1 = public: the full account state is stored on chain."
        : "0 = private: the chain stores only a commitment to the account state."),
    seg("version", "Version", [r("prefix", 60, 64)], [String(a.version), `version ${a.version}`],
      `The ID layout version, read from the low 4 bits of the prefix (${a.version.toString(2).padStart(4, "0")}).`),
    seg("zero", "Zero bit", [r("suffix", 0, 1)], "always 0",
      "The suffix's top bit is always 0, which keeps the suffix below the field modulus."),
    seg("dropped", "Low byte", [r("suffix", 56, 64)], "not stored",
      "The suffix's low 8 bits are always 0, so the 15-byte (120-bit) ID leaves them out."),
  ];
}

/** The layout segment (never the tag overlay) that owns a bit position. */
export function segmentAt(row: Row, pos: number): SegmentId {
  if (row === "prefix") return pos < 58 ? "hash" : pos === 58 ? "callbacks" : pos === 59 ? "type" : "version";
  return pos === 0 ? "zero" : pos < 56 ? "hash" : "dropped";
}

export function inSegment(s: Segment, row: Row, pos: number): boolean {
  return s.ranges.some((x) => x.row === row && pos >= x.start && pos < x.end);
}

/** CSS grid column (1-based) of bit `pos` in a row with a spacer column after every byte. */
export function bitColumn(pos: number): number {
  return pos + Math.floor(pos / 8) + 1;
}

/** Grid template for 32 bits: 4 bytes of 8 equal columns, separated by narrow spacer columns. */
export const HALF_TEMPLATE = Array.from({ length: 4 }, () => "repeat(8, minmax(0, 1fr))").join(" 3px ");
