import { BRAND } from "@/brand";
import { LogoMark, Wordmark } from "@/components/Logo";

declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
const REPO = "https://github.com/Bruce039/notecheck";

const LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "Docs", href: "/?tool=docs" },
  { label: "Developer tools", href: "/?tool=address" },
  { label: "GitHub", href: REPO, external: true },
  { label: "Report a problem", href: `${REPO}/issues`, external: true },
  { label: "Midenscan", href: "https://explorer.cedar.miden.io", external: true },
  { label: "Testnet faucet", href: "https://faucet.testnet.miden.io", external: true },
];

const FACTS = ["No backend", "No tracking", "Checked on chain"];

/** Site footer: what NoteCheck is, where to go next, and what it does with your data. */
export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="site-footer">
      {!compact && (
        <div className="sf-main">
          <div className="sf-about">
            <a href="/" className="sf-brand"><LogoMark size={24} /><Wordmark /></a>
            <p>{BRAND.pitch}</p>
            <ul className="sf-facts" aria-label="Privacy">
              {FACTS.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
          <nav className="sf-links" aria-label="Links">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} {...(l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                {l.label}{l.external && <span aria-hidden="true"> ↗</span>}
              </a>
            ))}
          </nav>
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
