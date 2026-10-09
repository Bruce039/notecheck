// @vitest-environment node
import { Note, NoteId, NoteInclusionProof, NoteRecipient, NoteScript, type FetchedNote } from "@miden-sdk/miden-sdk";
import { TESTNET_RECEIPT as F } from "./fixtures.js";
import { inspectNoteFileBytes } from "../src/inspect.js";
import { pickPaymentNote, receiptIfCommitted, type ReceiptRpc } from "../src/payment.js";
import { parseAmount } from "../src/tokens.js";
import { buildTestPayment } from "./testNote.js";

const base = { sender: F.sender, recipient: F.recipient, faucetId: F.faucetId, amount: 1_500_000n };
const expected = { recipient: F.recipient, faucetId: F.faucetId, amount: 1_500_000n };

describe("pickPaymentNote", () => {
  it("returns the matching P2ID note", () => {
    const p = buildTestPayment(base);
    const bytes = pickPaymentNote([p.note], expected);
    expect(Note.deserialize(bytes).id().toString()).toBe(p.noteId);
  });
  it("accepts bech32 forms of the expected ids", () => {
    const p = buildTestPayment(base);
    expect(() => pickPaymentNote([p.note], { ...expected, recipient: "mtst1ap6wl92rd8jfwsgehu25ukeh5ykn7970" })).not.toThrow();
  });
  it("skips notes that don't match and picks the right one", () => {
    const other = buildTestPayment({ ...base, amount: 7n });
    const right = buildTestPayment(base);
    expect(Note.deserialize(pickPaymentNote([other.note, right.note], expected)).id().toString()).toBe(right.noteId);
  });
  it("refuses when nothing matches: amount, recipient, faucet", () => {
    const p = buildTestPayment(base);
    expect(() => pickPaymentNote([p.note], { ...expected, amount: 1n })).toThrow(/expected payment/);
    expect(() => pickPaymentNote([p.note], { ...expected, recipient: F.sender })).toThrow(/expected payment/);
    expect(() => pickPaymentNote([p.note], { ...expected, faucetId: F.sender })).toThrow(/expected payment/);
    expect(() => pickPaymentNote([], expected)).toThrow(/expected payment/);
  });
  it("never picks a non-P2ID note", () => {
    const p = buildTestPayment(base);
    const r = p.note.recipient();
    const swapLike = new Note(p.note.assets(), p.note.metadata(), new NoteRecipient(r.serialNum(), NoteScript.swap(), r.storage()));
    expect(() => pickPaymentNote([swapLike], expected)).toThrow(/expected payment/);
  });
});

describe("receiptIfCommitted", () => {
  const fakeRpc = (found: boolean, block = 1234): ReceiptRpc => ({
    getNotesById: async (ids: NoteId[]) => {
      const id = ids[0].toString();
      if (!found) return [];
      return [{ noteId: NoteId.fromHex(id), inclusionProof: NoteInclusionProof.mockAtBlock(block) } as unknown as FetchedNote];
    },
  });

  it("returns null until the note is on chain", async () => {
    expect(await receiptIfCommitted(fakeRpc(false), buildTestPayment(base).noteBytes)).toBeNull();
  });

  it("produces a Full NoteFile that passes the receipt checks", async () => {
    const p = buildTestPayment(base);
    const bytes = await receiptIfCommitted(fakeRpc(true, 4321), p.noteBytes);
    expect(bytes).not.toBeNull();
    const s = inspectNoteFileBytes(bytes!);
    expect(s.noteId).toBe(p.noteId);
    expect(s.kind).toBe("P2ID");
    expect(s.visibility).toBe("private");
    expect(s.sender).toBe(F.sender);
    expect(s.recipient).toBe(F.recipient);
    expect(s.assets).toEqual([{ faucetId: F.faucetId, amount: 1_500_000n }]);
  });
});

describe("parseAmount", () => {
  it("converts decimals exactly", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(parseAmount("1,000", 2)).toBe(100_000n);
    expect(parseAmount("7", 0)).toBe(7n);
  });
  it("rejects too many decimals and junk", () => {
    expect(() => parseAmount("1.0000001", 6)).toThrow(/decimal places/);
    expect(() => parseAmount("-1", 6)).toThrow();
    expect(() => parseAmount("1e6", 6)).toThrow();
    expect(() => parseAmount("", 6)).toThrow();
  });
});
