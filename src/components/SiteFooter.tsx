import { BRAND } from "@/brand";
import { LogoMark, Wordmark } from "@/components/Logo";

declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
const REPO = "https://github.com/Bruce039/notecheck";

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Payments",
    links: [
      { label: "Pay with a receipt", href: "/?tool=pay" },
      { label: "Request a payment", href: "/?tool=request" },
      { label: "Open or make a receipt", href: "/?tool=receipt" },
      { label: "Docs and FAQ", href: "/?tool=docs" },
    ],
  },
  {
    title: "Developer tools",
    links: [
      { label: "Address / account ID", href: "/?tool=address" },
      { label: "Felt / word", href: "/?tool=felt" },
      { label: "Note tag", href: "/?tool=tag" },
      { label: "Hash", href: "/?tool=hash" },
      { label: "Fee calculator", href: "/?tool=fee" },
      { label: "Allowlist and invite codes", href: "/?tool=allowlist" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Source code on GitHub", href: REPO, external: true },
      { label: "Report a problem", href: `${REPO}/issues`, external: true },
      { label: "Midenscan (testnet explorer)", href: "https://testnet.midenscan.com", external: true },
      { label: "Testnet faucet", href: "https://faucet.testnet.miden.io", external: true },
      { label: "Miden", href: "https://miden.xyz", external: true },
      { label: "Miden docs", href: "https://docs.miden.xyz", external: true },
    ],
  },
];

/** Site footer: what NoteCheck is, where everything lives, and what it does with your data. */
export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="site-footer">
      {!compact && (
        <div className="sf-grid">
          <div className="sf-about">
            <a href="/" className="sf-brand"><LogoMark size={26} /><Wordmark /></a>
            <p>{BRAND.pitch}</p>
            <ul className="sf-facts">
              <li><b>No backend.</b> Everything runs in your browser; a receipt lives in its link and is never sent to a server.</li>
              <li><b>No tracking.</b> No analytics, cookies or third-party scripts.</li>
              <li><b>Checked on chain.</b> Receipts are verified against a Miden node each time they're opened.</li>
              <li><b>Testnet only for now.</b> Amounts have no real value. Mainnet support follows its launch.</li>
            </ul>
          </div>
          {COLUMNS.map((c) => (
            <nav key={c.title} className="sf-col" aria-label={c.title}>
              <h2>{c.title}</h2>
              <ul>
                {c.links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                      {l.label}{l.external && <span aria-hidden="true"> ↗</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      )}
      <div className="sf-bottom">
        <span>{BRAND.disclaimer}.</span>
        <span>
          Built with <code>@miden-sdk/miden-sdk</code> 0.17 · <a href={REPO} target="_blank" rel="noopener noreferrer">MIT license</a>
          {" "}· build <code>{BUILD}</code>
        </span>
      </div>
    </footer>
  );
}
