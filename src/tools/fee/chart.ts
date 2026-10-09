/**
 * Geometry for the fee step chart. The x axis is log2(cycles) from 0 (1 cycle)
 * to 29 (MAX_TX_CYCLES); every fee comes from `computeFee`, so the chart can't
 * drift from the formula.
 */
import { MAX_TX_CYCLES, computeFee } from "./fee";

/** log2(MAX_TX_CYCLES): the right edge of the x axis. */
export const MAX_LOG = MAX_TX_CYCLES.toString(2).length - 1;
export const X_TICKS = [0, 5, 10, 15, 20, 25, MAX_LOG];
export const X_TICKS_NARROW = [0, 10, 20, MAX_LOG];

export type Step = {
  /** x range [from, to] in log2 units; the last step is the single point 2^29. */
  from: number;
  to: number;
  /** ilog2(cycles) + 1 for every cycle count in the step. */
  logCycles: number;
  fee: bigint;
};

/** One step per power of two: cycles in [2^k, 2^(k+1)) pay base × (k + 1). */
export function feeSteps(baseFee: bigint): Step[] {
  const steps: Step[] = [];
  for (let k = 0; k <= MAX_LOG; k++) {
    const r = computeFee(1n << BigInt(k), baseFee);
    steps.push({ from: k, to: Math.min(k + 1, MAX_LOG), logCycles: r.logCycles, fee: r.fee });
  }
  return steps;
}

/** Real-valued log2 of a cycle count, exact at powers of two. */
export function log2Cycles(cycles: bigint): number {
  const bits = cycles.toString(2).length - 1;
  if (cycles === 1n << BigInt(bits)) return bits;
  return Math.log2(Number(cycles));
}

/** Cycle count under an x position, clamped to [1, 2^29]. */
export function cyclesAtLog(x: number): bigint {
  if (!(x > 0)) return 1n;
  if (x >= MAX_LOG) return MAX_TX_CYCLES;
  const v = BigInt(Math.floor(2 ** x));
  return v < 1n ? 1n : v > MAX_TX_CYCLES ? MAX_TX_CYCLES : v;
}

export type Scale = (v: number) => number;
export function linear(d0: number, d1: number, r0: number, r1: number): Scale {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** SVG path of the staircase: horizontal treads joined by vertical risers. */
export function stepPath(steps: Step[], x: Scale, y: Scale): string {
  return steps.map((s, i) => {
    const yy = y(Number(s.fee)).toFixed(2);
    const head = i === 0 ? `M${x(s.from).toFixed(2)},${yy}` : `V${yy}`;
    return `${head}H${x(s.to).toFixed(2)}`;
  }).join("");
}

/** 1,234 below ten thousand, then 12.3K, 4.5M, 1.2B. */
export function formatCompact(n: bigint | number): string {
  const v = Number(n);
  if (Math.abs(v) < 10_000) return v.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

/** Fee values to label on the y axis: 0 and every 10th step. */
export function yTicks(baseFee: bigint): bigint[] {
  if (baseFee === 0n) return [0n];
  return [0n, 10n, 20n, 30n].map((m) => m * baseFee);
}
