// @vitest-environment node
import {
  AccountId, Felt, FeltArray, FungibleAsset, InputNote, Note, NoteAssets, NoteAttachment, NoteDetails,
  NoteFile, NoteInclusionProof, NoteMetadata, NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType,
} from "@miden-sdk/miden-sdk";
import { TESTNET_RECEIPT as R } from "./fixtures.js";
import { inspectNote, inspectNoteFileBytes, noteFileFromBase64, UnsupportedReceiptError } from "../src/inspect.js";

const fixtureBytes = () => noteFileFromBase64(R.noteFileB64);
const bytesOf = (x: Uint8Array | number[]) => Uint8Array.from(x);
const fullFile = (note: Note) =>
  bytesOf(NoteFile.fromInputNote(InputNote.authenticated(note, NoteInclusionProof.mockAtBlock(7))).serialize());
const assets = (amount = 5n) => new NoteAssets([new FungibleAsset(AccountId.fromHex(R.faucetId), amount)]);

function rejects(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(UnsupportedReceiptError);
    expect((e as UnsupportedReceiptError).code).toBe(code);
    return (e as Error).message;
  }
  throw new Error("expected UnsupportedReceiptError");
}

describe("noteFileFromBase64", () => {
  it("accepts standard and URL-safe base64, with or without padding", () => {
    const std = fixtureBytes();
    expect(std.length).toBe(459);
    const url = R.noteFileB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(noteFileFromBase64(url)).toEqual(std);
    expect(noteFileFromBase64(` ${R.noteFileB64.slice(0, 40)}\n${R.noteFileB64.slice(40)} `)).toEqual(std);
    expect(noteFileFromBase64("AQID")).toEqual(new Uint8Array([1, 2, 3]));
    expect(noteFileFromBase64("AQ")).toEqual(new Uint8Array([1]));
  });
  it("rejects non-base64 as malformed", () => {
    for (const s of ["", "   ", "abc$", "A", "AQID=A", "ü"]) rejects(() => noteFileFromBase64(s), "malformed");
  });
});

describe("inspectNoteFileBytes", () => {
  it("reads the testnet receipt", () => {
    expect(inspectNoteFileBytes(fixtureBytes())).toEqual({
      noteId: R.noteId,
      nullifier: "0x81988a92bd8f871e69ab08ae6f6f1700fdec079675e7b7dde2e9013b82c564fa",
      kind: "P2ID",
      sender: R.sender,
      recipient: R.recipient,
      assets: [{ faucetId: R.faucetId, amount: R.amount }],
      otherAssets: 0,
      visibility: "private",
      tag: 1961623552,
      reclaimHeight: null,
      timelockHeight: null,
      reclaimer: null,
    });
  });

  it("rejects a file whose note contents no longer match its note ID", () => {
    // The fungible amount 1_000_000 is stored little-endian as 40 42 0f 00; NoteFile
    // decoding recomputes the ID and checks it against the one the proof commits to.
    const bytes = fixtureBytes();
    const at = bytes.findIndex((_, i) => bytes[i] === 0x40 && bytes[i + 1] === 0x42 && bytes[i + 2] === 0x0f);
    expect(at).toBeGreaterThan(0);
    bytes[at + 2] = 0x1f;
    rejects(() => inspectNoteFileBytes(bytes), "malformed");
  });

  it("rejects garbage as malformed", () => {
    rejects(() => inspectNoteFileBytes(new Uint8Array()), "malformed");
    rejects(() => inspectNoteFileBytes(new Uint8Array([1, 2, 3])), "malformed");
    rejects(() => inspectNoteFileBytes(fixtureBytes().slice(0, 100)), "malformed");
    rejects(() => inspectNoteFileBytes(new Uint8Array(70_000)), "malformed");
  });

  it("rejects details-only and id-only note files as not-full", () => {
    const note = NoteFile.deserialize(fixtureBytes()).note()!;
    const details = bytesOf(NoteFile.fromNoteDetails(new NoteDetails(note.assets(), note.recipient())).serialize());
    expect(rejects(() => inspectNoteFileBytes(details), "not-full")).toMatch(/Full format/);
    const unauthenticated = bytesOf(NoteFile.fromInputNote(InputNote.unauthenticated(note)).serialize());
    rejects(() => inspectNoteFileBytes(unauthenticated), "not-full");
    const idOnly = bytesOf(NoteFile.fromNoteId(note.id()).serialize());
    expect(rejects(() => inspectNoteFileBytes(idOnly), "not-full")).toMatch(/Full format/);
  });
});

describe("inspectNote", () => {
  const sender = () => AccountId.fromHex(R.sender);
  const target = () => AccountId.fromHex(R.recipient);

  it("accepts a public P2ID note", () => {
    const note = Note.createP2IDNote(sender(), target(), assets(), NoteType.Public, new NoteAttachment());
    const s = inspectNote(note);
    expect(s).toMatchObject({ kind: "P2ID", sender: R.sender, recipient: R.recipient, visibility: "public" });
    expect(s.noteId).toBe(note.id().toString());
    expect(inspectNoteFileBytes(fullFile(note))).toEqual(s);
  });

  it("accepts P2IDE and reads target, reclaimer and heights", () => {
    const note = Note.createP2IDENote(sender(), target(), assets(), 100, 200, NoteType.Private, new NoteAttachment());
    const s = inspectNoteFileBytes(fullFile(note));
    expect(s).toMatchObject({
      kind: "P2IDE", sender: R.sender, recipient: R.recipient, reclaimer: R.sender,
      reclaimHeight: 100, timelockHeight: 200, assets: [{ faucetId: R.faucetId, amount: 5n }],
    });
    expect(s.tag).toBe(NoteTag.withAccountTarget(target()).asU32());

    const open = Note.createP2IDENote(sender(), target(), assets(), null, null, NoteType.Private, new NoteAttachment());
    expect(inspectNote(open)).toMatchObject({ kind: "P2IDE", recipient: R.recipient, reclaimHeight: null, timelockHeight: null });
  });

  it("rejects notes with any other script, also inside a full note file", () => {
    const meta = () => new NoteMetadata(sender(), NoteType.Private, new NoteTag(0));
    const storage = () => new NoteStorage(new FeltArray([new Felt(1n), new Felt(2n), new Felt(0n), new Felt(0n)]));
    for (const script of [NoteScript.burn, NoteScript.swap, NoteScript.mint, NoteScript.pswap]) {
      const note = new Note(assets(), meta(), NoteRecipient.fromScript(script(), storage()));
      rejects(() => inspectNote(note), "not-p2id");
      rejects(() => inspectNoteFileBytes(fullFile(note)), "not-p2id");
    }
  });

  it("rejects P2ID/P2IDE notes whose storage the script would refuse", () => {
    const meta = () => new NoteMetadata(sender(), NoteType.Private, new NoteTag(0));
    const felts = (...v: bigint[]) => new NoteStorage(new FeltArray(v.map((x) => new Felt(x))));
    const t = target();
    const [suffix, prefix] = [t.suffix().asInt(), t.prefix().asInt()];
    const make = (script: NoteScript, storage: NoteStorage) =>
      new Note(assets(), meta(), NoteRecipient.fromScript(script, storage));

    expect(inspectNote(make(NoteScript.p2id(), felts(suffix, prefix, 9n, 9n))).recipient).toBe(R.recipient);
    rejects(() => inspectNote(make(NoteScript.p2id(), felts(suffix, prefix))), "malformed");
    rejects(() => inspectNote(make(NoteScript.p2id(), felts(999n, 888n, 0n, 0n))), "malformed");
    rejects(() => inspectNote(make(NoteScript.p2ide(), felts(suffix, prefix, 0n, 0n))), "malformed");
    rejects(() => inspectNote(make(NoteScript.p2ide(), felts(suffix, prefix, suffix, prefix, 1n << 32n, 0n))), "malformed");
  });
});
