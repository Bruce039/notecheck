// Component tests for the Receipts tab: open a link, create a receipt from a NoteFile.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AccountId, Felt, FeltArray, FetchedNote, FungibleAsset, InputNote, Note, NoteAssets, NoteAttachment, NoteDetails,
  NoteFile, NoteId, NoteInclusionProof, NoteMetadata, NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType,
  type BlockHeader,
} from "@miden-sdk/miden-sdk";
import { TESTNET_RECEIPT as R } from "./fixtures";
import { decodeReceipt, MEMO_MAX, noteFileFromBase64, toBase64 } from "notecheck";

const h = vi.hoisted(() => ({ onChain: false, error: null as Error | null, rpcCalls: 0 }));

vi.mock("notecheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("notecheck")>()),
  withRpc: async (_network: string, fn: (rpc: unknown) => Promise<unknown>) => {
    h.rpcCalls++;
    return fn({
      getNotesById: async () => {
        if (h.error) throw h.error;
        return h.onChain
          ? [new FetchedNote(
            NoteId.fromHex(R.noteId),
            new NoteMetadata(AccountId.fromHex(R.sender), NoteType.Private, new NoteTag(1961623552)),
            NoteInclusionProof.mockAtBlock(R.inclusionBlock),
          )]
          : [];
      },
      getNullifierCommitHeight: async () => R.spentAt,
      getBlockHeaderByNumber: async () => ({ timestamp: () => 1_760_000_000 }) as unknown as BlockHeader,
    });
  },
}));

import { ReceiptsTool } from "./ReceiptsTool";

const bytesOf = (x: Uint8Array | number[]) => Uint8Array.from(x);
const assets = () => new NoteAssets([new FungibleAsset(AccountId.fromHex(R.faucetId), 5n)]);
const fullFile = (note: Note) =>
  toBase64(bytesOf(NoteFile.fromInputNote(InputNote.authenticated(note, NoteInclusionProof.mockAtBlock(7))).serialize()));

function detailsFileB64(): string {
  const note = NoteFile.deserialize(noteFileFromBase64(R.noteFileB64)).note()!;
  return toBase64(bytesOf(NoteFile.fromNoteDetails(new NoteDetails(note.assets(), note.recipient())).serialize()));
}
function swapFileB64(): string {
  const meta = new NoteMetadata(AccountId.fromHex(R.sender), NoteType.Private, new NoteTag(0));
  const storage = new NoteStorage(new FeltArray([new Felt(1n), new Felt(2n), new Felt(0n), new Felt(0n)]));
  return fullFile(new Note(assets(), meta, NoteRecipient.fromScript(NoteScript.swap(), storage)));
}
function p2ideFileB64(): string {
  return fullFile(Note.createP2IDENote(
    AccountId.fromHex(R.sender), AccountId.fromHex(R.recipient), assets(), 100, null, NoteType.Private, new NoteAttachment(),
  ));
}

async function paste(b64: string) {
  const u = userEvent.setup();
  const input = screen.getByLabelText("…or paste it as base64");
  await u.clear(input);
  // Typing ~600 characters one by one is slow; paste instead.
  await u.click(input);
  await u.paste(b64);
  await u.click(screen.getByRole("button", { name: "Read" }));
  return u;
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

beforeAll(addBlobStream);
beforeEach(() => {
  h.onChain = false;
  h.error = null;
  h.rpcCalls = 0;
});

describe("ReceiptsTool", () => {
  it("open: turns a pasted link into a /r# link", async () => {
    render(<ReceiptsTool network="testnet" />);
    // Without input it is a disabled button, so assistive tech doesn't announce a dead link.
    expect(screen.queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "See an example receipt" }).getAttribute("href")).toMatch(/^\/r#r1\./);
    await userEvent.type(screen.getByLabelText("Receipt link"), "https://elsewhere.example/r#r1.abc");
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/r#r1.abc");
  });

  it("creates a password-protected link from a pasted NoteFile that is on chain", async () => {
    h.onChain = true;
    render(<ReceiptsTool network="testnet" />);
    const u = await paste(R.noteFileB64);
    expect(await screen.findByText("on testnet, block 83,790")).toBeInTheDocument();
    expect(screen.getByText("P2ID")).toBeInTheDocument();
    expect(screen.getByText(R.noteId)).toBeInTheDocument();
    await u.type(screen.getByLabelText(/^Memo/), "Invoice #42");
    await u.type(screen.getByLabelText("Password (optional)"), "hunter22");
    expect(screen.getByText(/Send the password through a different channel/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Create link" }));
    const field = (await screen.findByText("Receipt link", { selector: ".field-label" })).parentElement!;
    const url = within(field).getByText(/\/r#r1e\./).textContent!;
    expect(url.startsWith(window.location.origin + "/r#r1e.")).toBe(true);
    const r = await decodeReceipt(url.slice(url.indexOf("#")), "hunter22");
    expect(r).toMatchObject({ v: 1, network: "testnet", noteFile: R.noteFileB64, memo: "Invoice #42" });
    expect(Date.parse(r.createdAt!)).toBeGreaterThan(0);
    expect(within(field).getByRole("link", { name: "Open" }).getAttribute("href")).toMatch(/^\/r#r1e\./);
    expect(within(field).getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("reads a NoteFile chosen with the file picker", async () => {
    render(<ReceiptsTool network="testnet" />);
    const file = new File([noteFileFromBase64(R.noteFileB64)], "note.mno");
    await userEvent.upload(screen.getByLabelText(/^Note file/), file);
    expect(await screen.findByText("not found on testnet")).toBeInTheDocument();
    expect(screen.getByText(/This note isn't on testnet \(yet\)/)).toBeInTheDocument();
    expect(screen.getByText(R.noteId)).toBeInTheDocument();
  });

  it("refuses a file larger than 64 KiB", async () => {
    render(<ReceiptsTool network="testnet" />);
    // The picker filters on .mno, but "All files" or drag and drop can still hand over anything.
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText(/^Note file/), new File([new Uint8Array(70_000)], "big.bin"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/"big\.bin" isn't a Miden note file/);
    expect(h.rpcCalls).toBe(0);
  });

  it("explains what a note file is when given some other small file", async () => {
    render(<ReceiptsTool network="testnet" />);
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText(/^Note file/), new File([new TextEncoder().encode("%PDF-1.7 not a note")], "report.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't a Miden note file\. Export one with the Miden CLI/);
    expect(screen.queryByRole("button", { name: "Create link" })).not.toBeInTheDocument();
  });

  it("requires at least 8 characters when a password is set", async () => {
    h.onChain = true;
    render(<ReceiptsTool network="testnet" />);
    const u = await paste(R.noteFileB64);
    await screen.findByText("on testnet, block 83,790");
    await u.type(screen.getByLabelText("Password (optional)"), "short");
    expect(screen.getByText(/at least 8 characters/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create link" })).toBeDisabled();
  });

  it("rejects a Details-format NoteFile with a Full-format hint", async () => {
    render(<ReceiptsTool network="testnet" />);
    await paste(detailsFileB64());
    expect(await screen.findByRole("alert")).toHaveTextContent(/note details only; export it in Full format/);
    expect(screen.queryByRole("button", { name: "Create link" })).not.toBeInTheDocument();
    expect(h.rpcCalls).toBe(0);
  });

  it("rejects a non-P2ID note", async () => {
    render(<ReceiptsTool network="testnet" />);
    await paste(swapFileB64());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Only P2ID and P2IDE notes can be shown as receipts/);
    expect(screen.queryByRole("button", { name: "Create link" })).not.toBeInTheDocument();
  });

  it("accepts a P2IDE note", async () => {
    render(<ReceiptsTool network="testnet" />);
    await paste(p2ideFileB64());
    expect(await screen.findByText("P2IDE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled();
  });

  it("rejects text that is not base64", async () => {
    render(<ReceiptsTool network="testnet" />);
    await paste("this is not base64!");
    expect(await screen.findByRole("alert")).toHaveTextContent("The receipt is not valid base64.");
  });

  it("shows when the node can't be reached but still allows a link", async () => {
    h.error = new Error("offline");
    render(<ReceiptsTool network="testnet" />);
    await paste(R.noteFileB64);
    expect(await screen.findByText("couldn't reach testnet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create link" })).toBeEnabled();
  });

  it("does not query a node on mainnet, and the link carries the selected network", async () => {
    render(<ReceiptsTool network="mainnet" />);
    const u = await paste(R.noteFileB64);
    await screen.findByText("P2ID");
    expect(screen.queryByText(/checking/)).not.toBeInTheDocument();
    expect(h.rpcCalls).toBe(0);
    await u.click(screen.getByRole("button", { name: "Create link" }));
    const field = (await screen.findByText("Receipt link", { selector: ".field-label" })).parentElement!;
    const url = within(field).getByText(/\/r#r1\./).textContent!;
    expect((await decodeReceipt(url.slice(url.indexOf("#")))).network).toBe("mainnet");
  });

  it("caps the memo at the format limit", async () => {
    render(<ReceiptsTool network="testnet" />);
    const u = await paste(R.noteFileB64);
    await screen.findByText("P2ID");
    const memo = screen.getByLabelText(/^Memo/);
    await u.click(memo);
    await u.paste("x".repeat(MEMO_MAX + 50));
    expect((memo as HTMLInputElement).value).toHaveLength(MEMO_MAX);
  });

  it("clears the previously loaded note when a new paste is invalid", async () => {
    render(<ReceiptsTool network="testnet" />);
    await paste(R.noteFileB64);
    await screen.findByText(R.noteId);
    await paste("garbage!!");
    await screen.findByRole("alert");
    expect(screen.queryByText(R.noteId)).not.toBeInTheDocument();
  });
});
