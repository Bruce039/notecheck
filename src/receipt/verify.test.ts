// @vitest-environment node
import {
  AccountId, Endpoint, FetchedNote, NoteId, NoteInclusionProof, NoteMetadata, NoteTag, NoteType, RpcClient,
  type BlockHeader, type Word,
} from "@miden-sdk/miden-sdk";
import { TESTNET_RECEIPT as R } from "./fixtures";
import { noteFileFromBase64, UnsupportedReceiptError } from "./inspect";
import { verifyReceipt, type VerifyRpc } from "./verify";

const TAG = 1961623552;
const NULLIFIER = "0x81988a92bd8f871e69ab08ae6f6f1700fdec079675e7b7dde2e9013b82c564fa";
const OTHER_ID = "0x" + "11".repeat(32);

type Chain = {
  notes?: { id?: string; sender?: string; tag?: number; type?: NoteType; block?: number }[];
  spentAt?: number;
  error?: Error;
};

function fakeRpc(chain: Chain) {
  const calls: string[] = [];
  let busy = false;
  const enter = async (name: string) => {
    expect(busy).toBe(false);
    busy = true;
    calls.push(name);
    await Promise.resolve();
    busy = false;
    if (chain.error) throw chain.error;
  };
  const rpc: VerifyRpc = {
    getNotesById: async (ids: NoteId[]) => {
      calls.push(`ids:${ids.map((i) => i.toString()).join(",")}`);
      await enter("getNotesById");
      return (chain.notes ?? []).map((n) =>
        new FetchedNote(
          NoteId.fromHex(n.id ?? R.noteId),
          new NoteMetadata(AccountId.fromHex(n.sender ?? R.sender), n.type ?? NoteType.Private, new NoteTag(n.tag ?? TAG)),
          NoteInclusionProof.mockAtBlock(n.block ?? R.inclusionBlock),
        ));
    },
    getNullifierCommitHeight: async (nullifier: Word, from: number) => {
      calls.push(`nullifier:${nullifier.toHex()}@${from}`);
      await enter("getNullifierCommitHeight");
      return chain.spentAt;
    },
    getBlockHeaderByNumber: async (n?: number | null) => {
      calls.push(`header:${n}`);
      await enter("getBlockHeaderByNumber");
      return { timestamp: () => 1_700_000_000 + (n ?? 0) } as unknown as BlockHeader;
    },
  };
  return { rpc, calls };
}

const bytes = () => noteFileFromBase64(R.noteFileB64);

describe("verifyReceipt", () => {
  it("reports not-found when the node does not know the note ID", async () => {
    const { rpc, calls } = fakeRpc({});
    const v = await verifyReceipt(rpc, bytes());
    expect(v.status).toBe("not-found");
    expect(v.summary.noteId).toBe(R.noteId);
    expect(calls).toEqual([`ids:${R.noteId}`, "getNotesById"]);
  });

  it("ignores notes the node returns for other IDs", async () => {
    const { rpc } = fakeRpc({ notes: [{ id: OTHER_ID }] });
    expect((await verifyReceipt(rpc, bytes())).status).toBe("not-found");
  });

  it("reports a mismatch when on-chain metadata differs from the file", async () => {
    const cases: [Chain["notes"], RegExp][] = [
      [[{ sender: R.recipient }], /sender/],
      [[{ tag: TAG + 1 }], /tag/],
      [[{ type: NoteType.Public }], /note type is public on chain, private in the file/],
    ];
    for (const [notes, reason] of cases) {
      const { rpc, calls } = fakeRpc({ notes });
      const v = await verifyReceipt(rpc, bytes());
      expect(v.status).toBe("mismatch");
      if (v.status === "mismatch") expect(v.reason).toMatch(reason);
      expect(calls).not.toContain("getNullifierCommitHeight");
    }
  });

  it("reports an included, unspent note", async () => {
    const { rpc, calls } = fakeRpc({ notes: [{ id: OTHER_ID }, {}] });
    const v = await verifyReceipt(rpc, bytes());
    expect(v).toMatchObject({
      status: "included",
      inclusionBlock: R.inclusionBlock,
      inclusionTime: 1_700_000_000 + R.inclusionBlock,
      spentAt: null,
      spentTime: null,
      summary: { recipient: R.recipient, assets: [{ faucetId: R.faucetId, amount: R.amount }] },
    });
    expect(calls).toEqual([
      `ids:${R.noteId}`, "getNotesById",
      `nullifier:${NULLIFIER}@${R.inclusionBlock}`, "getNullifierCommitHeight",
      `header:${R.inclusionBlock}`, "getBlockHeaderByNumber",
    ]);
  });

  it("reports an included, spent note with both block times", async () => {
    const { rpc, calls } = fakeRpc({ notes: [{}], spentAt: R.spentAt });
    const v = await verifyReceipt(rpc, bytes());
    expect(v).toMatchObject({
      status: "included",
      inclusionBlock: R.inclusionBlock,
      spentAt: R.spentAt,
      spentTime: 1_700_000_000 + R.spentAt,
    });
    expect(calls.at(-2)).toBe(`header:${R.spentAt}`);
  });

  it("propagates RPC errors", async () => {
    const { rpc } = fakeRpc({ error: new Error("unavailable") });
    await expect(verifyReceipt(rpc, bytes())).rejects.toThrow("unavailable");
  });

  it("rejects unsupported files without calling the node", async () => {
    const { rpc, calls } = fakeRpc({ notes: [{}] });
    await expect(verifyReceipt(rpc, new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(UnsupportedReceiptError);
    expect(calls).toEqual([]);
  });
});

describe.runIf(import.meta.env.LIVE === "1")("verifyReceipt (live testnet)", () => {
  it("finds the fixture note included and spent", async () => {
    const v = await verifyReceipt(new RpcClient(Endpoint.testnet()), bytes());
    expect(v).toMatchObject({ status: "included", inclusionBlock: R.inclusionBlock, spentAt: R.spentAt });
    if (v.status === "included") {
      expect(v.inclusionTime).toBeGreaterThan(1_700_000_000);
      expect(v.spentTime).toBeGreaterThanOrEqual(v.inclusionTime);
    }
  }, 60_000);
});
