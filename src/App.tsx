import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogoMark, Wordmark } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SiteFooter } from "@/components/SiteFooter";
import { AppWalletProvider } from "@/lib/wallet";
import { useDisconnectOnNetworkChange } from "@/lib/useDisconnectOnNetworkChange";
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
type DevToolId = "address" | "felt" | "tag" | "hash" | "fee" | "allowlist";

// The product gets the tabs; the developer tools share one, with their own row of chips.
const MAIN: { id: ToolId | "tools"; label: string }[] = [
  { id: "pay", label: "Pay" },
  { id: "request", label: "Request" },
  { id: "receipt", label: "Receipts" },
  { id: "tools", label: "Tools" },
];

const DEV_TOOLS: { id: DevToolId; label: string }[] = [
  { id: "address", label: "Address" },
  { id: "felt", label: "Felt / Word" },
  { id: "tag", label: "Note tag" },
  { id: "hash", label: "Hash" },
  { id: "fee", label: "Fee" },
  { id: "allowlist", label: "Allowlist" },
];

const TOOLS: { id: ToolId; ready: boolean }[] = [
  ...MAIN.filter((t) => t.id !== "tools").map((t) => ({ id: t.id as ToolId, ready: true })),
  ...DEV_TOOLS.map((t) => ({ id: t.id, ready: true })),
  { id: "docs", ready: true },
];

const isDevTool = (t: ToolId): t is DevToolId => DEV_TOOLS.some((d) => d.id === t);
const tabOf = (t: ToolId): ToolId | "tools" | null => (isDevTool(t) ? "tools" : t === "docs" ? null : t);

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
  useDisconnectOnNetworkChange(network);

  useEffect(() => {
    const q = new URLSearchParams({ tool });
    if (network !== "testnet") q.set("net", network);
    const url = `${window.location.pathname}?${q}`;
    if (url === window.location.pathname + window.location.search) return;
    // A payment request (`#q1.…`) stays in the URL while Pay shows it, e.g. across a network switch.
    const hash = tool === "pay" && window.location.hash.startsWith("#q1.") ? window.location.hash : "";
    window.history.replaceState(null, "", url + hash);
  }, [tool, network]);

  const tab = tabOf(tool);
  const lastDev = useRef<DevToolId>(isDevTool(tool) ? tool : "address");
  if (isDevTool(tool)) lastDev.current = tool;
  const go = (t: ToolId) => setState((s) => ({ ...s, tool: t }));

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="/" aria-label="NoteCheck home" onClick={(e) => { e.preventDefault(); go("pay"); }}>
          <LogoMark size={30} />
          <h1><Wordmark /></h1>
        </a>
        <div className="top-actions">
          <button
            type="button"
            className={tool === "docs" ? "top-link top-link-on" : "top-link"}
            aria-current={tool === "docs" ? "page" : undefined}
            onClick={() => go("docs")}
          >
            Docs
          </button>
          <ThemeToggle />
          <label className={`net net-${network}`}>
            <span className="sr-only">Network</span>
            <span className="net-dot" aria-hidden="true" />
            <select value={network} onChange={(e) => setState((s) => ({ ...s, network: e.target.value as Network }))}>
              {NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
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
        {MAIN.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === tab ? "tab tab-on" : "tab"}
            aria-current={t.id === tab ? "page" : undefined}
            onClick={() => go(t.id === "tools" ? lastDev.current : t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "tools" && (
        <nav className="subtabs" aria-label="Developer tools">
          {DEV_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === tool ? "subtab subtab-on" : "subtab"}
              aria-current={t.id === tool ? "page" : undefined}
              onClick={() => go(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

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
