// Component tests for the Pay tool with a mocked wallet (useWallet) and a fake RPC.
// The real payment, inspect and receipt-format code runs on the Node SDK binding.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteId, NoteInclusionProof, type FetchedNote } from "@miden-sdk/miden-sdk";
import { TransactionType } from "@miden-sdk/miden-wallet-adapter-base";
import { TESTNET_RECEIPT as F } from "@/receipt/fixtures";
import { toBase64 } from "@/receipt/bytes";
import { decodeReceipt } from "@/receipt/format";
import { inspectNoteFileBytes, noteFileFromBase64 } from "@/receipt/inspect";
import { toBech32 } from "@/tools/address/account";
import { buildTestPayment } from "./testNote";
import { loadPending, loadRecent, savePending, type PendingPayment } from "./payment";

const h = vi.hoisted(() => ({
  wallet: {} as Record<string, unknown>,
  committed: true,
  rpcCalls: 0,
}));

vi.mock("@miden-sdk/miden-wallet-adapter-react", () => ({ useWallet: () => h.wallet }));
vi.mock("@/lib/wallet", () => ({ WalletButton: () => <span>wallet-button-stub</span> }));
vi.mock("@/lib/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tokens")>()),
  tokenInfo: async (_n: string, faucet: string) =>
    faucet === F.faucetId ? { symbol: "USDCX", decimals: 6, source: "chain", verified: true } : null,
}));
vi.mock("@/lib/rpc", () => ({
  withRpc: async (_network: string, fn: (rpc: unknown) => Promise<unknown>) => {
    h.rpcCalls++;
    return fn({
      getNotesById: async (ids: NoteId[]) => {
        const id = ids[0].toString();
        return h.committed
          ? [{ noteId: NoteId.fromHex(id), inclusionProof: NoteInclusionProof.mockAtBlock(4242) } as unknown as FetchedNote]
          : [];
      },
    });
  },
}));

import { PayTool } from "./PayTool";

const SENDER_ADDR = `${toBech32(F.sender, "testnet")}_qruqqypuyph`;
const RECIPIENT = toBech32(F.recipient, "testnet");
const FAUCET_B32 = toBech32(F.faucetId, "testnet");
const TX_HASH = "0x" + "ab".repeat(32);
const AMOUNT = 1_500_000n;

const payment = () => buildTestPayment({ sender: F.sender, recipient: F.recipient, faucetId: F.faucetId, amount: AMOUNT });

function connectedWallet(over: Record<string, unknown> = {}) {
  const note = payment().note;
  return {
    connected: true,
    address: SENDER_ADDR,
    requestAssets: vi.fn(async () => [{ faucetId: FAUCET_B32, amount: "5000000" }]),
    requestTransaction: vi.fn(async () => "wallet-tx-1"),
    waitForTransaction: vi.fn(async () => ({ txHash: TX_HASH, outputNotes: [note] })),
    ...over,
  };
}

const user = () => userEvent.setup();

async function fillForm(u: ReturnType<typeof user>, { recipient = RECIPIENT, amount = "1.5" } = {}) {
  await u.click(screen.getByRole("button", { name: "Load my tokens" }));
  await screen.findByRole("option", { name: /USDCX · balance 5/ });
  await u.type(screen.getByLabelText("Recipient address"), recipient);
  await u.type(screen.getByLabelText(/^Amount/), amount);
}
const payButton = () => screen.getByRole("button", { name: "Review in wallet" });
const receiptLink = async () => {
  const label = await screen.findByText("Receipt link", {}, { timeout: 5000 });
  return label.parentElement!.querySelector("code")!.textContent!;
};

// Node 22+ ships its own (here unusable) localStorage global that shadows jsdom's, so use an in-memory one.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

// jsdom's Blob has no stream(); real browsers and Node do, and bytes.ts gzips through Blob streams.
function addBlobStream() {
  const proto = Blob.prototype as Blob & { stream?: () => ReadableStream<Uint8Array> };
  if (typeof proto.stream === "function") return;
  proto.stream = function (this: Blob) {
    const read = () => this.arrayBuffer();
    return new ReadableStream<Uint8Array>({
      async start(c) { c.enqueue(new Uint8Array(await read())); c.close(); },
    });
  };
}

beforeAll(() => {
  addBlobStream();
  vi.stubGlobal("localStorage", memoryStorage());
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  localStorage.clear();
  h.committed = true;
  h.rpcCalls = 0;
  h.wallet = { connected: false, address: null };
});

describe("PayTool", () => {
  it("disconnected: shows the wallet button and no form", () => {
    render(<PayTool network="testnet" />);
    expect(screen.getByText("wallet-button-stub")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load my tokens" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Recipient address")).not.toBeInTheDocument();
  });

  it("asks to switch to testnet on other networks", () => {
    h.wallet = connectedWallet();
    render(<PayTool network="devnet" />);
    expect(screen.getByText(/Payments run on testnet for now/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load my tokens" })).not.toBeInTheDocument();
  });

  it("connected without assets", async () => {
    h.wallet = connectedWallet({ requestAssets: vi.fn(async () => []) });
    render(<PayTool network="testnet" />);
    await user().click(screen.getByRole("button", { name: "Load my tokens" }));
    expect(await screen.findByText("This account has no assets yet.")).toBeInTheDocument();
    expect(payButton()).toBeDisabled();
  });

  it("shows a wallet error while reading assets", async () => {
    h.wallet = connectedWallet({ requestAssets: vi.fn(async () => { throw new Error("User rejected"); }) });
    render(<PayTool network="testnet" />);
    await user().click(screen.getByRole("button", { name: "Load my tokens" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't read the wallet's assets: User rejected");
  });

  it("validates the form: decimals, positive, over balance, self-send, bad address", async () => {
    h.wallet = connectedWallet();
    render(<PayTool network="testnet" />);
    const u = user();
    await fillForm(u, { amount: "1.0000001" });
    expect(screen.getByRole("alert")).toHaveTextContent("At most 6 decimal places.");
    expect(payButton()).toBeDisabled();

    const amount = screen.getByLabelText(/^Amount/);
    await u.clear(amount); await u.type(amount, "0");
    expect(screen.getByRole("alert")).toHaveTextContent("Amount must be positive.");
    await u.clear(amount); await u.type(amount, "5.000001");
    expect(screen.getByRole("alert")).toHaveTextContent("More than the balance.");
    expect(payButton()).toBeDisabled();
    await u.clear(amount); await u.type(amount, "5");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(payButton()).toBeEnabled();

    const to = screen.getByLabelText("Recipient address");
    await u.clear(to); await u.type(to, toBech32(F.sender, "testnet"));
    expect(screen.getByRole("alert")).toHaveTextContent("That's the connected account.");
    expect(payButton()).toBeDisabled();
    await u.clear(to); await u.type(to, F.sender); // hex form of the same account
    expect(screen.getByRole("alert")).toHaveTextContent("That's the connected account.");
    await u.clear(to); await u.type(to, "mtst1nope");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(payButton()).toBeDisabled();
  });

  it("can't send a token whose decimals are unknown", async () => {
    h.wallet = connectedWallet({ requestAssets: vi.fn(async () => [{ faucetId: "0x18101fa522c174b165efd4f70a0385", amount: "10" }]) });
    render(<PayTool network="testnet" />);
    const u = user();
    await u.click(screen.getByRole("button", { name: "Load my tokens" }));
    expect(await screen.findByText(/Unknown token: decimals can't be determined/)).toBeInTheDocument();
    await u.type(screen.getByLabelText("Recipient address"), RECIPIENT);
    await u.type(screen.getByLabelText(/^Amount/), "1");
    expect(payButton()).toBeDisabled();
  });

  it("success: sends the right request, shows a receipt link for exactly that note, clears pending", async () => {
    const w = connectedWallet();
    h.wallet = w;
    render(<PayTool network="testnet" />);
    const u = user();
    await fillForm(u);
    await u.type(screen.getByLabelText(/^Memo for the receipt/), "Invoice #7");
    await u.click(payButton());

    const url = await receiptLink();
    expect(screen.getByRole("heading", { name: "Payment committed" })).toBeInTheDocument();
    expect(w.requestTransaction).toHaveBeenCalledTimes(1);
    const tx = (w.requestTransaction.mock.calls[0] as unknown[])[0] as { type: string; payload: Record<string, unknown> };
    expect(tx.type).toBe(TransactionType.Send);
    expect(tx.payload).toMatchObject({
      senderAddress: SENDER_ADDR, recipientAddress: RECIPIENT, faucetId: FAUCET_B32, noteType: "private", amount: 1_500_000,
    });
    expect(w.waitForTransaction).toHaveBeenCalledWith("wallet-tx-1");

    expect(url).toMatch(/^http:\/\/localhost(:\d+)?\/r#r1\./);
    const r = await decodeReceipt(url.slice(url.indexOf("#")));
    expect(r).toMatchObject({ network: "testnet", memo: "Invoice #7", txId: TX_HASH });
    const s = inspectNoteFileBytes(noteFileFromBase64(r.noteFile));
    expect(s).toMatchObject({ kind: "P2ID", recipient: F.recipient, sender: F.sender, assets: [{ faucetId: F.faucetId, amount: AMOUNT }] });
    expect(loadPending()).toEqual([]);
  });

  it("encrypts the receipt when a password is set", async () => {
    h.wallet = connectedWallet();
    render(<PayTool network="testnet" />);
    const u = user();
    await fillForm(u);
    await u.type(screen.getByLabelText("Receipt password (optional)"), "correct horse");
    await u.click(payButton());
    const url = await receiptLink();
    expect(url).toContain("/r#r1e.");
    expect(screen.getByText(/Anyone with this link and the password/)).toBeInTheDocument();
  });

  it("wallet rejects the request: error, nothing pending", async () => {
    h.wallet = connectedWallet({ requestTransaction: vi.fn(async () => { throw new Error("User rejected the transaction"); }) });
    render(<PayTool network="testnet" />);
    const u = user();
    await fillForm(u);
    await u.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("The wallet didn't send the payment. User rejected the transaction");
    expect(loadPending()).toEqual([]);
    expect(screen.queryByText(/Don't send it again/)).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Back" }));
    expect(payButton()).toBeInTheDocument();
  });

  it("wallet reports the transaction failed: pending is cleared, no 'don't send again'", async () => {
    // The adapter turns the wallet's `errorMessage` into a WalletTransactionError.
    h.wallet = connectedWallet({ waitForTransaction: vi.fn(async () => {
      throw Object.assign(new Error("Transaction failed: insufficient balance"), { name: "WalletTransactionError" });
    }) });
    render(<PayTool network="testnet" />);
    const u = user();
    await fillForm(u);
    await u.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/The wallet reports the transaction failed: .*insufficient balance/);
    expect(loadPending()).toEqual([]);
    expect(screen.queryByText(/Don't send it again/)).not.toBeInTheDocument();
    expect(screen.queryByText(/from an earlier visit/)).not.toBeInTheDocument();
  });

  it("wallet times out: the payment stays pending and the user is told not to send again", async () => {
    h.wallet = connectedWallet({ waitForTransaction: vi.fn(async () => { throw new Error("Transaction timed out"); }) });
    render(<PayTool network="testnet" />);
    const u = user();
    await fillForm(u);
    await u.click(payButton());
    await screen.findByText(/Don't send it again/);
    const pending = loadPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ txId: "wallet-tx-1", recipient: F.recipient, faucetId: F.faucetId, amount: "1500000" });
    expect(pending[0].noteB64).toBeUndefined();
    expect(screen.getByText(/A payment from an earlier visit still need a receipt/)).toBeInTheDocument();
  });

  it("refuses to make a receipt when the wallet reports a different note", async () => {
    const wrong = buildTestPayment({ sender: F.sender, recipient: F.recipient, faucetId: F.faucetId, amount: 1n }).note;
    h.wallet = connectedWallet({ waitForTransaction: vi.fn(async () => ({ txHash: TX_HASH, outputNotes: [wrong] })) });
    render(<PayTool network="testnet" />);
    const u = user();
    await fillForm(u);
    await u.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/doesn't contain the expected payment note/);
    expect(screen.queryByText("Receipt link")).not.toBeInTheDocument();
    expect(loadPending()[0].noteB64).toBeUndefined();
  });

  it("refuses a recipient address from another network", async () => {
    h.wallet = connectedWallet();
    const u = user();
    render(<PayTool network="testnet" />);
    await fillForm(u, { recipient: toBech32(F.recipient, "devnet") });
    expect(screen.getByRole("alert")).toHaveTextContent(/devnet address .*paying on testnet/);
    expect(payButton()).toBeDisabled();
  });

  it("requires a receipt password of at least 8 characters when one is set", async () => {
    h.wallet = connectedWallet();
    const u = user();
    render(<PayTool network="testnet" />);
    await fillForm(u);
    await u.type(screen.getByLabelText("Receipt password (optional)"), "short");
    expect(screen.getByRole("alert")).toHaveTextContent(/at least 8 characters/);
    expect(payButton()).toBeDisabled();
    await u.type(screen.getByLabelText("Receipt password (optional)"), "-enough");
    expect(payButton()).toBeEnabled();
  });

  it("keeps a made receipt in this browser so a closed tab doesn't lose it", async () => {
    h.wallet = connectedWallet();
    const u = user();
    render(<PayTool network="testnet" />);
    await fillForm(u);
    await u.click(payButton());
    const url = await receiptLink();
    expect(loadRecent().map((r) => r.url)).toEqual([url]);
  });

  describe("pending payments from an earlier visit", () => {
    const record = (over: Partial<PendingPayment> = {}): PendingPayment => ({
      txId: "old-tx", network: "testnet", recipient: F.recipient, faucetId: F.faucetId, amount: AMOUNT.toString(),
      memo: "from yesterday", createdAt: "2026-10-08T10:00:00.000Z", ...over,
    });

    it("resumes a payment whose note is already known, without the wallet", async () => {
      savePending(record({ noteB64: toBase64(payment().noteBytes), chainTxId: TX_HASH }));
      render(<PayTool network="testnet" />);
      expect(screen.getByText(/A payment from an earlier visit still need a receipt/)).toBeInTheDocument();
      expect(screen.getByText(/1500000 base units to/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "finish receipt" }));
      const url = await receiptLink();
      const r = await decodeReceipt(url.slice(url.indexOf("#")));
      expect(r).toMatchObject({ memo: "from yesterday", createdAt: "2026-10-08T10:00:00.000Z", txId: TX_HASH });
      expect(loadPending()).toEqual([]);
      expect(screen.queryByText(/from an earlier visit/)).not.toBeInTheDocument();
    });

    it("resumes through the wallet when only the tx id is known", async () => {
      const w = connectedWallet();
      h.wallet = w;
      savePending(record());
      render(<PayTool network="testnet" />);
      fireEvent.click(screen.getByRole("button", { name: "finish receipt" }));
      await receiptLink();
      expect(w.waitForTransaction).toHaveBeenCalledWith("old-tx");
      expect(loadPending()).toEqual([]);
    });

    it("needs the sending wallet when only the tx id is known", async () => {
      h.wallet = { connected: false, address: null, waitForTransaction: undefined };
      savePending(record());
      render(<PayTool network="testnet" />);
      expect(screen.getByRole("button", { name: "finish receipt" })).toBeDisabled();
      expect(screen.getByText(/Connect the wallet that sent it to finish/)).toBeInTheDocument();
      expect(loadPending()).toHaveLength(1);
    });

    // After a reload the adapter stays selected but disconnected, and waitForTransaction throws
    // WalletNotConnectedError. That must never delete the only record of a payment.
    it("keeps the pending payment when 'finish receipt' is clicked while the selected wallet is disconnected", async () => {
      const { WalletNotConnectedError } = await import("@miden-sdk/miden-wallet-adapter-base");
      h.wallet = {
        connected: false, address: null,
        waitForTransaction: vi.fn(async () => { throw new WalletNotConnectedError(); }),
      };
      savePending(record());
      render(<PayTool network="testnet" />);
      expect(screen.getByRole("button", { name: "finish receipt" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "finish receipt" }));
      expect(loadPending()).toHaveLength(1);
    });

    it("keeps the pending payment on errors the wallet doesn't report as a failed transaction", async () => {
      h.wallet = connectedWallet({ waitForTransaction: vi.fn(async () => { throw new Error("Extension context invalidated"); }) });
      savePending(record());
      render(<PayTool network="testnet" />);
      fireEvent.click(screen.getByRole("button", { name: "finish receipt" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/hasn't confirmed the payment yet/);
      expect(loadPending()).toHaveLength(1);
    });

    it("discard removes it", async () => {
      savePending(record());
      render(<PayTool network="testnet" />);
      fireEvent.click(screen.getByRole("button", { name: "discard" }));
      expect(screen.queryByText(/from an earlier visit/)).not.toBeInTheDocument();
      expect(loadPending()).toEqual([]);
    });

    it("ignores corrupt storage", () => {
      localStorage.setItem("pending-payments-v2", "{not json");
      render(<PayTool network="testnet" />);
      expect(screen.queryByText(/from an earlier visit/)).not.toBeInTheDocument();
    });

    it("keeps the note when it isn't committed before the polling deadline", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        h.committed = false;
        savePending(record({ noteB64: toBase64(payment().noteBytes) }));
        render(<PayTool network="testnet" />);
        fireEvent.click(screen.getByRole("button", { name: "finish receipt" }));
        await act(async () => { await vi.advanceTimersByTimeAsync(200_000); });
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/hasn't been confirmed on chain yet/));
        expect(h.rpcCalls).toBeGreaterThan(10);
        expect(loadPending()).toHaveLength(1);
        expect(loadPending()[0].noteB64).toBeTruthy();
        expect(screen.getByText(/Don't send it again/)).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
