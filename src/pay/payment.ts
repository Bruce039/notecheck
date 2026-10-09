import { InputNote, Note, NoteFile, NoteId, type RpcClient } from "@miden-sdk/miden-sdk";
import type { Network } from "@/lib/network";
import { release } from "@/lib/wasm";
import { normalizeAccountId } from "@/tools/address/account";
import { inspectNote, UnsupportedReceiptError } from "@/receipt/inspect";

const bytesOf = (x: Uint8Array | number[]) => (x instanceof Uint8Array ? x : Uint8Array.from(x));

/**
 * Picks the payment note out of the notes the wallet reports for a finished send and returns
 * its bytes. It must be a P2ID note to `recipient` carrying exactly `amount` of `faucetId`;
 * anything else is refused, so a receipt never describes a different payment.
 */
export function pickPaymentNote(
  notes: Note[],
  expected: { recipient: string; faucetId: string; amount: bigint },
): Uint8Array {
  const recipient = normalizeAccountId(expected.recipient);
  const faucetId = normalizeAccountId(expected.faucetId);
  for (const note of notes) {
    let s;
    try {
      s = inspectNote(note);
    } catch (e) {
      if (e instanceof UnsupportedReceiptError) continue;
      throw e;
    }
    const assetOk = s.assets.length === 1 && s.otherAssets === 0
      && s.assets[0].faucetId === faucetId && s.assets[0].amount === expected.amount;
    if (s.kind === "P2ID" && s.recipient === recipient && assetOk) return bytesOf(note.serialize());
  }
  throw new Error("The wallet's transaction doesn't contain the expected payment note, so no receipt can be made.");
}

export type ReceiptRpc = Pick<RpcClient, "getNotesById">;

/**
 * Returns the receipt NoteFile bytes once the note is on chain, or null while it isn't.
 * The NoteFile carries the node's inclusion proof (Full / NoteWithProof format).
 */
export async function receiptIfCommitted(rpc: ReceiptRpc, noteBytes: Uint8Array): Promise<Uint8Array | null> {
  const note = Note.deserialize(noteBytes);
  try {
    const id = note.id();
    const idHex = id.toString();
    release(id);
    // getNotesById consumes the NoteId array elements.
    const fetched = await rpc.getNotesById([NoteId.fromHex(idHex)]);
    const hit = fetched.find((f) => {
      const fid = f.noteId;
      const same = fid.toString() === idHex;
      release(fid);
      return same;
    });
    if (!hit) {
      release(...fetched);
      return null;
    }
    const proof = hit.inclusionProof;
    const input = InputNote.authenticated(note, proof);
    const file = NoteFile.fromInputNote(input);
    const bytes = bytesOf(file.serialize());
    release(file, input, proof, ...fetched);
    return bytes;
  } finally { release(note); }
}

/**
 * Polls until the note is committed. A failed poll (node timeout, dropped connection) is
 * retried until the deadline; only then is the last error reported.
 */
export async function waitForReceipt(
  rpcCall: <T>(fn: (rpc: ReceiptRpc) => Promise<T>) => Promise<T>,
  noteBytes: Uint8Array,
  { timeoutMs = 180_000, intervalMs = 3_000, signal }: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const end = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    if (signal?.aborted) throw new Error("Cancelled.");
    try {
      const r = await rpcCall((rpc) => receiptIfCommitted(rpc, noteBytes));
      if (r) return r;
      lastError = undefined;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() > end) {
      const why = lastError instanceof Error ? ` (last error: ${lastError.message})` : "";
      throw new Error(`The note hasn't been confirmed on chain yet${why}. You can finish the receipt later from this page.`);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

// --- Pending payments survive a closed tab: the note details exist only here until the receipt is made.

/** A send the wallet accepted. `noteB64` is filled in once the wallet reports the note. */
export type PendingPayment = {
  txId: string;
  network: Network;
  recipient: string;
  faucetId: string;
  amount: string;
  memo?: string;
  noteB64?: string;
  /** On-chain transaction id, as the wallet reports it on completion. */
  chainTxId?: string;
  createdAt: string;
};

const KEY = "pending-payments-v2";

export function loadPending(): PendingPayment[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => typeof p?.txId === "string" && typeof p?.recipient === "string") : [];
  } catch {
    return [];
  }
}

export function savePending(p: PendingPayment): void {
  try {
    const rest = loadPending().filter((x) => x.txId !== p.txId);
    localStorage.setItem(KEY, JSON.stringify([...rest, p]));
  } catch { /* storage unavailable: the flow still works while the tab stays open */ }
}

export function clearPending(txId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadPending().filter((x) => x.txId !== txId)));
  } catch { /* ignore */ }
}

/** Decimal string → base units, exact. "1.5", 6 → 1500000n. */
export function parseAmount(input: string, decimals: number): bigint {
  const s = input.trim().replace(/[_,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter an amount like 12.5");
  const [int, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places.`);
  return BigInt(int + frac.padEnd(decimals, "0"));
}

// --- Receipts made in this browser, so a closed tab doesn't lose the link.

export type RecentReceipt = { url: string; createdAt: string; amount: string; recipient: string; network: Network };

const RECENT_KEY = "recent-receipts";
const RECENT_MAX = 20;

export function loadRecent(): RecentReceipt[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((r) => typeof r?.url === "string" && r.url.includes("/r#")) : [];
  } catch {
    return [];
  }
}

export function saveRecent(r: RecentReceipt): void {
  try {
    const rest = loadRecent().filter((x) => x.url !== r.url);
    localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...rest].slice(0, RECENT_MAX)));
  } catch { /* storage unavailable */ }
}

export function removeRecent(url: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecent().filter((x) => x.url !== url)));
  } catch { /* ignore */ }
}
