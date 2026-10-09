import type { Network } from "notecheck";

// --- Pending payments survive a closed tab: the note details exist only here until the receipt is made.

/** A send the wallet accepted. `noteB64` is filled in once the wallet reports the note. */
export type PendingPayment = {
  txId: string;
  network: Network;
  recipient: string;
  faucetId: string;
  amount: string;
  memo?: string;
  noteB64?: string;
  /** On-chain transaction id, as the wallet reports it on completion. */
  chainTxId?: string;
  createdAt: string;
};

const KEY = "pending-payments-v2";

export function loadPending(): PendingPayment[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => typeof p?.txId === "string" && typeof p?.recipient === "string") : [];
  } catch {
    return [];
  }
}

export function savePending(p: PendingPayment): void {
  try {
    const rest = loadPending().filter((x) => x.txId !== p.txId);
    localStorage.setItem(KEY, JSON.stringify([...rest, p]));
  } catch { /* storage unavailable: the flow still works while the tab stays open */ }
}

export function clearPending(txId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadPending().filter((x) => x.txId !== txId)));
  } catch { /* ignore */ }
}

// --- Receipts made in this browser, so a closed tab doesn't lose the link.

export type RecentReceipt = { url: string; createdAt: string; amount: string; recipient: string; network: Network };

const RECENT_KEY = "recent-receipts";
const RECENT_MAX = 20;

export function loadRecent(): RecentReceipt[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((r) => typeof r?.url === "string" && r.url.includes("/r#")) : [];
  } catch {
    return [];
  }
}

export function saveRecent(r: RecentReceipt): void {
  try {
    const rest = loadRecent().filter((x) => x.url !== r.url);
    localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...rest].slice(0, RECENT_MAX)));
  } catch { /* storage unavailable */ }
}

export function removeRecent(url: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecent().filter((x) => x.url !== url)));
  } catch { /* ignore */ }
}
