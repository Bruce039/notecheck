import { BRAND } from "@/brand";
import { LogoMark, Wordmark } from "@/components/Logo";

declare const __BUILD__: string;
const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
const REPO = "https://github.com/Bruce039/notecheck";
const YEAR = new Date().getFullYear();

type Link = { label: string; href: string; external?: boolean };

const GROUPS: { title: string; links: Link[] }[] = [
  {
    title: "Use",
    links: [
      { label: "Pay with a receipt", href: "/?tool=pay" },
      { label: "Request a payment", href: "/?tool=request" },
      { label: "Check a receipt", href: "/?tool=receipt" },
      { label: "Docs and FAQ", href: "/?tool=docs" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "Developer tools", href: "/?tool=address" },
      { label: "npm package", href: "https://www.npmjs.com/package/notecheck", external: true },
      { label: "Source on GitHub", href: REPO, external: true },
      { label: "Report a problem", href: `${REPO}/issues`, external: true },
    ],
  },
  {
    title: "Miden",
    links: [
      { label: "Midenscan", href: "https://explorer.cedar.miden.io", external: true },
      { label: "Testnet faucet", href: "https://faucet.testnet.miden.io", external: true },
      { label: "Miden docs", href: "https://docs.miden.xyz", external: true },
      { label: "miden.xyz", href: "https://miden.xyz", external: true },
    ],
  },
];

const FACTS = ["No backend", "No tracking", "Checked on chain"];

const linkProps = (l: Link) => (l.external ? { target: "_blank", rel: "noopener noreferrer" } : {});

/** Site footer: what NoteCheck is, where to go next, and what it does with your data. */
export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? "site-footer site-footer-compact" : "site-footer"}>
      {!compact && (
        <div className="sf-card">
          <div className="sf-about">
            <a href="/" className="sf-brand"><LogoMark size={26} /><Wordmark /></a>
            <p>{BRAND.pitch}</p>
            <ul className="sf-facts" aria-label="Privacy">
              {FACTS.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
          {GROUPS.map((g) => (
            <nav key={g.title} className="sf-group" aria-label={g.title}>
              <h2>{g.title}</h2>
              <ul>
                {g.links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} {...linkProps(l)}>
                      {l.label}{l.external && <span className="sf-ext" aria-hidden="true">↗</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      )}
      <div className="sf-bottom">
        <span>© {YEAR} {BRAND.name}. Independent project, not affiliated with Miden.</span>
        <span className="sf-meta">
          <a href={REPO} target="_blank" rel="noopener noreferrer">Open source</a>
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">MIT License</a>
          <span className="sf-version">Build {BUILD}</span>
        </span>
      </div>
    </footer>
  );
}
