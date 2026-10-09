// Decorative pieces of the receipt slip: verdict icons, the stamp, the paper grain and the
// skeleton shown while the chain is queried. All are aria-hidden; the text next to them carries
// the meaning. Motion lives in receipt.css and is switched off for reduced motion and print.
import { useId } from "react";

export type IconKind = "good" | "warn" | "unknown" | "bad";

/** The round verdict mark. Its strokes draw themselves in (see .rc-mark in receipt.css). */
export function VerdictIcon({ kind }: { kind: IconKind }) {
  return (
    <span className={`rc-icon rc-mark rc-mark-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" width="48" height="48" focusable="false">
        <circle className="rc-mark-disc" cx="24" cy="24" r="22" />
        <circle className="rc-mark-ring" cx="24" cy="24" r="22" pathLength={1} />
        {kind === "good" && <path className="rc-mark-stroke" d="M14.5 24.5l6.5 6.5 12.5-13" pathLength={1} />}
        {kind === "warn" && (
          <>
            <path className="rc-mark-stroke" d="M24 13.5v13" pathLength={1} />
            <circle className="rc-mark-dot" cx="24" cy="33.5" r="2.4" />
          </>
        )}
        {kind === "unknown" && (
          <>
            <path className="rc-mark-stroke" d="M18.5 19a5.5 5.5 0 1 1 7.7 5c-1.4.6-2.2 1.7-2.2 3.2v1.3" pathLength={1} />
            <circle className="rc-mark-dot" cx="24" cy="34.5" r="2.4" />
          </>
        )}
        {kind === "bad" && (
          <>
            <path className="rc-mark-stroke" d="M17 17l14 14" pathLength={1} />
            <path className="rc-mark-stroke rc-mark-stroke-2" d="M31 17L17 31" pathLength={1} />
          </>
        )}
      </svg>
    </span>
  );
}

const R_TEXT = 46;
const CIRCUMFERENCE = 2 * Math.PI * R_TEXT;

/**
 * An ink stamp, "CHECKED ON MIDEN · <date> ·" around the rim and the network in the middle.
 * Shown only for a chain-confirmed verdict; the date is the reader's local check date.
 */
export function Stamp({ date, network }: { date: string; network: string }) {
  const id = useId().replace(/:/g, "");
  const ring = `rc-stamp-ring-${id}`;
  const ink = `rc-stamp-ink-${id}`;
  return (
    <span className="rc-stamp" aria-hidden="true">
      <svg viewBox="0 0 120 120" width="112" height="112" focusable="false">
        <defs>
          <path id={ring} d={`M60 ${60 - R_TEXT}a${R_TEXT} ${R_TEXT} 0 1 1 -0.01 0`} />
          {/* Rough ink: displace the edges slightly and leave a few unprinted specks. */}
          <filter id={ink} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="1" seed="3" result="patch" />
            <feColorMatrix in="patch" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 2.05" result="holes" />
            <feComposite in="rough" in2="holes" operator="in" />
          </filter>
        </defs>
        <g filter={`url(#${ink})`}>
          <circle className="rc-stamp-rim" cx="60" cy="60" r="57" />
          <circle className="rc-stamp-inner" cx="60" cy="60" r="36" />
          <text className="rc-stamp-text">
            <textPath href={`#${ring}`} textLength={CIRCUMFERENCE - 4} lengthAdjust="spacing">
              CHECKED ON MIDEN · {date} ·
            </textPath>
          </text>
          <path className="rc-stamp-check" d="M47 57l9 9 17-18" />
          <text className="rc-stamp-net" x="60" y="82" textAnchor="middle">{network.toUpperCase()}</text>
        </g>
      </svg>
    </span>
  );
}

/** Very faint paper fibre over the slip. */
export function PaperGrain() {
  const id = `rc-grain-${useId().replace(/:/g, "")}`;
  return (
    <svg className="rc-grain" aria-hidden="true" focusable="false">
      <filter id={id}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.6 -0.55" result="a" />
        <feFlood floodColor="currentColor" />
        <feComposite in2="a" operator="in" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  );
}

/** The slip's shape with placeholder bars and a scanning light while the network is asked. */
export function SlipSkeleton() {
  return (
    <div className="rc-slip-wrap rc-skel-wrap" aria-hidden="true">
      <div className="rc-card rc-slip rc-skel">
        <div className="rc-skel-head">
          <span className="rc-skel-disc" />
          <span className="rc-skel-lines">
            <span className="rc-bar" style={{ width: "62%", height: 18 }} />
            <span className="rc-bar" style={{ width: "40%" }} />
          </span>
        </div>
        <Perforation />
        <div className="rc-skel-body">
          <span className="rc-bar" style={{ width: 52, height: 9 }} />
          <span className="rc-bar rc-bar-hero" />
          <span className="rc-bar" style={{ width: "48%" }} />
          <span className="rc-skel-rows">
            {[78, 70, 56].map((w) => (
              <span key={w} className="rc-skel-row">
                <span className="rc-bar" style={{ width: 72 }} />
                <span className="rc-bar" style={{ width: `${w}%` }} />
              </span>
            ))}
          </span>
        </div>
        <span className="rc-scan" />
      </div>
    </div>
  );
}

/** Dashed tear line with notches at both edges. */
export function Perforation() {
  return <div className="rc-perf" aria-hidden="true" />;
}

export function Chevron() {
  return (
    <svg className="rc-chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  );
}

export function CopyGlyph({ done }: { done: boolean }) {
  return (
    <svg className="rc-copy-glyph" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      {done
        ? <path className="rc-copy-tick" d="M3.5 8.5l3 3 6-7" pathLength={1} />
        : <><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" /><path d="M10.5 3.5v-.3A1.7 1.7 0 0 0 8.8 1.5H4.2a1.7 1.7 0 0 0-1.7 1.7v4.6a1.7 1.7 0 0 0 1.7 1.7h.3" /></>}
    </svg>
  );
}
