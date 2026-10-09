import { NoteId, NoteType, Word, type FetchedNote, type RpcClient } from "@miden-sdk/miden-sdk";
import { release } from "@/lib/wasm";
import { inspectNoteFileBytes, type NoteSummary } from "./inspect";

/** The part of RpcClient verification needs; injectable for tests. */
export type VerifyRpc = Pick<RpcClient, "getNotesById" | "getNullifierCommitHeight" | "getBlockHeaderByNumber">;

export type Verification =
  | { status: "not-found"; summary: NoteSummary }
  /** The note ID is on chain but its metadata (sender, tag, type) differs from the file. */
  | { status: "mismatch"; summary: NoteSummary; reason: string }
  /** Times are unix seconds from the block headers. */
  | {
      status: "included";
      summary: NoteSummary;
      inclusionBlock: number;
      inclusionTime: number;
      spentAt: number | null;
      spentTime: number | null;
    };

type OnChain = { noteId: string; sender: string; tag: number; visibility: "private" | "public"; block: number };

/** Reads what is compared out of a FetchedNote and frees everything it touched. */
function readFetched(f: FetchedNote): OnChain {
  // Each getter returns a fresh copy.
  const id = f.noteId;
  const metadata = f.metadata;
  const proof = f.inclusionProof;
  const location = proof.location();
  const sender = metadata.sender();
  const tag = metadata.tag();
  try {
    return {
      noteId: id.toString(),
      sender: sender.toString(),
      tag: tag.asU32(),
      visibility: metadata.noteType() === NoteType.Public ? "public" : "private",
      block: location.blockNum(),
    };
  } finally {
    release(sender, tag, location, proof, metadata, id);
  }
}

async function blockTime(rpc: VerifyRpc, block: number): Promise<number> {
  const header = await rpc.getBlockHeaderByNumber(block);
  try { return header.timestamp(); } finally { release(header); }
}

/**
 * Checks a receipt (NoteFile bytes, Full format) against the chain. Everything in the result
 * comes from the note in the file, whose ID is recomputed from its contents here; "included"
 * means that ID is on chain with the same sender, tag and type. Throws `UnsupportedReceiptError`
 * for files that cannot be receipts and passes RPC errors through. Calls are sequential.
 */
export async function verifyReceipt(rpc: VerifyRpc, noteFileBytes: Uint8Array): Promise<Verification> {
  const summary = inspectNoteFileBytes(noteFileBytes);

  // getNotesById consumes the NoteIds in the array; the id is not used afterwards.
  const fetched = await rpc.getNotesById([NoteId.fromHex(summary.noteId)]);
  let onChain: OnChain | null = null;
  try {
    for (const f of fetched) {
      const r = readFetched(f);
      if (r.noteId === summary.noteId) { onChain = r; break; }
    }
  } finally {
    release(...fetched);
  }
  if (!onChain) return { status: "not-found", summary };

  const diffs: string[] = [];
  if (onChain.sender !== summary.sender) diffs.push(`sender is ${onChain.sender} on chain, ${summary.sender} in the file`);
  if (onChain.tag !== summary.tag) diffs.push(`tag is ${onChain.tag} on chain, ${summary.tag} in the file`);
  if (onChain.visibility !== summary.visibility) {
    diffs.push(`note type is ${onChain.visibility} on chain, ${summary.visibility} in the file`);
  }
  if (diffs.length) return { status: "mismatch", summary, reason: diffs.join("; ") };

  const inclusionBlock = onChain.block;
  const nullifier = Word.fromHex(summary.nullifier);
  let spent: number | undefined;
  try {
    // Borrows the Word.
    spent = await rpc.getNullifierCommitHeight(nullifier, inclusionBlock);
  } finally {
    release(nullifier);
  }
  const spentAt = spent ?? null;
  const inclusionTime = await blockTime(rpc, inclusionBlock);
  const spentTime = spentAt === null ? null : await blockTime(rpc, spentAt);
  return { status: "included", summary, inclusionBlock, inclusionTime, spentAt, spentTime };
}
