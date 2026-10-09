import { InputNote, Note, NoteFile, NoteId, type RpcClient } from "@miden-sdk/miden-sdk";
import { bytesOf, release } from "./wasm.js";
import { normalizeAccountId } from "./account.js";
import { inspectNote, UnsupportedReceiptError } from "./inspect.js";

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
      throw new Error(`The note hasn't been confirmed on chain yet${why}.`);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

/** Note ID (0x hex) of serialized Note bytes, for display and explorer links. */
export function noteIdOfBytes(noteBytes: Uint8Array): string {
  const note = Note.deserialize(noteBytes);
  try {
    const id = note.id();
    const hex = id.toString();
    release(id);
    return hex;
  } finally { release(note); }
}
