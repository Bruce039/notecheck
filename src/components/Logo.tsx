import { BRAND } from "@/brand";

/** Receipt slip with a check. Uses the accent token, so it follows the theme. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path className="lm-slip" d="M17 12a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v42l-5-3.5-5 3.5-5-3.5-5 3.5-5-3.5-5 3.5z" fill="var(--accent)" />
      <path className="lm-check" d="M24 31l6 6 11-12" fill="none" stroke="var(--on-accent)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      {BRAND.lead}<span className="wordmark-tail">{BRAND.tail}</span>
    </span>
  );
}
