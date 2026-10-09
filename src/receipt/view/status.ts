import { fundsStatus, toBech32, type Network, type Tip, type Verification } from "notecheck";

export type { Tip };

export type Included = Extract<Verification, { status: "included" }>;

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
 * The receipt page's wording for what the chain says about where the funds went; the decision
 * itself is `fundsStatus` from the package. `tip` is needed only for P2IDE.
 */
export function assess(r: Included, tip: Tip | null, network: Network): Assessment {
  const s = r.summary;
  const funds = fundsStatus(s, r.spentAt, tip);
  const { received, reclaimFrom: unlock } = funds;
  const verdict = funds.confirmed ? "good" : "warn";
  const otherReclaimer = s.reclaimer !== null && s.reclaimer !== s.sender;
  const who = otherReclaimer ? `account ${toBech32(s.reclaimer!, network)}` : "the sender";
  const whoShort = otherReclaimer ? "another account" : "the sender";
  const confirmed = "Payment confirmed on the Miden network";
  const extra: string[] = [];

  if (r.spentAt !== null) {
    if (unlock === null) {
      return {
        verdict, headline: confirmed, extra, received,
        status: { tone: "good", lead: "✓ Received", rest: "the recipient has claimed the funds" },
      };
    }
    if (funds.confirmed) {
      return {
        verdict, headline: confirmed, extra, received,
        status: { tone: "good", lead: "✓ Received by the recipient", rest: `claimed before ${whoShort} could take it back` },
      };
    }
    return {
      verdict, headline: `Payment committed — it may have gone back to ${whoShort}`, extra, received,
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
    return { verdict, headline: confirmed, status: waiting, extra, received };
  }
  if (!tip) {
    extra.push(`From block ${block(unlock)}, ${who} can take it back while it is unclaimed. The current block couldn't be read, so this may already be possible.`);
    return { verdict, headline: `Payment committed — ${whoShort} may be able to take it back`, status: { ...waiting, tone: "warn" }, extra, received };
  }
  if (!funds.confirmed) {
    return {
      verdict, headline: `Payment committed — ${whoShort} can still take it back`, extra, received,
      status: { tone: "warn", lead: "Not claimed yet", rest: `${who} can take it back now (since block ${block(unlock)}), until the recipient claims it` },
    };
  }
  extra.push(`If it is still unclaimed at ${blockWithEstimate(unlock, tip)}, ${who} can take it back.`);
  return { verdict, headline: confirmed, status: waiting, extra, received };
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

/** The verifier's mismatch reason without account IDs, which the mismatch view doesn't show. */
export function mismatchReason(reason: string): string {
  return reason
    .split("; ")
    .map((part) => (part.startsWith("sender is ") ? "the sender account on chain is not the one in the link" : part))
    .join("; ");
}
