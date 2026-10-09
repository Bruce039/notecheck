// @vitest-environment node
import { MAX_LOG, X_TICKS, cyclesAtLog, feeSteps, formatCompact, linear, log2Cycles, stepPath, yTicks } from "./chart";
import { MAX_TX_CYCLES, computeFee } from "./fee";

describe("feeSteps", () => {
  it("has one step per power of two up to 2^29, priced by computeFee", () => {
    const steps = feeSteps(7n);
    expect(MAX_LOG).toBe(29);
    expect(steps).toHaveLength(30);
    steps.forEach((s, k) => {
      expect(s.from).toBe(k);
      expect(s.logCycles).toBe(k + 1);
      expect(s.fee).toBe(7n * BigInt(k + 1));
      // Both ends of the step really cost this much.
      expect(computeFee(1n << BigInt(k), 7n).fee).toBe(s.fee);
      if (k < MAX_LOG) expect(computeFee((1n << BigInt(k + 1)) - 1n, 7n).fee).toBe(s.fee);
    });
    expect(steps.at(-1)).toMatchObject({ from: 29, to: 29, fee: 7n * 30n });
    expect(steps[16]).toMatchObject({ from: 16, to: 17, fee: computeFee(100_000n, 7n).fee });
  });
  it("is flat at zero for a zero base fee", () => {
    expect(feeSteps(0n).every((s) => s.fee === 0n)).toBe(true);
  });
});

describe("log2 helpers", () => {
  it("is exact at powers of two and monotonic between them", () => {
    for (let k = 0; k <= MAX_LOG; k++) expect(log2Cycles(1n << BigInt(k))).toBe(k);
    const x = log2Cycles(100_000n);
    expect(x).toBeGreaterThan(16);
    expect(x).toBeLessThan(17);
  });
  it("maps x back to cycles, clamped to the kernel range", () => {
    expect(cyclesAtLog(-3)).toBe(1n);
    expect(cyclesAtLog(0)).toBe(1n);
    expect(cyclesAtLog(Number.NaN)).toBe(1n);
    expect(cyclesAtLog(10)).toBe(1024n);
    expect(cyclesAtLog(29)).toBe(MAX_TX_CYCLES);
    expect(cyclesAtLog(40)).toBe(MAX_TX_CYCLES);
    // The point under any x sits on the step drawn there.
    for (const xv of [0.5, 3.2, 16.6, 28.99]) {
      expect(computeFee(cyclesAtLog(xv), 1n).logCycles).toBe(Math.floor(xv) + 1);
    }
  });
});

describe("geometry", () => {
  it("draws a staircase: one tread per step, risers in between", () => {
    const x = linear(0, MAX_LOG, 0, 290);
    const y = linear(0, 30, 300, 0);
    const d = stepPath(feeSteps(1n), x, y);
    expect(d.startsWith("M0.00,290.00H10.00")).toBe(true);
    expect(d.match(/H/g)).toHaveLength(30);
    expect(d.match(/V/g)).toHaveLength(29);
    expect(d.endsWith("V0.00H290.00")).toBe(true);
  });
  it("scales linearly and tolerates an empty domain", () => {
    expect(linear(0, 10, 100, 200)(5)).toBe(150);
    expect(linear(0, 0, 4, 9)(3)).toBe(4);
  });
  it("labels the axes", () => {
    expect(X_TICKS).toEqual([0, 5, 10, 15, 20, 25, 29]);
    expect(yTicks(7n)).toEqual([0n, 70n, 140n, 210n]);
    expect(yTicks(0n)).toEqual([0n]);
    expect(formatCompact(9_999)).toBe("9,999");
    expect(formatCompact(43_000)).toBe("43K");
    expect(formatCompact(128_849_018_850n)).toBe("128.8B");
  });
});
