// @vitest-environment node
// End to end on testnet without a wallet: a local SDK client plays the wallet's part
// (a private send, then hands back the full output note, as the wallet's waitForTransaction does).
// Run with LIVE=1.
import { MidenClient, NoteVisibility, RpcClient, Endpoint } from "@miden-sdk/miden-sdk";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyNoteFile } from "../src/verify.js";
import { pickPaymentNote, waitForReceipt, type ReceiptRpc } from "../src/payment.js";

const FAUCET = "https://faucet-api.testnet.miden.io";

async function faucetGet(path: string, params: Record<string, string>) {
  const r = await fetch(`${FAUCET}/${path}?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`faucet ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

/** SHA-256(challenge || nonce_be) < target. */
function solvePow(challengeHex: string, target: bigint): string {
  const ch = Buffer.from(challengeHex, "hex");
  const buf = Buffer.alloc(ch.length + 8);
  ch.copy(buf);
  const hi = Number(target >> 32n), lo = Number(target & 0xffffffffn);
  buf.writeUInt32BE(randomBytes(4).readUInt32BE(), ch.length);
  for (let n = 0; ; n++) {
    buf.writeUInt32BE(n >>> 0, ch.length + 4);
    const d = createHash("sha256").update(buf).digest();
    const h = d.readUInt32BE(0);
    if (h < hi || (h === hi && d.readUInt32BE(4) < lo)) return buf.readBigUInt64BE(ch.length).toString();
  }
}

async function fund(accountId: string): Promise<string> {
  const meta = await faucetGet("get_metadata", {});
  const amount = String(meta.base_amount);
  const pow = await faucetGet("pow", { account_id: accountId, amount });
  const nonce = solvePow(String(pow.challenge).replace(/^0x/, ""), BigInt(pow.target));
  const res = await faucetGet("get_tokens", { account_id: accountId, asset_amount: amount, challenge: pow.challenge, nonce });
  return res.note_id;
}

describe.runIf(process.env.LIVE === "1")("payment on testnet", () => {
  it("built request commits, receipt verifies", async () => {
    const client = await MidenClient.createTestnet({
      storeName: `pay-live-${Date.now()}`,
      dataDir: join(tmpdir(), "notecheck-live"),
      autoSync: true,
    } as Parameters<typeof MidenClient.createTestnet>[0]);
    const rpc = new RpcClient(Endpoint.testnet());
    const a = await client.accounts.create();
    const b = await client.accounts.create();
    const aHex = a.id().toString(), bHex = b.id().toString();

    const fundingId = await fund(aHex);
    for (let i = 0; i < 60; i++) {
      await client.sync();
      const rec = await client.notes.get(fundingId).catch(() => null);
      if (rec?.inclusionProof?.()) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    await client.transactions.consume({ account: aHex, notes: [fundingId], waitForConfirmation: true, timeout: 180_000 });
    await client.sync();
    const feeFaucet = (await client.feeFaucetId()).toString();

    const sent = await client.transactions.send({
      account: aHex, to: bHex, token: feeFaucet, amount: 1_234_567n,
      type: NoteVisibility.Private, returnNote: true,
    });
    expect(sent.note).toBeTruthy();
    const noteBytes = pickPaymentNote([sent.note!], { recipient: bHex, faucetId: feeFaucet, amount: 1_234_567n });
    const noteId = sent.note!.id().toString();

    const call = <T,>(fn: (r: ReceiptRpc) => Promise<T>) => fn(rpc);
    const receipt = await waitForReceipt(call, noteBytes, { timeoutMs: 120_000 });
    const v = await verifyNoteFile(rpc, receipt);
    expect(v.status).toBe("included");
    expect(v.summary.noteId).toBe(noteId);
    expect(v.summary.sender).toBe(aHex);
    expect(v.summary.recipient).toBe(bHex);
    expect(v.summary.assets).toEqual([{ faucetId: feeFaucet, amount: 1_234_567n }]);
    await client.terminate?.();
  }, 400_000);
});
