// Component tests for the public receipt page (/r#…). The real decode, inspect and verify code runs
// on the Node SDK binding; only the RPC transport, the token lookup and the wallet are replaced.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AccountId, FetchedNote, FungibleAsset, InputNote, Note, NoteAssets, NoteAttachment, NoteFile, NoteId,
  NoteInclusionProof, NoteMetadata, NoteTag, NoteType, type BlockHeader,
} from "@miden-sdk/miden-sdk";
import type { TokenInfo } from "@/lib/tokens";
import { TESTNET_RECEIPT as R } from "./fixtures";
import { encodeReceipt, type ReceiptV1 } from "./format";
import { toBase64 } from "./bytes";
import { noteFileFromBase64 } from "./inspect";
import { toBech32 } from "@/tools/address/account";
import type { VerifyRpc } from "./verify";

type OnChainNote = { id: string; sender: string; tag: number; type: NoteType; block: number };
type Chain = {
  notes: OnChainNote[];
  spentAt?: number;
  /** Thrown by every getNotesById call. */
  error?: Error;
  /** Thrown by successive getNotesById calls, one each, before succeeding. */
  errors?: Error[];
  /** getNotesById waits for this. */
  gate?: Promise<void>;
  /** Latest block; undefined makes the tip lookup fail. */
  tip?: number;
};

const USDCX: TokenInfo = { symbol: "USDCX", decimals: 6, source: "token-list", verified: true };

const h = vi.hoisted(() => ({
  chain: { notes: [] } as unknown,
  rpcNetworks: [] as string[],
  wallet: {} as Record<string, unknown>,
  tokenCalls: [] as string[],
  tokens: {} as Record<string, unknown>,
  tokenGate: null as Promise<void> | null,
}));

vi.mock("@/lib/rpc", () => ({
  withRpc: async (network: string, fn: (rpc: unknown) => Promise<unknown>) => {
    h.rpcNetworks.push(network);
    return fn(makeRpc(h.chain as Chain));
  },
}));
vi.mock("@/lib/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tokens")>()),
  tokenInfo: async (_network: string, faucet: string) => {
    h.tokenCalls.push(faucet);
    if (h.tokenGate) await h.tokenGate;
    return h.tokens[faucet] ?? null;
  },
}));
vi.mock("@miden-sdk/miden-wallet-adapter-react", () => ({ useWallet: () => h.wallet }));
vi.mock("@/lib/wallet", () => ({ WalletButton: () => <button type="button">Connect wallet (stub)</button> }));
// jsdom has no canvas: the card renderer is replaced; its drawing is tested in view/shareCard.test.ts.
vi.mock("./view/shareCard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./view/shareCard")>()),
  renderShareCard: vi.fn(async () => ({ blob: new Blob(["png"], { type: "image/png" }), dataUrl: "data:image/png;base64,AAAA" })),
}));

import { ReceiptPage } from "./ReceiptPage";
import { renderShareCard } from "./view/shareCard";

const TAG = 1961623552;

function makeRpc(chain: Chain): VerifyRpc {
  return {
    getNotesById: async () => {
      if (chain.gate) await chain.gate;
      if (chain.error) throw chain.error;
      const next = chain.errors?.shift();
      if (next) throw next;
      return chain.notes.map((n) => new FetchedNote(
        NoteId.fromHex(n.id),
        new NoteMetadata(AccountId.fromHex(n.sender), n.type, new NoteTag(n.tag)),
        NoteInclusionProof.mockAtBlock(n.block),
      ));
    },
    getNullifierCommitHeight: async () => chain.spentAt,
    getBlockHeaderByNumber: async (n?: number | null) => {
      const num = n ?? chain.tip;
      if (num === undefined) throw new Error("tip unavailable");
      return { timestamp: () => 1_760_000_000 + num, blockNum: () => num } as unknown as BlockHeader;
    },
  };
}

const fixtureOnChain = (over: Partial<OnChainNote> = {}): OnChainNote =>
  ({ id: R.noteId, sender: R.sender, tag: TAG, type: NoteType.Private, block: R.inclusionBlock, ...over });

const base: ReceiptV1 = { v: 1, network: "testnet", noteFile: R.noteFileB64 };

async function show(fragment: string) {
  window.history.replaceState(null, "", `/r#${fragment}`);
  return render(<ReceiptPage />);
}
const heading = (name: RegExp) => screen.findByRole("heading", { name }, { timeout: 5000 });
const CONFIRMED = /^Payment confirmed on the Miden network$/;
const hero = () => document.querySelector<HTMLElement>(".rc-hero")!;

/** A P2ID note file for another faucet, and its on-chain record. */
function p2idFile(faucet: string, amount: bigint) {
  const assets = new NoteAssets([new FungibleAsset(AccountId.fromHex(faucet), amount)]);
  const note = Note.createP2IDNote(AccountId.fromHex(R.sender), AccountId.fromHex(R.recipient), assets, NoteType.Private, new NoteAttachment());
  const id = note.id().toString();
  const tag = note.metadata().tag().asU32();
  const b64 = toBase64(Uint8Array.from(NoteFile.fromInputNote(InputNote.authenticated(note, NoteInclusionProof.mockAtBlock(9))).serialize()));
  return { b64, onChain: fixtureOnChain({ id, tag, block: 9 }) };
}

function p2ideFile(reclaim: number | null, timelock: number | null) {
  const assets = new NoteAssets([new FungibleAsset(AccountId.fromHex(R.faucetId), 2_500_000n)]);
  const note = Note.createP2IDENote(
    AccountId.fromHex(R.sender), AccountId.fromHex(R.recipient), assets, reclaim, timelock,
    NoteType.Private, new NoteAttachment(),
  );
  const id = note.id().toString();
  const tag = note.metadata().tag().asU32();
  const file = NoteFile.fromInputNote(InputNote.authenticated(note, NoteInclusionProof.mockAtBlock(500)));
  return { b64: toBase64(Uint8Array.from(file.serialize())), onChain: fixtureOnChain({ id, tag, block: 500 }) };
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
});
beforeEach(() => {
  h.chain = { notes: [] };
  h.rpcNetworks = [];
  h.tokenCalls = [];
  h.tokens = { [R.faucetId]: USDCX };
  h.tokenGate = null;
  h.wallet = { connected: false, importPrivateNote: undefined };
});

describe("ReceiptPage", () => {
  it("shows a confirmed, received P2ID payment with the amount from the note and the sender's claims apart", async () => {
    h.chain = { notes: [fixtureOnChain()], spentAt: R.spentAt };
    await show(await encodeReceipt({ ...base, memo: "Invoice #42", txId: R.txId, createdAt: "2026-10-09T12:00:00.000Z" }));
    await heading(CONFIRMED);
    expect(screen.getByText(/^Checked .+ in this browser · testnet \(test money\)$/)).toBeInTheDocument();
    expect(screen.getByText("Test network — no real value")).toBeInTheDocument();
    expect(within(hero()).getByText("1", { selector: ".rc-num" })).toBeInTheDocument();
    expect(within(hero()).getByText("USDCX")).toBeInTheDocument();
    expect(screen.getByText(/^Sent .+ UTC · received by the recipient .+ UTC$/)).toBeInTheDocument();
    expect(screen.getByText(toBech32(R.recipient, "testnet"))).toBeInTheDocument();
    expect(screen.getByText(toBech32(R.sender, "testnet"))).toBeInTheDocument();
    expect(screen.getByText("✓ Received")).toHaveClass("rc-status-good");
    expect(screen.getByText(/the recipient has claimed the funds/)).toBeInTheDocument();
    // The memo sits in its own "not checked" box, never green.
    const memo = screen.getByText("Note from the sender · not checked").parentElement!;
    expect(within(memo).getByText("“Invoice #42”")).toBeInTheDocument();
    // Technical details: hex IDs, blocks, and the sender's claimed date and transaction.
    expect(screen.getByText(R.noteId)).toBeInTheDocument();
    expect(screen.getByText(R.sender)).toBeInTheDocument();
    expect(screen.getByText(R.recipient)).toBeInTheDocument();
    expect(screen.getByText(/^83,790 · /)).toBeInTheDocument();
    expect(screen.getByText(/^83,793/)).toBeInTheDocument();
    expect(screen.getByText("P2ID · private note")).toBeInTheDocument();
    expect(screen.getByText("Transaction ID").parentElement).toHaveTextContent(`${R.txId}CopyClaimed by the sender, not checked`);
    expect(screen.getByText("Created").parentElement).toHaveTextContent("2026-10-09 12:00 UTCClaimed by the sender, not checked");
    // Each copy button names what it copies.
    for (const name of ["Copy paid to", "Copy paid from", "Copy note ID", "Copy sender account", "Copy transaction ID"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("status")).toHaveTextContent("Payment confirmed on the Miden network");
    // Received: nothing left to import.
    expect(screen.queryByText(/Are you the recipient/)).not.toBeInTheDocument();
    expect(h.rpcNetworks).toEqual(["testnet"]);
  });

  it("does not show an amount before the token lookup has settled", async () => {
    let release!: () => void;
    h.tokenGate = new Promise((r) => { release = r; });
    h.chain = { notes: [fixtureOnChain()] };
    const { container } = await show(await encodeReceipt(base));
    expect(await screen.findByText(/Checking… looking up the token/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: CONFIRMED })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/1,000,000|1000000|base units|USDCX/);
    await act(async () => { release(); });
    await heading(CONFIRMED);
    expect(within(hero()).getByText("1", { selector: ".rc-num" })).toBeInTheDocument();
    expect(hero().textContent).not.toMatch(/base units/);
  });

  it("shows an unverified token's base units and never presents its symbol as trusted", async () => {
    h.tokens = { [R.faucetId]: { symbol: "USDCX", decimals: 6, source: "chain", verified: false } };
    h.chain = { notes: [fixtureOnChain()] };
    await show(await encodeReceipt(base));
    await heading(CONFIRMED);
    expect(screen.getByText("Unverified token")).toBeInTheDocument();
    expect(within(hero()).getByText("1,000,000", { selector: ".rc-num" })).toBeInTheDocument();
    expect(within(hero()).getByText("base units")).toBeInTheDocument();
    expect(within(hero()).queryByText("USDCX")).not.toBeInTheDocument();
    expect(screen.getByText(/symbol and decimals set by its creator/)).toHaveTextContent("Its creator calls this 1 USDCX");
    expect(screen.getByText(toBech32(R.faucetId, "testnet"))).toBeInTheDocument();
    expect(document.title).toBe("Payment receipt · 1,000,000 base units");
  });

  it("labels the base units of an unknown token", async () => {
    const other = "0x18101fa522c174b165efd4f70a0385";
    const f = p2idFile(other, 42n);
    h.chain = { notes: [f.onChain] };
    await show(await encodeReceipt({ ...base, noteFile: f.b64 }));
    await heading(CONFIRMED);
    expect(within(hero()).getByText("42", { selector: ".rc-num" })).toBeInTheDocument();
    expect(within(hero()).getByText("units of an unknown token")).toBeInTheDocument();
    expect(screen.getByText(toBech32(other, "testnet"))).toBeInTheDocument();
  });

  it("sets the document title while a confirmed receipt is shown and restores it", async () => {
    document.title = "NoteCheck";
    h.chain = { notes: [fixtureOnChain()] };
    const { unmount } = await show(await encodeReceipt(base));
    await heading(CONFIRMED);
    expect(document.title).toBe("Payment receipt · 1 USDCX");
    unmount();
    expect(document.title).toBe("NoteCheck");
  });

  it("renders a hostile memo as text", async () => {
    h.chain = { notes: [fixtureOnChain()] };
    const memo = `<img src=x onerror="window.__pwned=1">`;
    const { container } = await show(await encodeReceipt({ ...base, memo }));
    await heading(CONFIRMED);
    expect(screen.getByText(`“${memo}”`)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("strips control, bidi and zero-width characters and leading check marks from the memo", async () => {
    h.chain = { notes: [fixtureOnChain()] };
    const memo = "\u202E✓ ✔Paid\u200B in\u2066 full\u2069\nthanks\u0007";
    await show(await encodeReceipt({ ...base, memo }));
    await heading(CONFIRMED);
    expect(document.querySelector(".rc-memo-text")!.textContent).toBe("“Paid in full thanks”");
  });

  it("hides the memo box when nothing is left after cleaning", async () => {
    h.chain = { notes: [fixtureOnChain()] };
    await show(await encodeReceipt({ ...base, memo: "\u200B✓" }));
    await heading(CONFIRMED);
    expect(screen.queryByText(/Note from the sender/)).not.toBeInTheDocument();
  });

  it("offers the recipient an import of an unclaimed testnet note and passes the exact note file", async () => {
    const importPrivateNote = vi.fn(async () => "0xnote");
    h.wallet = { connected: true, importPrivateNote };
    h.chain = { notes: [fixtureOnChain()] };
    await show(await encodeReceipt(base));
    await heading(CONFIRMED);
    expect(screen.getByText("Waiting for the recipient to claim")).toBeInTheDocument();
    expect(screen.getByText(/^Sent .+ · not claimed yet$/)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/Are you the recipient/));
    await userEvent.click(screen.getByRole("button", { name: "Import into my wallet" }));
    await screen.findByText(/Imported\. Your wallet can now claim the note\./);
    expect(importPrivateNote).toHaveBeenCalledTimes(1);
    expect(importPrivateNote.mock.calls[0]).toEqual([noteFileFromBase64(R.noteFileB64)]);
  });

  it("shows the wallet's import error and the connect button when disconnected", async () => {
    h.wallet = { connected: true, importPrivateNote: vi.fn(async () => { throw new Error("Wallet is locked"); }) };
    h.chain = { notes: [fixtureOnChain()] };
    const { unmount } = await show(await encodeReceipt(base));
    await heading(CONFIRMED);
    await userEvent.click(screen.getByRole("button", { name: "Import into my wallet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wallet is locked");
    unmount();

    h.wallet = { connected: false };
    await show(await encodeReceipt(base));
    await heading(CONFIRMED);
    expect(screen.getByRole("button", { name: "Connect wallet (stub)" })).toBeInTheDocument();
  });

  it("has no import offer on devnet", async () => {
    h.wallet = { connected: true, importPrivateNote: vi.fn() };
    h.chain = { notes: [fixtureOnChain()] };
    await show(await encodeReceipt({ ...base, network: "devnet" }));
    await heading(CONFIRMED);
    expect(screen.getByText(/in this browser · devnet \(test money\)$/)).toBeInTheDocument();
    expect(h.rpcNetworks).toEqual(["devnet"]);
    expect(screen.queryByText(/Are you the recipient/)).not.toBeInTheDocument();
  });

  it("not found: shows only the note ID, never amounts, accounts or the memo", async () => {
    const { container } = await show(await encodeReceipt({ ...base, memo: "Invoice #42" }));
    await heading(/Not found on testnet/);
    const text = container.textContent!;
    expect(text).toContain(R.noteId);
    expect(text).toMatch(/wait a minute and check again/);
    expect(text).not.toMatch(/USDCX|1,000,000|1000000|base units/);
    expect(text).not.toContain(toBech32(R.recipient, "testnet"));
    expect(text).not.toContain(toBech32(R.sender, "testnet"));
    expect(text).not.toContain(R.recipient);
    expect(text).not.toContain(R.sender);
    expect(text).not.toContain("Invoice #42");
    expect(h.tokenCalls).toEqual([]);
    expect(screen.queryByText(/Are you the recipient/)).not.toBeInTheDocument();
  });

  it("mismatch: explains the difference and shows no amounts or memo", async () => {
    h.chain = { notes: [fixtureOnChain({ tag: TAG + 1 })] };
    const { container } = await show(await encodeReceipt({ ...base, memo: "Invoice #42" }));
    await heading(/This receipt does not match the chain/);
    expect(screen.getByText(/tag is \d+ on chain, 1961623552 in the file/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/USDCX|Invoice #42|Payment confirmed/);
    expect(h.tokenCalls).toEqual([]);
  });

  it("mismatch on the sender does not print account IDs", async () => {
    h.chain = { notes: [fixtureOnChain({ sender: R.recipient })] };
    const { container } = await show(await encodeReceipt(base));
    await heading(/This receipt does not match the chain/);
    expect(screen.getByText(/the sender account on chain is not the one in the link/)).toBeInTheDocument();
    expect(container.textContent).not.toContain(R.sender);
    expect(container.textContent).not.toContain(R.recipient);
  });

  it("asks for the password, rejects a wrong one, opens with the right one", async () => {
    h.chain = { notes: [fixtureOnChain()] };
    await show(await encodeReceipt({ ...base, memo: "secret memo" }, "hunter2"));
    await heading(/Password-protected receipt/);
    expect(h.rpcNetworks).toEqual([]);
    const pw = screen.getByLabelText("Password");
    const submit = screen.getByRole("button", { name: "Open receipt" });
    expect(submit).toBeDisabled();
    await userEvent.type(pw, "wrong");
    await userEvent.click(submit);
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(/Wrong password/);
    expect(h.rpcNetworks).toEqual([]);
    await userEvent.clear(screen.getByLabelText("Password"));
    await userEvent.type(screen.getByLabelText("Password"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Open receipt" }));
    await heading(CONFIRMED);
    expect(screen.getByText("“secret memo”")).toBeInTheDocument();
  });

  it("re-checks a protected receipt without asking for the password again", async () => {
    h.chain = { notes: [fixtureOnChain()] };
    await show(await encodeReceipt(base, "pw"));
    await userEvent.type(await screen.findByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Open receipt" }));
    await heading(CONFIRMED);
    expect(screen.getByText("Waiting for the recipient to claim")).toBeInTheDocument();
    h.chain = { notes: [fixtureOnChain()], spentAt: R.spentAt };
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("✓ Received", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(h.rpcNetworks).toEqual(["testnet", "testnet"]);
  });

  it.each([
    ["r1.not-a-receipt", /damaged or incomplete/],
    ["r1.AAAA", /not valid gzip/],
    ["r1.$$$", /damaged or incomplete/],
    ["hello", /Not a Miden receipt link/],
    ["r1." + "A".repeat(20_000), /too long/],
  ])("shows an error with a next step for a damaged link %#", async (fragment, message) => {
    await show(fragment);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent("Ask the sender to resend it, and make sure the whole link was copied.");
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    expect(h.rpcNetworks).toEqual([]);
  });

  it("rejects a receipt whose note file cannot be a receipt, without asking the node", async () => {
    h.chain = { notes: [], error: new Error("node must not be asked") };
    await show(await encodeReceipt({ ...base, noteFile: "AQID" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^This is not a valid note file\. Ask the sender to resend it/);
  });

  it("explains that mainnet receipts can't be verified yet and does not call any node", async () => {
    await show(await encodeReceipt({ ...base, network: "mainnet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/mainnet, whose RPC is not public yet/);
    expect(h.rpcNetworks).toEqual([]);
  });

  it("reports an unreachable node in plain words, with the raw error tucked away", async () => {
    h.chain = { notes: [], error: new Error("connection refused") };
    await show(await encodeReceipt(base));
    expect(await screen.findByRole("alert")).toHaveTextContent("The testnet node isn't responding. Try again in a minute.");
    expect(screen.getByText("Error details").closest("details")).toHaveTextContent("connection refused");
    // Not a transient error: no automatic retry.
    expect(h.rpcNetworks).toEqual(["testnet"]);
  });

  it("retries a transient error once, then shows the error with Check again", async () => {
    h.chain = { notes: [fixtureOnChain()], errors: [new Error("Failed to fetch"), new Error("Failed to fetch")] };
    await show(await encodeReceipt(base));
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("The testnet node isn't responding");
    expect(h.rpcNetworks).toEqual(["testnet", "testnet"]);
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await heading(CONFIRMED);
    expect(h.rpcNetworks).toEqual(["testnet", "testnet", "testnet"]);
  });

  it("recovers silently when the automatic retry succeeds", async () => {
    h.chain = { notes: [fixtureOnChain()], errors: [new Error("upstream returned 503")] };
    await show(await encodeReceipt(base));
    await heading(CONFIRMED);
    expect(h.rpcNetworks).toEqual(["testnet", "testnet"]);
  });

  it("shows the empty state without a fragment", async () => {
    await show("");
    expect(await screen.findByText(/No receipt in this link/)).toBeInTheDocument();
  });

  it("re-checks on 'Check again' and follows hash changes", async () => {
    await show(await encodeReceipt(base));
    await heading(/Not found on testnet/);
    h.chain = { notes: [fixtureOnChain()] };
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await heading(CONFIRMED);
    expect(h.rpcNetworks).toEqual(["testnet", "testnet"]);

    const devnet = await encodeReceipt({ ...base, network: "devnet" });
    h.chain = { notes: [] };
    await act(async () => {
      window.location.hash = devnet;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await heading(/Not found on devnet/);
  });

  it("ignores a late result for a link that is no longer open", async () => {
    let release!: () => void;
    h.chain = { notes: [fixtureOnChain()], gate: new Promise<void>((r) => { release = r; }) };
    await show(await encodeReceipt(base));
    await waitFor(() => expect(h.rpcNetworks).toEqual(["testnet"]));

    const devnet = await encodeReceipt({ ...base, network: "devnet" });
    h.chain = { notes: [] };
    await act(async () => {
      window.location.hash = devnet;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await heading(/Not found on devnet/);
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByRole("heading", { name: /Not found on devnet/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: CONFIRMED })).not.toBeInTheDocument();
    expect(h.tokenCalls).toEqual([]);
  });

  describe("QR code and share image", () => {
    const qr = () => screen.queryByRole("img", { name: "QR code for this receipt link" });
    const shareButton = () => screen.queryByRole("button", { name: "Share image" });
    const render_ = vi.mocked(renderShareCard);
    beforeEach(() => render_.mockClear());

    it("shows a QR code of the current link for a confirmed receipt", async () => {
      h.chain = { notes: [fixtureOnChain()], spentAt: R.spentAt };
      await show(await encodeReceipt(base));
      await heading(CONFIRMED);
      const svg = qr()!;
      expect(svg.tagName.toLowerCase()).toBe("svg");
      expect(Number(svg.getAttribute("data-modules"))).toBeGreaterThanOrEqual(21);
      expect(svg.querySelector("path")!.getAttribute("d")).toMatch(/^M0 0h7v1h-7z/);
      expect(screen.getByText("Scan to check")).toBeInTheDocument();
      expect(screen.queryByText("Password required")).not.toBeInTheDocument();
      // A toggle for small screens, hidden by CSS on wide ones.
      const toggle = screen.getByRole("button", { name: "Show QR code" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(toggle);
      expect(screen.getByRole("button", { name: "Hide QR code" })).toHaveAttribute("aria-expanded", "true");
    });

    it("has no QR code or share image when the payment is not found", async () => {
      await show(await encodeReceipt(base));
      await heading(/Not found on testnet/);
      expect(qr()).toBeNull();
      expect(shareButton()).toBeNull();
    });

    it("offers no share image for a warning verdict", async () => {
      const f = p2ideFile(1000, null);
      h.chain = { notes: [f.onChain], tip: 1500 };
      await show(await encodeReceipt({ ...base, noteFile: f.b64 }));
      await heading(/can still take it back/);
      expect(shareButton()).toBeNull();
      expect(screen.getByRole("button", { name: "Save as PDF" })).toBeInTheDocument();
    });

    it("notes that a protected receipt's QR code still needs the password", async () => {
      h.chain = { notes: [fixtureOnChain()] };
      const fragment = await encodeReceipt(base, "pw");
      await show(fragment);
      await userEvent.type(await screen.findByLabelText("Password"), "pw");
      await userEvent.click(screen.getByRole("button", { name: "Open receipt" }));
      await heading(CONFIRMED);
      expect(qr()).toBeInTheDocument();
      expect(screen.getByText("Password required")).toBeInTheDocument();
      await userEvent.click(shareButton()!);
      await waitFor(() => expect(render_).toHaveBeenCalled());
      expect(render_.mock.calls[0][0]).toMatchObject({ passwordRequired: true, url: expect.stringContaining(`#${fragment}`) });
      expect(render_.mock.calls[0][0].url).not.toContain("pw");
    });

    it("renders the image without the memo, hides the amount on request, and downloads it", async () => {
      const createObjectURL = vi.fn(() => "blob:receipt");
      const revoke = vi.fn();
      Object.assign(URL, { createObjectURL, revokeObjectURL: revoke });
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      h.chain = { notes: [fixtureOnChain()], spentAt: R.spentAt };
      await show(await encodeReceipt({ ...base, memo: "Invoice #42" }));
      await heading(CONFIRMED);
      await userEvent.click(shareButton()!);
      const dialog = await screen.findByRole("dialog", { name: "Share an image of this receipt" });
      expect(dialog).toHaveTextContent("Anyone who scans it can open the receipt.");
      await waitFor(() => expect(render_).toHaveBeenCalledTimes(1));
      const first = render_.mock.calls[0][0];
      expect(first).toMatchObject({
        hideAmount: false, received: true, network: "testnet", noteId: R.noteId, passwordRequired: false,
        amount: { value: "1", unit: "USDCX", more: false },
      });
      expect(JSON.stringify(first)).not.toContain("Invoice");
      expect(await within(dialog).findByRole("img", { name: "Preview of the receipt image" })).toHaveAttribute("src", "data:image/png;base64,AAAA");

      const hide = within(dialog).getByRole("checkbox", { name: "Hide amount" });
      expect(hide).not.toBeChecked();
      await userEvent.click(hide);
      await waitFor(() => expect(render_).toHaveBeenCalledTimes(2));
      expect(render_.mock.calls[1][0].hideAmount).toBe(true);
      await within(dialog).findByRole("img", { name: "Preview of the receipt image, amount hidden" });

      // No Web Share in jsdom: the image is downloaded.
      await userEvent.click(within(dialog).getByRole("button", { name: "Download image" }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(click.mock.contexts[0]).toMatchObject({ download: "notecheck-receipt.png", href: "blob:receipt" });
      click.mockRestore();

      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("hands the image to the share sheet when files can be shared", async () => {
      const share = vi.fn(async () => {});
      Object.assign(navigator, { share, canShare: () => true });
      try {
        h.chain = { notes: [fixtureOnChain()] };
        await show(await encodeReceipt(base));
        await heading(CONFIRMED);
        await userEvent.click(shareButton()!);
        const dialog = await screen.findByRole("dialog");
        await within(dialog).findByRole("img", { name: /^Preview/ });
        await userEvent.click(within(dialog).getByRole("button", { name: "Share…" }));
        expect(share).toHaveBeenCalledTimes(1);
        const arg = (share.mock.calls[0] as unknown as [ShareData])[0];
        expect(arg.title).toBe("Payment receipt · 1 USDCX");
        expect(arg.files![0].name).toBe("notecheck-receipt.png");
        expect(arg.files![0].type).toBe("image/png");
        expect(render_.mock.calls[0][0].received).toBe(false);
        await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      } finally {
        Object.assign(navigator, { share: undefined, canShare: undefined });
      }
    });
  });

  describe("P2IDE receipts", () => {
    async function showP2ide(reclaim: number | null, timelock: number | null, chain: Partial<Chain>) {
      const f = p2ideFile(reclaim, timelock);
      h.chain = { notes: [f.onChain], ...chain };
      return show(await encodeReceipt({ ...base, noteFile: f.b64 }));
    }

    it("spent before the sender could reclaim: received by the recipient", async () => {
      await showP2ide(1000, 600, { spentAt: 700, tip: 2000 });
      await heading(CONFIRMED);
      expect(within(hero()).getByText("2.5", { selector: ".rc-num" })).toBeInTheDocument();
      expect(screen.getByText("✓ Received by the recipient")).toHaveClass("rc-status-good");
      expect(screen.getByText(/claimed before the sender could take it back/)).toBeInTheDocument();
      expect(screen.getByText("P2IDE · private note")).toBeInTheDocument();
      expect(screen.getByText("Reclaim from block").parentElement).toHaveTextContent("1,000");
      expect(screen.getByText("Timelock until block").parentElement).toHaveTextContent("600");
    });

    it("unspent and reclaimable now: a warning verdict, not a green one", async () => {
      await showP2ide(1000, null, { tip: 1500 });
      await heading(/^Payment committed — the sender can still take it back$/);
      expect(screen.queryByRole("heading", { name: CONFIRMED })).not.toBeInTheDocument();
      expect(document.querySelector(".rc-verdict")).toHaveClass("rc-warn");
      expect(screen.getByText("Not claimed yet")).toHaveClass("rc-status-warn");
      expect(screen.getByText(/the sender can take it back now \(since block 1,000\)/)).toBeInTheDocument();
      expect(screen.getByText("Latest block at check").parentElement).toHaveTextContent("1,500");
    });

    it("reclaim waits for the timelock too", async () => {
      await showP2ide(1000, 1600, { tip: 1500 });
      await heading(CONFIRMED);
      expect(screen.getByText(/The recipient can claim it only from block 1,600 \(≈ .+, an estimate\)/)).toBeInTheDocument();
      expect(screen.getByText(/If it is still unclaimed at block 1,600 .+ the sender can take it back/)).toBeInTheDocument();
    });

    it("spent once reclaim was possible: may have gone to either party", async () => {
      await showP2ide(1000, null, { spentAt: 1200, tip: 2000 });
      await heading(/^Payment committed — it may have gone back to the sender$/);
      expect(screen.getByText("Claimed — by the recipient, or returned to the sender")).toBeInTheDocument();
      expect(screen.getByText(/^Sent .+ · claimed .+ UTC$/)).toBeInTheDocument();
      expect(screen.queryByText(/received by the recipient/)).not.toBeInTheDocument();
    });

    it("unspent before the reclaim block: confirmed, with an estimated reclaim date", async () => {
      await showP2ide(1000, null, { tip: 800 });
      await heading(CONFIRMED);
      expect(screen.getByText("Waiting for the recipient to claim")).toBeInTheDocument();
      expect(screen.getByText(/If it is still unclaimed at block 1,000 \(≈ .+ UTC, an estimate\), the sender can take it back\./)).toBeInTheDocument();
    });

    it("a timelock far ahead says from which block the recipient can claim", async () => {
      await showP2ide(null, 50_000, { tip: 1000 });
      await heading(CONFIRMED);
      expect(screen.getByText(/The recipient can claim it only from block 50,000 \(≈ .+, an estimate\)\./)).toBeInTheDocument();
    });

    it("an unreadable tip is treated as reclaimable", async () => {
      await showP2ide(1000, null, {});
      await heading(/^Payment committed — the sender may be able to take it back$/);
      expect(screen.getByText(/couldn't be read, so this may already be possible/)).toBeInTheDocument();
    });

    it("a P2IDE note without reclaim behaves like P2ID", async () => {
      await showP2ide(null, null, { tip: 1000, spentAt: 700 });
      await heading(CONFIRMED);
      expect(screen.getByText("✓ Received")).toBeInTheDocument();
      expect(screen.getByText("Reclaim from block").parentElement).toHaveTextContent("Never (reclaim disabled)");
    });
  });
});
