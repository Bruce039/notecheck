// App shell: routing between the toolbox and the /r receipt page, URL <-> state sync, keyboard use.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/lib/wallet", () => ({
  AppWalletProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  WalletButton: () => <span>wallet-button-stub</span>,
}));
vi.mock("@miden-sdk/miden-wallet-adapter-react", () => ({ useWallet: () => ({ connected: false }) }));
vi.mock("notecheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("notecheck")>()),
  withRpc: () => new Promise(() => {}),
  tokenInfo: () => new Promise(() => {}),
}));
// Node 22+ shadows jsdom's localStorage with an unusable global; PayTool reads it on mount.
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} });

import App from "./App";

const go = (url: string) => window.history.replaceState(null, "", url);
const activeTab = () => document.querySelector(".tab-on")?.textContent;

describe("App", () => {
  it("defaults to Pay on testnet, marks the active tab and writes it to the URL", () => {
    go("/");
    render(<App />);
    expect(activeTab()).toBe("Pay");
    expect(screen.getByRole("button", { name: "Pay" })).toHaveAttribute("aria-current", "page");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("testnet");
    expect(window.location.search).toBe("?tool=pay");
    expect(document.querySelector(".nch")).not.toBeNull(); // landing hero
  });

  it("reads tool and network from the URL and ignores unknown values", () => {
    go("/?tool=receipt&net=devnet");
    const { unmount } = render(<App />);
    expect(activeTab()).toBe("Receipts");
    expect(screen.getByRole("heading", { name: "Receipts" })).toBeInTheDocument();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("devnet");
    unmount();

    go("/?tool=<script>&net=moon");
    render(<App />);
    expect(activeTab()).toBe("Pay");
    expect(window.location.search).toBe("?tool=pay");
  });

  it("switches tools and network, keeping the URL in sync", async () => {
    go("/?tool=address");
    render(<App />);
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Pay" }));
    expect(screen.getByRole("heading", { name: "Make a payment" })).toBeInTheDocument();
    expect(window.location.search).toBe("?tool=pay");
    await u.selectOptions(screen.getByRole("combobox"), "devnet");
    expect(window.location.search).toBe("?tool=pay&net=devnet");
    expect(screen.getByText(/Payments run on testnet for now/)).toBeInTheDocument();
  });

  it("can be driven with the keyboard alone", async () => {
    go("/?tool=address");
    render(<App />);
    const u = userEvent.setup();
    const tabs = screen.getAllByRole("button").filter((b) => b.classList.contains("tab"));
    expect(tabs.map((t) => t.textContent)).toEqual(["Pay", "Request", "Receipts", "Address", "Felt / Word", "Note tag", "Hash", "Fee", "Allowlist", "Docs"]);
    tabs[0].focus();
    for (let i = 0; i < 8; i++) await u.tab();
    expect(document.activeElement).toBe(tabs[8]);
    await u.keyboard("{Enter}");
    expect(activeTab()).toBe("Allowlist");
    for (let i = 0; i < 6; i++) await u.tab({ shift: true });
    await u.keyboard(" ");
    expect(activeTab()).toBe("Receipts");
  });

  it("opens the Request tool from its tab and from ?tool=request", async () => {
    go("/?tool=request");
    const { unmount } = render(<App />);
    expect(activeTab()).toBe("Request");
    expect(screen.getByRole("heading", { name: "Request a payment" })).toBeInTheDocument();
    unmount();
    go("/");
    render(<App />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Request" }));
    expect(window.location.search).toBe("?tool=request");
  });

  it("keeps a payment request fragment on Pay and hides the landing hero for it", async () => {
    go("/#q1.not-a-real-request");
    render(<App />);
    expect(window.location.search).toBe("?tool=pay");
    expect(window.location.hash).toBe("#q1.not-a-real-request");
    expect(screen.getByRole("heading", { name: "Make a payment" })).toBeInTheDocument();
    expect(await screen.findByText(/payment request link can't be read/)).toBeInTheDocument();
    expect(document.querySelector(".nch")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Request" }));
    expect(window.location.hash).toBe("");
  });

  it("serves the receipt page on /r without the toolbox", async () => {
    go("/r");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Payment receipt" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Tools" })).not.toBeInTheDocument();
    expect(await screen.findByText(/No receipt in this link/)).toBeInTheDocument();
    go("/r/");
    render(<App />);
    expect(screen.getAllByRole("heading", { name: "Payment receipt" })).toHaveLength(2);
  });
});
