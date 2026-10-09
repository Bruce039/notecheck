// Request tool: builds a payment-request link (and its QR code) from the form.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TESTNET_RECEIPT as F } from "@/receipt/fixtures";
import { toBech32 } from "@/tools/address/account";
import { decodeRequest } from "./format";

const h = vi.hoisted(() => ({ wallet: {} as Record<string, unknown>, verified: true }));

vi.mock("@miden-sdk/miden-wallet-adapter-react", () => ({ useWallet: () => h.wallet }));
vi.mock("@/lib/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tokens")>()),
  tokenInfo: async (_n: string, faucet: string) =>
    faucet === F.faucetId ? { symbol: "USDCX", decimals: 6, source: "chain", verified: h.verified } : null,
}));

import { RequestTool } from "./RequestTool";

const ME = toBech32(F.recipient, "testnet");

// jsdom's Blob has no stream(); bytes.ts gzips through Blob streams.
beforeAll(() => {
  const proto = Blob.prototype as Blob & { stream?: () => ReadableStream<Uint8Array> };
  if (typeof proto.stream === "function") return;
  proto.stream = function (this: Blob) {
    const read = () => this.arrayBuffer();
    return new ReadableStream<Uint8Array>({ async start(c) { c.enqueue(new Uint8Array(await read())); c.close(); } });
  };
});
beforeEach(() => {
  h.wallet = { connected: false, address: null };
  h.verified = true;
});

const linkText = async () => {
  const label = await screen.findByText("Request link");
  return label.parentElement!.querySelector("code")!.textContent!;
};
const createBtn = () => screen.getByRole("button", { name: "Create request link" });

describe("RequestTool", () => {
  it("creates a link that decodes to the request, with a QR code and guidance", async () => {
    render(<RequestTool network="testnet" />);
    const u = userEvent.setup();
    expect(screen.getByLabelText(/^Token/)).toHaveValue(toBech32(F.faucetId, "testnet"));
    await screen.findByText("verified");
    await u.type(screen.getByLabelText(/^Your address/), ME);
    await u.type(screen.getByLabelText(/^Amount \(USDCX\)/), "1.5");
    await u.type(screen.getByLabelText(/^Memo/), "Invoice #7");
    await u.type(screen.getByLabelText(/^Reference/), "INV-7");
    await u.click(createBtn());

    const url = await linkText();
    expect(url).toMatch(/^http:\/\/localhost(:\d+)?\/\?tool=pay#q1\./);
    const r = await decodeRequest(url.slice(url.indexOf("#")));
    expect(r).toMatchObject({ v: 1, network: "testnet", to: ME, faucetId: F.faucetId, amount: "1500000", memo: "Invoice #7", ref: "INV-7" });
    expect(Date.parse(r.createdAt!)).not.toBeNaN();

    const qr = screen.getByRole("img", { name: "QR code of the request link" });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(qr.querySelector("path.qr-dark")!.getAttribute("d")!.length).toBeGreaterThan(100);
    expect(screen.getByText("Send this to the person who pays you. When they pay, they get a receipt link to send back.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toMatch(/^\/\?tool=pay#q1\./);
  });

  it("hides a made link once the form changes", async () => {
    render(<RequestTool network="testnet" />);
    const u = userEvent.setup();
    await screen.findByText("verified");
    await u.type(screen.getByLabelText(/^Your address/), ME);
    await u.type(screen.getByLabelText(/^Amount/), "2");
    await u.click(createBtn());
    await linkText();
    await u.type(screen.getByLabelText(/^Amount/), "5");
    expect(screen.queryByText("Request link")).not.toBeInTheDocument();
  });

  it("prefills the connected wallet's address without its routing suffix", () => {
    h.wallet = { connected: true, address: `${ME}_qruqqypuyph` };
    render(<RequestTool network="testnet" />);
    expect(screen.getByLabelText(/^Your address/)).toHaveValue(ME);
  });

  it("refuses an address from another network and a non-positive amount", async () => {
    render(<RequestTool network="testnet" />);
    const u = userEvent.setup();
    await screen.findByText("verified");
    await u.type(screen.getByLabelText(/^Your address/), toBech32(F.recipient, "devnet"));
    expect(screen.getByRole("alert")).toHaveTextContent(/is for devnet .*on testnet/);
    await u.clear(screen.getByLabelText(/^Your address/));
    await u.type(screen.getByLabelText(/^Your address/), ME);
    await u.type(screen.getByLabelText(/^Amount/), "0");
    expect(screen.getByRole("alert")).toHaveTextContent("Amount must be positive.");
    expect(createBtn()).toBeDisabled();
  });

  it("warns about an unverified token and refuses an unknown one", async () => {
    h.verified = false;
    render(<RequestTool network="testnet" />);
    expect(await screen.findByText("unverified")).toBeInTheDocument();
    expect(screen.getByText(/The person paying will see the same warning/)).toBeInTheDocument();
    const u = userEvent.setup();
    const token = screen.getByLabelText(/^Token/);
    await u.clear(token);
    await u.type(token, "0x18101fa522c174b165efd4f70a0385");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Unknown token/));
    await u.click(screen.getByRole("button", { name: "use testnet USDCX" }));
    expect(token).toHaveValue(toBech32(F.faucetId, "testnet"));
  });
});
