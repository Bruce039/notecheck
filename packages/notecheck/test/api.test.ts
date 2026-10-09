// @vitest-environment node
import {
  AccountId, FetchedNote, FungibleAsset, InputNote, Note, NoteAssets, NoteAttachment, NoteFile, NoteId,
  NoteInclusionProof, NoteMetadata, NoteTag, NoteType, type BlockHeader,
} from "@miden-sdk/miden-sdk";
import { gzipSync } from "node:zlib";
import { TESTNET_RECEIPT as R } from "./fixtures.js";
import { buildTestPayment } from "./testNote.js";
import {
  DEFAULT_BASE_URL, createReceipt, createRequest, decodeReceipt, decodeRequest, inspectNoteFileBytes,
  noteFileFromBase64, toBase64, toBech32, verifyReceipt, type TokenInfo, type VerifyRpc,
} from "../src/index.js";

const TAG = 1961623552;
const USDCX: TokenInfo = { symbol: "USDCX", decimals: 6, source: "token-list", verified: true };
const tokens = async (_n: string, faucet: string) => (faucet === R.faucetId ? USDCX : null);

type OnChain = { id: string; sender?: string; tag?: number; block: number };
type Chain = { notes: OnChain[]; spentAt?: number; tip?: number };

function fakeRpc(chain: Chain): VerifyRpc {
  return {
    getNotesById: async () => chain.notes.map((n) => new FetchedNote(
      NoteId.fromHex(n.id),
      new NoteMetadata(AccountId.fromHex(n.sender ?? R.sender), NoteType.Private, new NoteTag(n.tag ?? TAG)),
      NoteInclusionProof.mockAtBlock(n.block),
    )),
    getNullifierCommitHeight: async () => chain.spentAt,
    getBlockHeaderByNumber: async (n?: number | null) => {
      if (n == null && chain.tip === undefined) throw new Error("no tip");
      const block = n ?? chain.tip!;
      return { blockNum: () => block, timestamp: () => 1_760_000_000 + block } as unknown as BlockHeader;
    },
  };
}

const link = (obj: Record<string, unknown>) =>
  "https://example.org/r#r1." + gzipSync(JSON.stringify({ v: 1, network: "testnet", ...obj })).toString("base64url");
const fixtureLink = link({ noteFile: R.noteFileB64, memo: "Invoice #42", txId: R.txId });

const bytesOf = (x: Uint8Array | number[]) => Uint8Array.from(x);
const p2ideFile = (reclaim: number | null, timelock: number | null) => {
  const assets = new NoteAssets([new FungibleAsset(AccountId.fromHex(R.faucetId), 2_500_000n)]);
  const note = Note.createP2IDENote(
    AccountId.fromHex(R.sender), AccountId.fromHex(R.recipient), assets, reclaim, timelock, NoteType.Private, new NoteAttachment(),
  );
  const bytes = bytesOf(NoteFile.fromInputNote(InputNote.authenticated(note, NoteInclusionProof.mockAtBlock(10))).serialize());
  return { bytes, noteId: note.id().toString(), tag: inspectNoteFileBytes(bytes).tag };
};

describe("verifyReceipt", () => {
  it("confirms the testnet fixture and returns plain JSON", async () => {
    const rpc = fakeRpc({ notes: [{ id: R.noteId, block: R.inclusionBlock }], spentAt: R.spentAt });
    const r = await verifyReceipt(fixtureLink, { rpc, tokens });
    expect(r).toMatchObject({
      status: "confirmed",
      network: "testnet",
      noteId: R.noteId,
      kind: "P2ID",
      amount: [{ faucetId: R.faucetId, amount: "1000000", symbol: "USDCX", decimals: 6, formatted: "1", verified: true }],
      recipient: { hex: R.recipient, bech32: toBech32(R.recipient, "testnet") },
      sender: { hex: R.sender, bech32: toBech32(R.sender, "testnet") },
      inclusionBlock: R.inclusionBlock,
      inclusionTime: new Date((1_760_000_000 + R.inclusionBlock) * 1000).toISOString(),
      spentAt: R.spentAt,
      received: "yes",
      reclaim: null,
      claims: { memo: "Invoice #42", txId: R.txId },
      explorer: {
        note: `https://testnet.midenscan.com/note/${R.noteId}`,
        tx: `https://testnet.midenscan.com/tx/${R.txId}`,
      },
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("accepts the bare fragment, with or without '#'", async () => {
    const rpc = fakeRpc({ notes: [{ id: R.noteId, block: R.inclusionBlock }] });
    const fragment = fixtureLink.slice(fixtureLink.indexOf("#") + 1);
    for (const f of [fragment, `#${fragment}`]) {
      const r = await verifyReceipt(f, { rpc, tokens: false });
      expect(r.status).toBe("confirmed");
      expect(r.received).toBe("no");
      expect(r.amount[0]).toEqual({ faucetId: R.faucetId, amount: "1000000", verified: false });
    }
  });

  it("reports not-found and mismatch without chain fields", async () => {
    const missing = await verifyReceipt(fixtureLink, { rpc: fakeRpc({ notes: [] }), tokens });
    expect(missing).toMatchObject({ status: "not-found", inclusionBlock: null, spentAt: null, received: null });
    expect(missing.amount[0].symbol).toBeUndefined();

    const other = "0x7a0a5c308e26618159a26f324f22f3";
    const bad = await verifyReceipt(fixtureLink, {
      rpc: fakeRpc({ notes: [{ id: R.noteId, sender: other, block: 5 }] }), tokens,
    });
    expect(bad.status).toBe("mismatch");
    expect(bad.mismatch).toMatch(/sender is/);
  });

  it("marks a reclaimable P2IDE note by the chain tip", async () => {
    const f = p2ideFile(100, null);
    const l = link({ noteFile: toBase64(f.bytes) });
    const notes = [{ id: f.noteId, tag: f.tag, block: 50 }];
    const before = await verifyReceipt(l, { rpc: fakeRpc({ notes, tip: 99 }), tokens });
    expect(before).toMatchObject({ status: "confirmed", kind: "P2IDE", reclaim: { from: 100 }, tip: { block: 99 } });
    expect(before.reclaim!.by.hex).toBe(R.sender);

    const after = await verifyReceipt(l, { rpc: fakeRpc({ notes, tip: 100 }), tokens });
    expect(after.status).toBe("committed-reclaimable");

    const noTip = await verifyReceipt(l, { rpc: fakeRpc({ notes }), tokens });
    expect(noTip).toMatchObject({ status: "committed-reclaimable", tip: null });

    const claimedLate = await verifyReceipt(l, { rpc: fakeRpc({ notes, spentAt: 120, tip: 130 }), tokens });
    expect(claimedLate).toMatchObject({ status: "committed-reclaimable", received: "maybe" });
    const claimedEarly = await verifyReceipt(l, { rpc: fakeRpc({ notes, spentAt: 60, tip: 130 }), tokens });
    expect(claimedEarly).toMatchObject({ status: "confirmed", received: "yes" });
  });

  it("refuses request links, wrong networks and missing passwords", async () => {
    const rpc = fakeRpc({ notes: [] });
    await expect(verifyReceipt("https://x/?tool=pay#q1.abc", { rpc })).rejects.toThrow(/payment request/);
    await expect(verifyReceipt(fixtureLink, { rpc, network: "devnet" })).rejects.toThrow(/for testnet/);
    const made = await createReceipt({
      network: "testnet", noteFile: R.noteFileB64, password: "long enough", rpc: fakeRpc({ notes: [{ id: R.noteId, block: 1 }] }),
    });
    await expect(verifyReceipt(made.url, { rpc })).rejects.toThrow(/password-protected/);
    await expect(verifyReceipt(made.url, { rpc, password: "wrong one" })).rejects.toThrow(/Wrong password/);
  });
});

describe("createReceipt", () => {
  it("makes a link from a note file that is on chain", async () => {
    const rpc = fakeRpc({ notes: [{ id: R.noteId, block: R.inclusionBlock }] });
    const made = await createReceipt({ network: "testnet", noteFile: noteFileFromBase64(R.noteFileB64), memo: " Thanks ", rpc });
    expect(made.noteId).toBe(R.noteId);
    expect(made.url).toBe(`${DEFAULT_BASE_URL}/r#${made.fragment}`);
    const decoded = await decodeReceipt(made.url);
    expect(decoded).toMatchObject({ v: 1, network: "testnet", noteFile: R.noteFileB64, memo: "Thanks" });
    expect(Date.parse(decoded.createdAt!)).not.toBeNaN();
  });

  it("refuses a note file that isn't on chain, and short passwords", async () => {
    await expect(createReceipt({ network: "testnet", noteFile: R.noteFileB64, rpc: fakeRpc({ notes: [] }) }))
      .rejects.toThrow(/not on testnet/);
    await expect(createReceipt({ network: "testnet", noteFile: R.noteFileB64, password: "short" }))
      .rejects.toThrow(/at least 8/);
    await expect(createReceipt({ network: "testnet" })).rejects.toThrow(/either noteFile or note/);
  });

  it("waits for a wallet-reported note to be committed", async () => {
    const p = buildTestPayment({ sender: R.sender, recipient: R.recipient, faucetId: R.faucetId, amount: 1_500_000n });
    let polls = 0;
    const rpc = {
      ...fakeRpc({ notes: [] }),
      getNotesById: async (ids: NoteId[]) => {
        const id = ids[0].toString();
        return ++polls < 3
          ? []
          : [{ noteId: NoteId.fromHex(id), inclusionProof: NoteInclusionProof.mockAtBlock(77) } as unknown as FetchedNote];
      },
    };
    const made = await createReceipt({
      network: "testnet", note: p.note, rpc, baseUrl: "http://localhost:5199/", wait: { intervalMs: 1 },
    });
    expect(polls).toBe(3);
    expect(made.noteId).toBe(p.noteId);
    expect(made.url.startsWith("http://localhost:5199/r#r1.")).toBe(true);
    expect(inspectNoteFileBytes(noteFileFromBase64(made.noteFile)).noteId).toBe(p.noteId);

    await expect(createReceipt({ network: "testnet", note: p.noteBytes, rpc: fakeRpc({ notes: [] }), wait: false }))
      .rejects.toThrow(/isn't committed/);
  });
});

describe("createRequest", () => {
  const TO = "mtst1ap6wl92rd8jfwsgehu25ukeh5ykn7970";

  it("converts a decimal amount with the token's decimals", async () => {
    const made = await createRequest({
      network: "testnet", to: `${TO}_qruqqypuyph`, amountDecimal: "1.5", memo: "Invoice #7", ref: "INV-7", tokens,
      createdAt: "2026-10-09T10:00:00.000Z",
    });
    expect(made.request).toEqual({
      v: 1, network: "testnet", to: TO, faucetId: R.faucetId, amount: "1500000",
      memo: "Invoice #7", ref: "INV-7", createdAt: "2026-10-09T10:00:00.000Z",
    });
    expect(made.url).toBe(`${DEFAULT_BASE_URL}/?tool=pay#${made.fragment}`);
    expect(await decodeRequest(made.url)).toEqual(made.request);
  });

  it("accepts hex addresses and base units, and validates input", async () => {
    const made = await createRequest({ network: "testnet", to: R.recipient, faucetId: R.faucetId, amount: 42n });
    expect(made.request).toMatchObject({ to: TO, amount: "42" });
    await expect(createRequest({ network: "devnet", to: TO, amount: 1n, faucetId: R.faucetId })).rejects.toThrow(/not devnet/);
    await expect(createRequest({ network: "testnet", to: TO, amount: 0n })).rejects.toThrow(/positive/);
    await expect(createRequest({ network: "testnet", to: TO, amount: 2n ** 60n })).rejects.toThrow(/too large/);
    await expect(createRequest({ network: "testnet", to: TO, amountDecimal: "1", tokens: async () => null }))
      .rejects.toThrow(/decimals/);
    await expect(createRequest({ network: "testnet", to: TO, amountDecimal: "1.5", decimals: 0 })).rejects.toThrow(/decimal places/);
  });
});
