import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { BRAND } from "@/brand";
import { EXAMPLE_RECEIPT_PATH } from "@/receipt/example";
import "./hero.css";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia(REDUCED_MOTION).matches;
}

/** True when the visitor asked for less motion. The CSS media query does the same; the class makes it testable. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

/** True while the element is scrolled out of view, so the loop can pause. */
function useOffscreen(ref: RefObject<HTMLElement | null>): boolean {
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return offscreen;
}

// Receipt slip outline: square top (it comes out of the slot), torn zigzag bottom like the logo.
const SLIP_X0 = 232;
const SLIP_X1 = 368;
const SLIP_TOP = 78;
const SLIP_BOTTOM = 298;
const TEETH = 8;
const SLIP_PATH = (() => {
  const half = (SLIP_X1 - SLIP_X0) / TEETH / 2;
  let d = `M${SLIP_X0} ${SLIP_TOP}H${SLIP_X1}V${SLIP_BOTTOM}`;
  for (let i = 0; i < TEETH; i++) d += `l-${half} -5l-${half} 5`;
  return `${d}Z`;
})();
const TRAVEL_PATH = "M168 88Q234 0 300 64";
const LOGO_SLIP = "M17 12a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v42l-5-3.5-5 3.5-5-3.5-5 3.5-5-3.5-5 3.5z";

function Illustration({ uid }: { uid: string }) {
  const id = (name: string) => `${uid}-${name}`;
  return (
    <svg className="nch-svg" viewBox="0 0 400 320" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id("card")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="nch-stop-card-a" />
          <stop offset="1" className="nch-stop-card-b" />
        </linearGradient>
        <radialGradient id={id("glow")}>
          <stop offset="0" className="nch-stop-glow" />
          <stop offset="1" className="nch-stop-glow nch-stop-clear" />
        </radialGradient>
        <linearGradient id={id("shine")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="nch-stop-shine nch-stop-clear" />
          <stop offset="0.5" className="nch-stop-shine" />
          <stop offset="1" className="nch-stop-shine nch-stop-clear" />
        </linearGradient>
        <mask id={id("trail")} maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="320">
          <path className="nch-trail-mask" d={TRAVEL_PATH} pathLength={1} />
        </mask>
        <clipPath id={id("paper")}>
          <rect x="200" y="81" width="200" height="239" />
        </clipPath>
        <clipPath id={id("pill")}>
          <rect x="-36" y="-13" width="72" height="26" rx="13" />
        </clipPath>
      </defs>

      {/* Soft halo behind the receipt */}
      <ellipse cx="300" cy="190" rx="130" ry="130" fill={`url(#${id("glow")})`} className="nch-halo" />

      {/* Wallet card */}
      <g className="nch-wallet">
        <rect className="nch-wallet-shadow" x="22" y="52" width="134" height="92" rx="14" />
        <rect x="14" y="40" width="150" height="96" rx="14" fill={`url(#${id("card")})`} />
        <path className="nch-wallet-gloss" d="M28 40h86c-30 18-62 30-100 34V54a14 14 0 0 1 14-14z" />
        <rect className="nch-chip" x="30" y="56" width="24" height="18" rx="4" />
        <path className="nch-chip-line" d="M30 65h24M42 56v18" />
        <text className="nch-wallet-label" x="30" y="100">Your account</text>
        <text className="nch-wallet-balance" x="30" y="122">•••• •••• ••</text>
        <g className="nch-send">
          <rect className="nch-send-ring" x="106" y="53" width="44" height="22" rx="11" />
          <rect className="nch-send-btn" x="106" y="53" width="44" height="22" rx="11" />
          <text className="nch-send-text" x="128" y="67.5" textAnchor="middle">Send</text>
        </g>
      </g>

      {/* Path the private note takes */}
      <path className="nch-path" d={TRAVEL_PATH} />
      <path className="nch-path nch-path-lit" d={TRAVEL_PATH} mask={`url(#${id("trail")})`} />

      {/* The private note: encrypted, only a lock and scrambled digits are visible */}
      <g className="nch-token">
        <rect className="nch-token-pill" x="-36" y="-13" width="72" height="26" rx="13" />
        <g clipPath={`url(#${id("pill")})`}>
          <rect className="nch-token-shine" x="-70" y="-13" width="34" height="26" fill={`url(#${id("shine")})`} />
        </g>
        <rect className="nch-lock-body" x="-27" y="-3" width="10" height="8" rx="2" />
        <path className="nch-lock-shackle" d="M-25 -3v-2.2a3 3 0 0 1 6 0V-3" />
        <text className="nch-digits nch-d1" x="-12" y="3.6">7f3a·9c</text>
        <text className="nch-digits nch-d2" x="-12" y="3.6">c91e·04</text>
        <text className="nch-digits nch-d3" x="-12" y="3.6">a2d8·b5</text>
      </g>
      {/* Receipt printer slot */}
      <ellipse cx="300" cy="81" rx="92" ry="16" fill={`url(#${id("glow")})`} className="nch-slot-glow" />
      <g className="nch-printer">
        <rect className="nch-slot" x="214" y="71" width="172" height="20" rx="10" />
        <rect className="nch-slit" x="226" y="79" width="148" height="4" rx="2" />
        <circle className="nch-led" cx="377" cy="81" r="2.5" />
      </g>

      {/* Receipt: printed slip, then the check and the stamp */}
      <g className="nch-receipt">
        <g clipPath={`url(#${id("paper")})`}>
          <g className="nch-sway">
            <g className="nch-print">
              <path className="nch-paper" d={SLIP_PATH} />
              <g className="nch-reveal nch-r1">
                <path className="nch-logo" d={LOGO_SLIP} transform="translate(242 92) scale(0.3)" />
                <path className="nch-logo-check" d="M24 31l6 6 11-12" transform="translate(242 92) scale(0.3)" />
                <text className="nch-slip-title" x="264" y="106">Receipt</text>
                <text className="nch-slip-ref" x="356" y="106" textAnchor="end">#0042</text>
              </g>
              <path className="nch-rule" d="M244 120H356" />
              <g className="nch-reveal nch-r2">
                <text className="nch-slip-label" x="244" y="138">Amount</text>
                <text className="nch-slip-amount" x="244" y="161">250.00</text>
              </g>
              <g className="nch-bars">
                <rect className="nch-bar nch-bar-label nch-b1" x="244" y="174" width="24" height="5" rx="2.5" />
                <rect className="nch-bar nch-b1" x="296" y="174" width="60" height="5" rx="2.5" />
                <rect className="nch-bar nch-bar-label nch-b2" x="244" y="188" width="18" height="5" rx="2.5" />
                <rect className="nch-bar nch-b2" x="308" y="188" width="48" height="5" rx="2.5" />
                <rect className="nch-bar nch-bar-label nch-b3" x="244" y="202" width="28" height="5" rx="2.5" />
                <rect className="nch-bar nch-b3" x="300" y="202" width="56" height="5" rx="2.5" />
              </g>
              <path className="nch-rule" d="M244 222H356" />
              <g className="nch-verdict">
                <circle className="nch-check-disc" cx="258" cy="248" r="13" />
                <path className="nch-check" d="M252 248.5l4.2 4.2 8.3-9" pathLength={1} />
                <text className="nch-found" x="278" y="246">Payment found</text>
                <text className="nch-block" x="278" y="258">Block 482,913</text>
              </g>
              <g className="nch-sparks">
                <circle cx="240" cy="232" r="1.6" />
                <circle cx="276" cy="228" r="1.3" />
                <circle cx="238" cy="262" r="1.3" />
                <circle cx="272" cy="268" r="1.6" />
              </g>
            </g>
          </g>
        </g>
        <g className="nch-sway">
          <g className="nch-stamp">
            <rect className="nch-stamp-box" x="-40" y="-16" width="80" height="32" rx="6" />
            <rect className="nch-stamp-inner" x="-36.5" y="-12.5" width="73" height="25" rx="4" />
            <text className="nch-stamp-a" x="0.5" y="-1.5" textAnchor="middle">CHECKED</text>
            <text className="nch-stamp-b" x="0.7" y="8.5" textAnchor="middle">ON MIDEN</text>
          </g>
        </g>
      </g>

    </svg>
  );
}

const STEPS = [
  {
    title: "Pay from your wallet",
    text: "Send a private payment. Your balance and history stay private.",
    icon: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="3" />
        <path d="M3 10h18M16 14.5h1.5" />
        <path d="M6 6l9-3 1.5 3" />
      </>
    ),
  },
  {
    title: "Get a receipt link",
    text: "One link carries the proof for this payment. Share it with anyone.",
    icon: (
      <>
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </>
    ),
  },
  {
    title: "They check it on Miden",
    text: "The link is checked against the network. Only this payment is visible.",
    icon: (
      <>
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
        <path d="M8.8 12.2l2.2 2.2 4.4-4.6" />
      </>
    ),
  },
];

/** Landing hero for the Pay screen: headline, two calls to action, an animated receipt story and three steps. */
export function Hero({ docsHref }: { docsHref: string }) {
  const rootRef = useRef<HTMLElement>(null);
  const uid = useId().replace(/[^\w-]/g, "");
  const reduced = useReducedMotion();
  const offscreen = useOffscreen(rootRef);
  const headingId = `${uid}-title`;

  const cls = ["nch", reduced && "nch-still", offscreen && "nch-paused"].filter(Boolean).join(" ");

  return (
    <section ref={rootRef} className={cls} aria-labelledby={headingId} data-motion={reduced ? "reduced" : "full"}>
      <div className="nch-inner">
        <div className="nch-main">
          <div className="nch-copy">
            <p className="nch-eyebrow">
              <span className="nch-eyebrow-dot" aria-hidden="true" />
              {BRAND.tagline}
            </p>
            <h2 id={headingId} className="nch-title">
              Private payments.{" "}
              <span className="nch-title-line">
                Receipts you can share and{" "}
                <span className="nch-mark">
                  check
                  <svg className="nch-swash" viewBox="0 0 120 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                    <path d="M3 10C30 4 70 2.5 117 6" pathLength={1} />
                  </svg>
                </span>
                .
              </span>
            </h2>
            <p className="nch-sub">{BRAND.pitch}</p>
            <div className="nch-ctas">
              <a className="btn btn-primary nch-cta" href={EXAMPLE_RECEIPT_PATH}>
                See an example receipt
                <svg className="nch-cta-arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" />
                </svg>
              </a>
              <a className="btn nch-cta" href={docsHref}>How it works</a>
            </div>
            <p className="nch-note">Checking a receipt needs only the link and a browser.</p>
          </div>

          <figure className="nch-art">
            <Illustration uid={uid} />
            <figcaption className="nch-sr-only">
              Illustration: a payment leaves your wallet as a private, encrypted note. A paper receipt prints out,
              and a green check with a stamp reading “Checked on Miden” shows the payment was found on the network.
            </figcaption>
          </figure>
        </div>

        <ol className="nch-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="nch-step" style={{ "--i": i } as CSSProperties}>
              <span className="nch-step-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">{s.icon}</svg>
              </span>
              <span className="nch-step-body">
                <span className="nch-step-num">Step {i + 1}</span>
                <strong className="nch-step-title">{s.title}</strong>
                <span className="nch-step-text">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
