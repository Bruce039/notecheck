import { useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  MAX_LOG, X_TICKS, X_TICKS_NARROW, cyclesAtLog, feeSteps, formatCompact, linear, log2Cycles, stepPath, yTicks,
} from "./chart";
import { computeFee, type FeeResult } from "./fee";
import "./fee.css";

const fmt = (n: bigint | number) => Number(n).toLocaleString("en-US");
const cyc = (n: bigint) => `${fmt(n)} cycle${n === 1n ? "" : "s"}`;

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { if (el.clientWidth > 0) setWidth(el.clientWidth); };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Pow({ k }: { k: number }) {
  return <>2<tspan className="fc-sup" dy="-0.45em">{k}</tspan></>;
}

export function FeeChart({ fee }: { fee: FeeResult }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>(640);
  const gid = "fc" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [hoverX, setHoverX] = useState<number | null>(null);

  const narrow = width < 480;
  const h = narrow ? 220 : 260;
  const base = fee.baseFee;
  const ticks = yTicks(base);
  const labelChars = Math.max(...ticks.map((v) => formatCompact(v).length));
  const m = { l: Math.round(labelChars * 6.8 + 16), r: narrow ? 12 : 18, t: 26, b: 30 };
  const maxFee = Number(base) * (MAX_LOG + 1) || 1;
  const x = linear(0, MAX_LOG, m.l, width - m.r);
  const y = linear(0, maxFee, h - m.b, m.t);
  const steps = useMemo(() => feeSteps(base), [base]);
  const path = stepPath(steps, x, y);

  const px = x(log2Cycles(fee.cycles));
  const py = y(Number(fee.fee));
  const bandFrom = x(fee.logCycles - 1);
  const bandTo = x(Math.min(fee.logCycles, MAX_LOG));
  const bandW = Math.max(bandTo - bandFrom, 3);
  const next = fee.nextStep === null ? null : { x: x(fee.logCycles), y: y(Number(base) * (fee.logCycles + 1)) };

  const hover = (() => {
    if (hoverX === null) return null;
    const cycles = cyclesAtLog((hoverX - m.l) / (width - m.l - m.r) * MAX_LOG);
    const r = computeFee(cycles, base);
    return { cycles, fee: r.fee, logCycles: r.logCycles, x: x(log2Cycles(cycles)), y: y(Number(r.fee)) };
  })();

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (box) setHoverX(Math.min(Math.max(e.clientX - box.left, m.l), width - m.r));
  };

  const label =
    `Fee staircase from 1 to 2^${MAX_LOG} cycles on a log scale. ` +
    `${cyc(fee.cycles)} cost ${fmt(fee.fee)} (${fee.logCycles} × base fee ${fmt(base)}). ` +
    (fee.nextStep === null
      ? "This is the last step."
      : `The fee rises to ${fmt(base * BigInt(fee.logCycles + 1))} at ${fmt(fee.nextStep)} cycles.`);

  const tip = hover && (() => {
    const text = `${cyc(hover.cycles)} → ${fmt(hover.fee)} (${hover.logCycles}×)`;
    const tw = text.length * 6.6 + 16;
    const left = hover.x + 10 + tw > width - m.r ? hover.x - 10 - tw : hover.x + 10;
    const top = Math.max(m.t - 18, Math.min(hover.y - 30, h - m.b - 26));
    return { text, tw, left, top };
  })();

  return (
    <figure className="fc">
      <div className="fc-head">
        <h3>Fee by cycles</h3>
        <span className="muted small">log₂ scale · one step per power of two</span>
      </div>
      <div className="fc-plot" ref={wrapRef}>
        <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={label}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="fc-area-top" />
              <stop offset="1" className="fc-area-bottom" />
            </linearGradient>
          </defs>

          {ticks.map((v) => (
            <g key={String(v)} className="fc-ytick">
              <line x1={m.l} x2={width - m.r} y1={y(Number(v))} y2={y(Number(v))} />
              <text x={m.l - 8} y={y(Number(v))} dy="0.32em" textAnchor="end">{formatCompact(v)}</text>
            </g>
          ))}
          {(narrow ? X_TICKS_NARROW : X_TICKS).map((k) => (
            <g key={k} className="fc-xtick">
              <line x1={x(k)} x2={x(k)} y1={h - m.b} y2={h - m.b + 4} />
              <text x={x(k)} y={h - m.b + 18} textAnchor={k === 0 ? "start" : k === MAX_LOG ? "end" : "middle"}>
                {k === 0 ? "1" : <Pow k={k} />}
              </text>
            </g>
          ))}

          <rect className="fc-band" x="0" y="0" width="1" height="1"
            style={{ transform: `translate(${bandFrom}px, ${m.t}px) scale(${bandW}, ${h - m.b - m.t})` }} />

          <path className="fc-area" d={`${path}V${y(0)}H${x(0)}Z`} fill={`url(#${gid})`} />
          <path className="fc-steps" d={path} pathLength={1} key={String(base)} />
          <circle className="fc-end" cx={x(MAX_LOG)} cy={y(maxFee)} r="2.5" />
          <rect className="fc-tread" x="0" y="0" width="1" height="1"
            style={{ transform: `translate(${bandFrom}px, ${py - 2}px) scale(${bandW}, 4)` }} />

          {next && (
            <g className="fc-next" style={{ transform: `translate(${next.x}px, 0)` }}>
              <line x1="0" x2="0" y1={m.t - 6} y2={h - m.b} />
              <circle cx="0" cy={next.y} r="4" />
              <text x={next.x > width - 90 ? -6 : 6} y={m.t - 10}
                textAnchor={next.x > width - 90 ? "end" : "start"}>
                next <Pow k={fee.logCycles} />
              </text>
            </g>
          )}

          <line className="fc-axis" x1={m.l} x2={width - m.r} y1={h - m.b} y2={h - m.b} />

          <g className="fc-point" style={{ transform: `translate(${px}px, ${py}px)` }}>
            <circle className="fc-halo" r="11" />
            <circle className="fc-dot" r="5" />
          </g>

          {hover && tip && (
            <g className="fc-hover" pointerEvents="none">
              <line x1={hover.x} x2={hover.x} y1={m.t} y2={h - m.b} />
              <line x1={m.l} x2={width - m.r} y1={hover.y} y2={hover.y} />
              <circle cx={hover.x} cy={hover.y} r="3.5" />
              <rect x={tip.left} y={tip.top} width={tip.tw} height="22" rx="6" />
              <text x={tip.left + 8} y={tip.top + 15}>{tip.text}</text>
            </g>
          )}

          <rect className="fc-hit" x={m.l} y={m.t} width={Math.max(width - m.l - m.r, 0)} height={h - m.t - m.b}
            onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHoverX(null)} />
        </svg>
      </div>
      <figcaption className="fc-legend">
        <span className="fc-key fc-key-dot">
          <b>{fmt(fee.cycles)}</b> cycle{fee.cycles === 1n ? "" : "s"} → <b>{fmt(fee.fee)}</b>
          <span className="muted"> ({fee.logCycles} × {fmt(base)})</span>
        </span>
        <span className="fc-key fc-key-band">
          {fee.stepMin === fee.stepMax
            ? `only ${cyc(fee.stepMin)} pays this`
            : `same fee for ${fmt(fee.stepMin)}–${fmt(fee.stepMax)}`}
        </span>
        {fee.nextStep !== null && fee.cyclesUntilNext !== null && (
          <span className="fc-key fc-key-next">
            +{cyc(fee.cyclesUntilNext)} → {fmt(base * BigInt(fee.logCycles + 1))}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
