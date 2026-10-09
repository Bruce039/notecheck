// Test helper: builds the kind of private P2ID note a wallet send produces, plus a
// request that creates it, so tests can play the wallet's part.
import {
  FungibleAsset, Note, NoteArray, NoteAssets, NoteAttachment, NoteType,
  TransactionRequestBuilder, type TransactionRequest,
} from "@miden-sdk/miden-sdk";
import { release } from "@/lib/wasm";
import { parseAccountId } from "@/tools/address/account";

export type BuiltPayment = { noteId: string; noteBytes: Uint8Array; note: Note; request: TransactionRequest };

const bytesOf = (x: Uint8Array | number[]) => (x instanceof Uint8Array ? x : Uint8Array.from(x));

export function buildTestPayment(p: { sender: string; recipient: string; faucetId: string; amount: bigint }): BuiltPayment {
  const sender = parseAccountId(p.sender).id;
  const recipient = parseAccountId(p.recipient).id;
  const faucet = parseAccountId(p.faucetId).id;
  const assets = new NoteAssets([new FungibleAsset(faucet, p.amount)]);
  const attachment = new NoteAttachment();
  const note = Note.createP2IDNote(sender, recipient, assets, NoteType.Private, attachment);
  release(sender, recipient, faucet, assets, attachment);
  const noteId = note.id().toString();
  const noteBytes = bytesOf(note.serialize());
  // NoteArray consumes its note in the browser build, so it gets a copy.
  const request = new TransactionRequestBuilder()
    .withOwnOutputNotes(new NoteArray([Note.deserialize(noteBytes)]))
    .build();
  return { noteId, noteBytes, note, request };
}
