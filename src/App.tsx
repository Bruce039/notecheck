import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoMark, Wordmark } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SiteFooter } from "@/components/SiteFooter";
import { AppWalletProvider } from "@/lib/wallet";
import { PayTool } from "@/pay/PayTool";
import { ReceiptPage } from "@/receipt/ReceiptPage";
import { ReceiptsTool } from "@/receipt/ReceiptsTool";
import { RequestTool } from "@/request/RequestTool";
import { DocsPage } from "@/docs/DocsPage";
import { AddressTool } from "@/tools/address/AddressTool";
import { AllowlistTool } from "@/tools/allowlist/AllowlistTool";
import { FeeTool } from "@/tools/fee/FeeTool";
import { FeltTool } from "@/tools/felt/FeltTool";
import { HashTool } from "@/tools/hash/HashTool";
import { TagTool } from "@/tools/tag/TagTool";
import { type Network, NETWORKS } from "notecheck";

type ToolId = "address" | "felt" | "tag" | "hash" | "fee" | "allowlist" | "pay" | "request" | "receipt" | "docs";

// Receipts first: they are the product; the developer tools follow.
const TOOLS: { id: ToolId; label: string; ready: boolean }[] = [
  { id: "pay", label: "Pay", ready: true },
  { id: "request", label: "Request", ready: true },
  { id: "receipt", label: "Receipts", ready: true },
  { id: "address", label: "Address", ready: true },
  { id: "felt", label: "Felt / Word", ready: true },
  { id: "tag", label: "Note tag", ready: true },
  { id: "hash", label: "Hash", ready: true },
  { id: "fee", label: "Fee", ready: true },
  { id: "allowlist", label: "Allowlist", ready: true },
  { id: "docs", label: "Docs", ready: true },
];

const isTool = (s: string | null): s is ToolId => TOOLS.some((t) => t.id === s && t.ready);
const isNetwork = (s: string | null): s is Network => NETWORKS.includes(s as Network);

function readUrl(): { tool: ToolId; network: Network } {
  const q = new URLSearchParams(window.location.search);
  const tool = q.get("tool"), net = q.get("net");
  return { tool: isTool(tool) ? tool : "pay", network: isNetwork(net) ? net : "testnet" };
}

const isReceiptRoute = () => window.location.pathname.replace(/\/$/, "") === "/r";

export default function App() {
  if (isReceiptRoute()) {
    return (
      <div className="app">
        <header className="top">
          <div className="brand">
            <a href="/" aria-label="NoteCheck home"><LogoMark /></a>
            <div>
              <h1>Payment receipt</h1>
              <p className="muted small"><a href="/">NoteCheck</a> · checked in your browser against the Miden network.</p>
            </div>
          </div>
          <div className="top-actions"><ThemeToggle /></div>
        </header>
        <main className="receipt-main"><AppWalletProvider><ReceiptPage /></AppWalletProvider></main>
        <SiteFooter compact />
      </div>
    );
  }
  return <AppWalletProvider><Toolbox /></AppWalletProvider>;
}

type Pill = { x: number; y: number; w: number; h: number };

/** Position of the active tab inside the rail, for the sliding highlight behind it. */
function useActivePill(tool: ToolId) {
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<Pill | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = () => {
      const el = nav.querySelector<HTMLElement>(".tab-on");
      setPill(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
    };
    place();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", place);
      return () => window.removeEventListener("resize", place);
    }
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [tool]);
  return { navRef, pill };
}

function Toolbox() {
  const [{ tool, network }, setState] = useState(readUrl);
  const { navRef, pill } = useActivePill(tool);

  useEffect(() => {
    const q = new URLSearchParams({ tool });
    if (network !== "testnet") q.set("net", network);
    const url = `${window.location.pathname}?${q}`;
    if (url === window.location.pathname + window.location.search) return;
    // A payment request (`#q1.…`) stays in the URL while Pay shows it, e.g. across a network switch.
    const hash = tool === "pay" && window.location.hash.startsWith("#q1.") ? window.location.hash : "";
    window.history.replaceState(null, "", url + hash);
  }, [tool, network]);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <LogoMark size={32} />
          <div>
            <h1><Wordmark /></h1>
            <p className="muted small">Miden developer tools and private payment receipts. Runs entirely in your browser.</p>
          </div>
        </div>
        <div className="top-actions">
          <ThemeToggle />
          <label className="net">
            <span className="sr-only">Network</span>
            <select value={network} onChange={(e) => setState((s) => ({ ...s, network: e.target.value as Network }))}>
              {NETWORKS.map((n) => <option key={n} value={n}>{n === "mainnet" ? "mainnet (soon)" : n}</option>)}
            </select>
          </label>
        </div>
      </header>

      <nav className="tabs" aria-label="Tools" ref={navRef}>
        {pill && (
          <span
            className="tab-indicator"
            aria-hidden="true"
            style={{ transform: `translate(${pill.x}px, ${pill.y}px)`, width: pill.w, height: pill.h }}
          />
        )}
        {TOOLS.map((t) => (
          <Fragment key={t.id}>
          <button
            type="button"
            className={t.id === tool ? "tab tab-on" : "tab"}
            aria-current={t.id === tool ? "page" : undefined}
            disabled={!t.ready}
            title={t.ready ? undefined : "Coming soon"}
            onClick={() => setState((s) => ({ ...s, tool: t.id }))}
          >
            {t.label}
          </button>
          {(t.id === "receipt" || t.id === "allowlist") && <span className="tab-sep" aria-hidden="true" />}
          </Fragment>
        ))}
      </nav>

      <main>
        {tool === "address" && <AddressTool network={network} />}
        {tool === "felt" && <FeltTool />}
        {tool === "tag" && <TagTool />}
        {tool === "hash" && <HashTool />}
        {tool === "fee" && <FeeTool network={network} />}
        {tool === "allowlist" && <AllowlistTool network={network} />}
        {tool === "pay" && <PayTool network={network} />}
        {tool === "request" && <RequestTool network={network} />}
        {tool === "receipt" && <ReceiptsTool network={network} />}
        {tool === "docs" && <DocsPage />}
      </main>

      <SiteFooter />
    </div>
  );
}
