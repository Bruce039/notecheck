import { NETWORKS, type Network } from "@/lib/network";
import { fromBase64Url, gunzip, gzip, toBase64Url } from "./bytes";
import { PBKDF2_ITERATIONS, decrypt, encrypt } from "./crypto";

/**
 * miden-receipt/v1. Lives in the URL fragment (`/r#r1.…` or `/r#r1e.…` when
 * password-protected), so it never reaches a server. Only `noteFile` is verified
 * against the chain; memo, createdAt and txId are the sender's claims.
 */
export type ReceiptV1 = {
  v: 1;
  network: Network;
  /** Standard base64 of NoteFile.serialize() in Full (NoteWithProof) format. */
  noteFile: string;
  memo?: string;
  createdAt?: string;
  txId?: string;
};

export const MEMO_MAX = 280;
const PLAIN = "r1.";
const ENCRYPTED = "r1e.";
const MAX_FRAGMENT = 16_384;
const MAX_JSON = 32_768;

/**
 * Memo text as it will be stored and shown: control and format characters (incl. bidi
 * overrides and zero-width characters) removed, whitespace collapsed, leading check/cross
 * glyphs dropped so a memo can't imitate the verdict.
 */
export function cleanMemo(memo: string): string {
  return memo
    .replace(/[\s\u2028\u2029]+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/^[\s✓✔☑✅✕✗✘❌]+/u, "")
    .trim();
}

export class PasswordRequiredError extends Error {
  constructor() { super("This receipt is password-protected."); }
}

export const isEncryptedFragment = (fragment: string) => stripHash(fragment).startsWith(ENCRYPTED);

const stripHash = (s: string) => s.trim().replace(/^#/, "");

export function validateReceipt(x: unknown): ReceiptV1 {
  if (typeof x !== "object" || x === null) throw new Error("Receipt is not an object.");
  const r = x as Record<string, unknown>;
  if (r.v !== 1) throw new Error(`Unsupported receipt version: ${String(r.v)}.`);
  if (!NETWORKS.includes(r.network as Network)) throw new Error("Unknown network in receipt.");
  if (typeof r.noteFile !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(r.noteFile) || r.noteFile.length > 12_000) {
    throw new Error("Receipt has no valid note file.");
  }
  if (r.memo !== undefined && (typeof r.memo !== "string" || r.memo.length > MEMO_MAX)) {
    throw new Error(`Memo must be text up to ${MEMO_MAX} characters.`);
  }
  const memo = typeof r.memo === "string" ? cleanMemo(r.memo) : undefined;
  if (r.createdAt !== undefined && (typeof r.createdAt !== "string" || Number.isNaN(Date.parse(r.createdAt)))) {
    throw new Error("Invalid createdAt.");
  }
  if (r.txId !== undefined && (typeof r.txId !== "string" || !/^0x[0-9a-f]{64}$/.test(r.txId))) {
    throw new Error("Invalid transaction id.");
  }
  const out: ReceiptV1 = { v: 1, network: r.network as Network, noteFile: r.noteFile };
  if (memo) out.memo = memo;
  if (r.createdAt) out.createdAt = r.createdAt as string;
  if (r.txId) out.txId = r.txId as string;
  return out;
}

/** Returns the fragment (without '#'). */
export async function encodeReceipt(receipt: ReceiptV1, password?: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(validateReceipt(receipt)));
  const packed = await gzip(json);
  return password
    ? ENCRYPTED + toBase64Url(await encrypt(packed, password, iterations))
    : PLAIN + toBase64Url(packed);
}

export async function decodeReceipt(fragment: string, password?: string, iterations = PBKDF2_ITERATIONS): Promise<ReceiptV1> {
  const f = stripHash(fragment);
  if (f.length > MAX_FRAGMENT) throw new Error("Receipt link is too long.");
  let packed: Uint8Array;
  if (f.startsWith(ENCRYPTED)) {
    if (!password) throw new PasswordRequiredError();
    packed = await decrypt(fromBase64Url(f.slice(ENCRYPTED.length)), password, iterations);
  } else if (f.startsWith(PLAIN)) {
    try {
      packed = fromBase64Url(f.slice(PLAIN.length));
    } catch {
      throw new Error("This receipt link is damaged or incomplete.");
    }
  } else {
    throw new Error("Not a Miden receipt link.");
  }
  const json = new TextDecoder("utf-8", { fatal: true }).decode(await gunzip(packed, MAX_JSON));
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Receipt data is not valid JSON.");
  }
  return validateReceipt(parsed);
}

export const receiptUrl = (origin: string, fragment: string) => `${origin.replace(/\/$/, "")}/r#${fragment}`;
