// @vitest-environment node
import { MAX_BASE_FEE, MAX_TX_CYCLES, computeFee, logVerificationCycles, parseBaseFee, parseCycles } from "./fee";

describe("logVerificationCycles", () => {
  // miden-protocol v0.17.1, transaction/fee.rs `log_verification_cycles_formula`
  it("matches the protocol test vectors", () => {
    expect(logVerificationCycles(1n)).toBe(1);
    expect(logVerificationCycles(2n)).toBe(2);
    expect(logVerificationCycles(3n)).toBe(2);
    expect(logVerificationCycles(4n)).toBe(3);
    expect(logVerificationCycles(65_536n)).toBe(17);
    expect(logVerificationCycles(MAX_TX_CYCLES)).toBe(30);
  });
  it("steps up exactly at powers of two", () => {
    for (let k = 1n; k <= 29n; k++) {
      expect(logVerificationCycles(1n << k)).toBe(Number(k) + 1);
      expect(logVerificationCycles((1n << k) - 1n)).toBe(Number(k));
    }
  });
  it("rejects 0 and cycles above the kernel maximum", () => {
    expect(() => logVerificationCycles(0n)).toThrow();
    expect(() => logVerificationCycles(MAX_TX_CYCLES + 1n)).toThrow();
  });
});

describe("computeFee", () => {
  // fee.rs `compute_fee_does_not_wrap_at_the_maximal_base_fee`
  it("does not wrap at the maximal base fee", () => {
    expect(computeFee(MAX_TX_CYCLES, MAX_BASE_FEE).fee).toBe(MAX_BASE_FEE * 30n);
  });
  // fee.rs `safety_margin_adds_verification_cycles`, without the margin
  it("multiplies the base fee by the log cycles", () => {
    expect(computeFee(1n << 16n, 500n).fee).toBe(500n * 17n);
    expect(computeFee(1n, 7n).fee).toBe(7n);
    expect(computeFee(100_000n, 0n).fee).toBe(0n);
  });
  it("reports the step range and the next threshold", () => {
    const r = computeFee(100_000n, 7n);
    expect(r.logCycles).toBe(17);
    expect(r.stepMin).toBe(65_536n);
    expect(r.stepMax).toBe(131_071n);
    expect(r.nextStep).toBe(131_072n);
    expect(r.cyclesUntilNext).toBe(31_072n);
    const one = computeFee(1n, 1n);
    expect([one.stepMin, one.stepMax, one.nextStep]).toEqual([1n, 1n, 2n]);
    const edge = computeFee((1n << 28n) - 1n, 1n);
    expect(edge.nextStep).toBe(1n << 28n);
    expect(edge.cyclesUntilNext).toBe(1n);
  });
  it("has no next step at the kernel maximum", () => {
    const r = computeFee(MAX_TX_CYCLES, 1n);
    expect([r.stepMin, r.stepMax, r.nextStep, r.cyclesUntilNext]).toEqual([MAX_TX_CYCLES, MAX_TX_CYCLES, null, null]);
  });
  it("rejects an out-of-range base fee", () => {
    expect(() => computeFee(1n, MAX_BASE_FEE + 1n)).toThrow();
    expect(() => computeFee(1n, -1n)).toThrow();
  });
});

describe("parsing", () => {
  it("reads cycles and base fees", () => {
    expect(parseCycles("65_536")).toBe(65_536n);
    expect(parseCycles("0x10000")).toBe(65_536n);
    expect(parseBaseFee("0")).toBe(0n);
    expect(parseBaseFee("4294967295")).toBe(MAX_BASE_FEE);
  });
  it("rejects out-of-range and non-integer input", () => {
    expect(() => parseCycles("0")).toThrow(/at least one cycle/);
    expect(() => parseCycles(String(MAX_TX_CYCLES + 1n))).toThrow(/limit/);
    expect(() => parseCycles("1.5")).toThrow();
    expect(() => parseCycles("-3")).toThrow();
    expect(() => parseBaseFee("4294967296")).toThrow(/u32/);
  });
});
