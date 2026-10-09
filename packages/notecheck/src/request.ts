import { HRP, NETWORKS, type Network } from "./network.js";
import { fromBase64Url, gunzip, gzip, toBase64Url } from "./bytes.js";
import { MEMO_MAX, cleanMemo, fragmentOf } from "./receipt.js";
import { normalizeAccountId, parseAccountId, toBech32 } from "./account.js";
import { release } from "./wasm.js";

/**
 * miden-request/v1: a payment request ("please pay me this"). Lives in the URL fragment of the
 * Pay tool (`/?tool=pay#q1.…`), so it never reaches a server. Everything in it is the requester's
 * claim: the payer checks the address with the requester and their wallet shows the send.
 */
export type PaymentRequestV1 = {
  v: 1;
  network: Network;
  /** Requester's plain bech32 address (no `_…` routing suffix), on `network`. */
  to: string;
  /** Lowercase 0x hex faucet account ID. */
  faucetId: string;
  /** Base units, positive decimal integer string below 2^63. */
  amount: string;
  memo?: string;
  /** Invoice number or similar, up to REF_MAX characters. */
  ref?: string;
  createdAt?: string;
};

export const REF_MAX = 64;
const PREFIX = "q1.";
const MAX_FRAGMENT = 4_096;
const MAX_JSON = 4_096;
const MAX_U63 = (1n << 63n) - 1n;

const stripHash = fragmentOf;

export const isRequestFragment = (fragment: string) => stripHash(fragment).startsWith(PREFIX);

/** The memo a receipt for this request carries: the request memo plus its reference. */
export function receiptMemoFor(r: Pick<PaymentRequestV1, "memo" | "ref">): string {
  const parts = [r.memo, r.ref ? `ref ${r.ref}` : undefined].filter(Boolean);
  return cleanMemo(parts.join(" · ")).slice(0, MEMO_MAX).trim();
}

function checkAddress(raw: unknown, network: Network): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 100) throw new Error("Request has no valid recipient address.");
  if (raw.includes("_") || /^0x/i.test(raw)) throw new Error("Request recipient must be a plain bech32 address.");
  let parsed;
  try {
    parsed = parseAccountId(raw);
  } catch {
    throw new Error("Request recipient is not a valid address.");
  }
  const hex = parsed.id.toString();
  release(parsed.id);
  if (parsed.input.kind !== "bech32" || parsed.input.hrp !== HRP[network]) {
    throw new Error(`Request recipient is not a ${network} address.`);
  }
  return toBech32(hex, network);
}

function checkFaucet(raw: unknown): string {
  if (typeof raw !== "string" || !/^0x[0-9a-f]{30}$/.test(raw)) throw new Error("Request has no valid token (faucet ID).");
  try {
    return normalizeAccountId(raw).toLowerCase();
  } catch {
    throw new Error("Request has no valid token (faucet ID).");
  }
}

function checkAmount(raw: unknown): string {
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,18}$/.test(raw) || BigInt(raw) > MAX_U63) {
    throw new Error("Request amount must be a positive whole number of base units.");
  }
  return raw;
}

function optionalText(raw: unknown, max: number, what: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length > max) throw new Error(`${what} must be text up to ${max} characters.`);
  return cleanMemo(raw) || undefined;
}

/** Strict check of a decoded request. Unknown fields are dropped. */
export function validateRequest(x: unknown): PaymentRequestV1 {
  if (typeof x !== "object" || x === null || Array.isArray(x)) throw new Error("Request is not an object.");
  const r = x as Record<string, unknown>;
  if (r.v !== 1) throw new Error(`Unsupported request version: ${String(r.v)}.`);
  if (!NETWORKS.includes(r.network as Network)) throw new Error("Unknown network in request.");
  const network = r.network as Network;
  const out: PaymentRequestV1 = {
    v: 1,
    network,
    to: checkAddress(r.to, network),
    faucetId: checkFaucet(r.faucetId),
    amount: checkAmount(r.amount),
  };
  const memo = optionalText(r.memo, MEMO_MAX, "Memo");
  if (memo) out.memo = memo;
  const ref = optionalText(r.ref, REF_MAX, "Reference");
  if (ref) out.ref = ref;
  if (r.createdAt !== undefined) {
    if (typeof r.createdAt !== "string" || r.createdAt.length > 40 || Number.isNaN(Date.parse(r.createdAt))) {
      throw new Error("Invalid createdAt.");
    }
    out.createdAt = r.createdAt;
  }
  return out;
}

/** Returns the fragment (without '#'). */
export async function encodeRequest(request: PaymentRequestV1): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(validateRequest(request)));
  return PREFIX + toBase64Url(await gzip(json));
}

/** Accepts the fragment (with or without '#') or the whole link. */
export async function decodeRequest(fragment: string): Promise<PaymentRequestV1> {
  const f = stripHash(fragment);
  if (!f.startsWith(PREFIX)) throw new Error("Not a payment request link.");
  if (f.length > MAX_FRAGMENT) throw new Error("Payment request link is too long.");
  let packed: Uint8Array;
  try {
    packed = fromBase64Url(f.slice(PREFIX.length));
  } catch {
    throw new Error("This payment request link is damaged or incomplete.");
  }
  let json: string;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(await gunzip(packed, MAX_JSON));
  } catch {
    throw new Error("This payment request link is damaged or incomplete.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Payment request data is not valid JSON.");
  }
  return validateRequest(parsed);
}

export const requestUrl = (origin: string, fragment: string) => `${origin.replace(/\/$/, "")}/?tool=pay#${fragment}`;
