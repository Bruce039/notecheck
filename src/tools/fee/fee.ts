import { parseUint } from "@/tools/felt/felt";

/**
 * Transaction fee, miden-protocol v0.17.1:
 *   fee = verification_base_fee × (ilog2(total_cycles) + 1)
 * crates/miden-protocol/src/transaction/fee.rs:54 (ilog2 + 1) and :89-90 (u64 product),
 * mirroring `compute_fee` in asm/kernels/transaction-core/src/tx.masm:327-333.
 * The output-notes term is hardcoded to zero there, so it is left out.
 */

/** ExecutionOptions::MAX_CYCLES = 2^29 (MAX_TX_EXECUTION_CYCLES, constants.rs:30; tx.masm:23). */
export const MAX_TX_CYCLES = 1n << 29n;
/** FeeParameters stores the base fee as a u32. */
export const MAX_BASE_FEE = 2n ** 32n - 1n;

export type FeeResult = {
  cycles: bigint;
  baseFee: bigint;
  /** ilog2(cycles) + 1. */
  logCycles: number;
  fee: bigint;
  /** Cycle range charged the same fee, inclusive. */
  stepMin: bigint;
  stepMax: bigint;
  /** First cycle count with a higher fee, or null at the kernel maximum. */
  nextStep: bigint | null;
  cyclesUntilNext: bigint | null;
};

export function parseCycles(input: string): bigint {
  const v = parseUint(input);
  if (v === 0n) throw new Error("A transaction runs at least one cycle (the kernel rejects 0).");
  if (v > MAX_TX_CYCLES) throw new Error(`Above the transaction limit of ${MAX_TX_CYCLES} cycles (2^29).`);
  return v;
}

export function parseBaseFee(input: string): bigint {
  const v = parseUint(input);
  if (v > MAX_BASE_FEE) throw new Error("The base fee is a u32 (at most 4294967295).");
  return v;
}

/** ilog2(cycles) + 1, i.e. the bit length of `cycles`. */
export function logVerificationCycles(cycles: bigint): number {
  if (cycles < 1n || cycles > MAX_TX_CYCLES) throw new Error("Cycles out of range.");
  return cycles.toString(2).length;
}

export function computeFee(cycles: bigint, baseFee: bigint): FeeResult {
  if (baseFee < 0n || baseFee > MAX_BASE_FEE) throw new Error("Base fee out of range.");
  const logCycles = logVerificationCycles(cycles);
  const stepMin = 1n << BigInt(logCycles - 1);
  const next = 1n << BigInt(logCycles);
  const nextStep = next > MAX_TX_CYCLES ? null : next;
  return {
    cycles,
    baseFee,
    logCycles,
    fee: baseFee * BigInt(logCycles),
    stepMin,
    stepMax: nextStep === null ? MAX_TX_CYCLES : next - 1n,
    nextStep,
    cyclesUntilNext: nextStep === null ? null : nextStep - cycles,
  };
}
