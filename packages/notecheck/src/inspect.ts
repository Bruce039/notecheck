import { AccountId, NoteFile, NoteScript, NoteType, type Felt, type Note } from "@miden-sdk/miden-sdk";
import { release } from "./wasm.js";

export type ReceiptAsset = { faucetId: string; amount: bigint };

export type NoteSummary = {
  noteId: string;
  nullifier: string;
  kind: "P2ID" | "P2IDE";
  /** 0x hex account IDs. `recipient` is the target named in the note storage. */
  sender: string;
  recipient: string;
  /** Fungible assets. */
  assets: ReceiptAsset[];
  /** Number of non-fungible assets, which are not listed. */
  otherAssets: number;
  visibility: "private" | "public";
  tag: number;
  /**
   * P2IDE only, else null. From this block on, `reclaimer` may take the assets back while the
   * note is unspent; null means reclaim is disabled (stored as 0).
   */
  reclaimHeight: number | null;
  /** P2IDE only, else null. The note cannot be consumed before this block; null = no timelock (0). */
  timelockHeight: number | null;
  /** P2IDE only, else null. Defaults to the sender but may be any account. */
  reclaimer: string | null;
};

export type UnsupportedReceiptCode = "malformed" | "not-full" | "not-p2id";

export class UnsupportedReceiptError extends Error {
  readonly code: UnsupportedReceiptCode;
  constructor(code: UnsupportedReceiptCode, message: string) {
    super(message);
    this.name = "UnsupportedReceiptError";
    this.code = code;
  }
}

/** Upper bound for a receipt file; a P2ID receipt is ~460 bytes. */
export const MAX_RECEIPT_BYTES = 64 * 1024;

const NOT_FULL =
  "This file has note details only; export it in Full format (with inclusion proof).";

/** Decodes standard or URL-safe base64 (padding optional, whitespace ignored). */
export function noteFileFromBase64(b64: string): Uint8Array {
  const s = b64.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!s || !/^[A-Za-z0-9+/]*$/.test(s) || s.length % 4 === 1) {
    throw new UnsupportedReceiptError("malformed", "The receipt is not valid base64.");
  }
  if ((s.length * 3) / 4 > MAX_RECEIPT_BYTES) {
    throw new UnsupportedReceiptError("malformed", "The receipt is too large.");
  }
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let roots: { p2id: string; p2ide: string } | null = null;

function standardRoots(): { p2id: string; p2ide: string } {
  if (!roots) {
    const p2id = NoteScript.p2id();
    const p2ide = NoteScript.p2ide();
    const r1 = p2id.root();
    const r2 = p2ide.root();
    roots = { p2id: r1.toHex(), p2ide: r2.toHex() };
    release(r1, r2, p2id, p2ide);
  }
  return roots;
}

/** Account ID from storage felts `[suffix, prefix]`; null when they do not form a valid ID. */
function accountAt(items: Felt[], suffixIdx: number): string | null {
  try {
    // fromPrefixSuffix borrows both felts.
    const id = AccountId.fromPrefixSuffix(items[suffixIdx + 1], items[suffixIdx]);
    try { return id.toString(); } finally { release(id); }
  } catch {
    return null;
  }
}

/** Optional block height as stored by P2IDE: 0 = none; anything above u32 is invalid. */
function optionalHeight(v: bigint): number | null | undefined {
  if (v === 0n) return null;
  if (v > 0xffff_ffffn) return undefined;
  return Number(v);
}

type Storage = Pick<NoteSummary, "kind" | "recipient" | "reclaimHeight" | "timelockHeight" | "reclaimer">;

/**
 * Target and options from the note storage. Layouts (miden-standards v0.17.1):
 *   P2ID  (4): [target_suffix, target_prefix, salt_0, salt_1]
 *   P2IDE (6): [reclaimer_suffix, reclaimer_prefix, target_suffix, target_prefix, reclaim_height, timelock_height]
 */
function readStorage(kind: "P2ID" | "P2IDE", values: bigint[], items: Felt[]): Storage {
  const bad = (what: string) =>
    new UnsupportedReceiptError("malformed", `The ${kind} note has invalid storage (${what}).`);
  if (kind === "P2ID") {
    if (items.length !== 4) throw bad(`${items.length} items, expected 4`);
    const recipient = accountAt(items, 0);
    if (!recipient) throw bad("target account ID");
    return { kind, recipient, reclaimHeight: null, timelockHeight: null, reclaimer: null };
  }
  if (items.length !== 6) throw bad(`${items.length} items, expected 6`);
  const reclaimer = accountAt(items, 0);
  if (!reclaimer) throw bad("reclaimer account ID");
  const recipient = accountAt(items, 2);
  if (!recipient) throw bad("target account ID");
  const reclaimHeight = optionalHeight(values[4]);
  const timelockHeight = optionalHeight(values[5]);
  if (reclaimHeight === undefined) throw bad("reclaim height");
  if (timelockHeight === undefined) throw bad("timelock height");
  return { kind, recipient, reclaimHeight, timelockHeight, reclaimer };
}

/**
 * Summary of a P2ID/P2IDE note. Throws `UnsupportedReceiptError("not-p2id")` for any other
 * script: a receipt reveals the serial number, so a note without a target check could be
 * consumed by whoever sees it. The caller keeps ownership of `note`.
 */
export function inspectNote(note: Note): NoteSummary {
  const script = note.script();
  const root = script.root();
  const rootHex = root.toHex();
  release(root, script);
  const std = standardRoots();
  const kind = rootHex === std.p2id ? "P2ID" : rootHex === std.p2ide ? "P2IDE" : null;
  if (!kind) {
    throw new UnsupportedReceiptError(
      "not-p2id",
      "Only P2ID and P2IDE notes can be shown as receipts; this note uses another script.",
    );
  }

  const recipientObj = note.recipient();
  const storageObj = recipientObj.storage();
  const items = storageObj.items();
  let storage: Storage;
  try {
    storage = readStorage(kind, items.map((f) => f.asInt()), items);
  } finally {
    release(...items, storageObj, recipientObj);
  }

  const id = note.id();
  const noteId = id.toString();
  const nullifierWord = note.nullifier();
  const nullifier = nullifierWord.toHex();
  release(id, nullifierWord);

  const metadata = note.metadata();
  const senderId = metadata.sender();
  const tagObj = metadata.tag();
  const sender = senderId.toString();
  const tag = tagObj.asU32();
  const visibility = metadata.noteType() === NoteType.Public ? "public" : "private";
  release(senderId, tagObj, metadata);

  const noteAssets = note.assets();
  const all = noteAssets.assets();
  const fungible = noteAssets.fungibleAssets();
  const assets = fungible.map((a) => {
    const faucet = a.faucetId();
    const r = { faucetId: faucet.toString(), amount: a.amount() };
    release(faucet);
    return r;
  });
  const otherAssets = all.length - fungible.length;
  release(...fungible, ...all, noteAssets);

  return { noteId, nullifier, sender, assets, otherAssets, visibility, tag, ...storage };
}

/** Deserializes a NoteFile and summarizes its note; see `inspectNote` for the script check. */
export function inspectNoteFileBytes(bytes: Uint8Array): NoteSummary {
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_BYTES) {
    throw new UnsupportedReceiptError("malformed", "This is not a valid note file.");
  }
  let file: NoteFile;
  try {
    // deserialize copies the bytes.
    file = NoteFile.deserialize(bytes);
  } catch {
    throw new UnsupportedReceiptError("malformed", "This is not a valid note file.");
  }
  try {
    const type = file.noteType();
    if (type !== "NoteWithProof") {
      throw new UnsupportedReceiptError(
        "not-full",
        type === "NoteId"
          ? "This file has the note ID only; export it in Full format (with inclusion proof)."
          : NOT_FULL,
      );
    }
    // note() returns a copy owned here.
    const note = file.note();
    if (note == null) throw new UnsupportedReceiptError("not-full", NOT_FULL);
    try { return inspectNote(note); } finally { release(note); }
  } finally {
    release(file);
  }
}
