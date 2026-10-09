import type { NoteSummary } from "./inspect.js";

/** Chain tip at check time; `time` is unix seconds. */
export type Tip = { block: number; time: number };

export type FundsStatus = {
  /** True only when the funds can no longer go anywhere but the recipient, or already did. */
  confirmed: boolean;
  /** Who ended up with the funds, as far as the chain shows. */
  received: "yes" | "maybe" | "no";
  /** P2IDE with reclaim enabled: first block from which the reclaimer may take the funds back. */
  reclaimFrom: number | null;
};

/**
 * What the chain says about where the funds of a committed note went. P2ID and P2IDE without
 * reclaim can only be consumed by the target. A reclaimable P2IDE note can also be consumed by
 * the reclaimer from max(reclaimHeight, timelockHeight) on, and the chain doesn't say which
 * account consumed it. `tip` matters only for P2IDE; null (couldn't be read) is treated as the
 * worst case.
 */
export function fundsStatus(
  summary: Pick<NoteSummary, "kind" | "reclaimHeight" | "timelockHeight">,
  spentAt: number | null,
  tip: Tip | null,
): FundsStatus {
  const reclaimFrom = summary.kind === "P2IDE" && summary.reclaimHeight !== null
    ? Math.max(summary.reclaimHeight, summary.timelockHeight ?? 0)
    : null;
  if (spentAt !== null) {
    if (reclaimFrom === null || spentAt < reclaimFrom) return { confirmed: true, received: "yes", reclaimFrom };
    return { confirmed: false, received: "maybe", reclaimFrom };
  }
  if (reclaimFrom === null) return { confirmed: true, received: "no", reclaimFrom };
  if (!tip || tip.block >= reclaimFrom) return { confirmed: false, received: "no", reclaimFrom };
  return { confirmed: true, received: "no", reclaimFrom };
}

/** Errors worth one automatic retry: timeouts, dropped connections and 5xx-like replies. */
export function isTransient(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /time(d)?\s?out|failed to fetch|fetch failed|network\s?error|load failed|unavailable|bad gateway|ECONNRESET|\b50[234]\b/i.test(m);
}
