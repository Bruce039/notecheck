import type { Network } from "@/lib/network";
import { toBech32 } from "@/tools/address/account";
import type { Verification } from "../verify";

export type Included = Extract<Verification, { status: "included" }>;

/** Chain tip at check time; `time` is unix seconds. */
export type Tip = { block: number; time: number };

/** Rough block interval, used only for labelled estimates. */
export const SECONDS_PER_BLOCK = 3;

export type Assessment = {
  /** "good" only when the funds can no longer go anywhere but the recipient, or already did. */
  verdict: "good" | "warn";
  headline: string;
  status: { tone: "good" | "neutral" | "warn"; lead: string; rest?: string };
  /** Plain-language follow-ups for the status row (timelock, reclaim window). */
  extra: string[];
  /** Who ended up with the funds, as far as the chain shows. */
  received: "yes" | "maybe" | "no";
};

export const block = (n: number) => n.toLocaleString("en-US");

const DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };

/** Block timestamp (unix seconds) as "9 Oct 2026, 12:24 UTC". */
export const fmtUtc = (unix: number) =>
  new Date(unix * 1000).toLocaleString("en-GB", { ...DATE, timeZone: "UTC" }) + " UTC";

/** A moment in the reader's own time zone, e.g. for "checked at". */
export const fmtLocal = (d: Date) => d.toLocaleString("en-GB", { ...DATE, timeZoneName: "short" });

/** "block N (≈ date, estimate)" when the tip is known, else "block N". */
export function blockWithEstimate(n: number, tip: Tip | null): string {
  if (!tip || n <= tip.block) return `block ${block(n)}`;
  return `block ${block(n)} (≈ ${fmtUtc(tip.time + (n - tip.block) * SECONDS_PER_BLOCK)}, an estimate)`;
}

/**
 * What the chain says about where the funds went. P2ID and P2IDE without reclaim can only be
 * consumed by the target. A reclaimable P2IDE note can also be consumed by the reclaimer from
 * max(reclaimHeight, timelockHeight) on, and the chain doesn't say which account consumed it.
 * `tip` is needed only for P2IDE; null means it couldn't be read, which is treated as the worst case.
 */
export function assess(r: Included, tip: Tip | null, network: Network): Assessment {
  const s = r.summary;
  const spent = r.spentAt !== null;
  const otherReclaimer = s.reclaimer !== null && s.reclaimer !== s.sender;
  const who = otherReclaimer ? `account ${toBech32(s.reclaimer!, network)}` : "the sender";
  const whoShort = otherReclaimer ? "another account" : "the sender";
  const unlock = s.kind === "P2IDE" && s.reclaimHeight !== null
    ? Math.max(s.reclaimHeight, s.timelockHeight ?? 0)
    : null;
  const confirmed = "Payment confirmed on the Miden network";
  const extra: string[] = [];

  if (spent) {
    if (unlock === null) {
      return {
        verdict: "good", headline: confirmed, extra, received: "yes",
        status: { tone: "good", lead: "✓ Received", rest: "the recipient has claimed the funds" },
      };
    }
    if (r.spentAt! < unlock) {
      return {
        verdict: "good", headline: confirmed, extra, received: "yes",
        status: { tone: "good", lead: "✓ Received by the recipient", rest: `claimed before ${whoShort} could take it back` },
      };
    }
    return {
      verdict: "warn", headline: `Payment committed — it may have gone back to ${whoShort}`, extra, received: "maybe",
      status: {
        tone: "warn",
        lead: "Claimed — by the recipient, or returned to the sender",
        rest: `${who} could take it back from block ${block(unlock)}, and the chain doesn't show which account claimed it`,
      },
    };
  }

  const waiting = { tone: "neutral" as const, lead: "Waiting for the recipient to claim" };
  if (s.kind === "P2IDE" && s.timelockHeight !== null && (!tip || tip.block < s.timelockHeight)) {
    extra.push(`The recipient can claim it only from ${blockWithEstimate(s.timelockHeight, tip)}.`);
  }
  if (unlock === null) {
    return { verdict: "good", headline: confirmed, status: waiting, extra, received: "no" };
  }
  if (!tip) {
    extra.push(`From block ${block(unlock)}, ${who} can take it back while it is unclaimed. The current block couldn't be read, so this may already be possible.`);
    return { verdict: "warn", headline: `Payment committed — ${whoShort} may be able to take it back`, status: { ...waiting, tone: "warn" }, extra, received: "no" };
  }
  if (tip.block >= unlock) {
    return {
      verdict: "warn", headline: `Payment committed — ${whoShort} can still take it back`, extra, received: "no",
      status: { tone: "warn", lead: "Not claimed yet", rest: `${who} can take it back now (since block ${block(unlock)}), until the recipient claims it` },
    };
  }
  extra.push(`If it is still unclaimed at ${blockWithEstimate(unlock, tip)}, ${who} can take it back.`);
  return { verdict: "good", headline: confirmed, status: waiting, extra, received: "no" };
}

const LEADING_MARKS = /^[\s✓✔☑✅✕✗✘☒❌✖]+/u;

/**
 * The sender's memo for display: line breaks become spaces, control and format characters
 * (bidi overrides and isolates, zero-width characters) are removed, and leading check or
 * cross marks are dropped so the memo can't imitate a verdict.
 */
export function cleanMemo(memo: string): string {
  return memo
    .replace(/[\t\n\r\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(LEADING_MARKS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Errors worth one automatic retry: timeouts, dropped connections and 5xx-like replies. */
export function isTransient(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /time(d)?\s?out|failed to fetch|fetch failed|network\s?error|load failed|unavailable|bad gateway|ECONNRESET|\b50[234]\b/i.test(m);
}

/** The verifier's mismatch reason without account IDs, which the mismatch view doesn't show. */
export function mismatchReason(reason: string): string {
  return reason
    .split("; ")
    .map((part) => (part.startsWith("sender is ") ? "the sender account on chain is not the one in the link" : part))
    .join("; ");
}
