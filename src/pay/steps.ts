/**
 * The stages a payment goes through, as far as this page can see them. The wallet's own work
 * (building, proving, submitting, delivering the note) is one stage: it reports nothing until
 * it is done.
 */
export const PAY_STEPS = [
  "Confirm in your wallet",
  "Wallet is proving and sending",
  "On chain and delivered to the recipient",
  "Building your receipt",
  "Receipt ready",
] as const;

export const SLOW_AFTER_MS = 90_000;

export const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
