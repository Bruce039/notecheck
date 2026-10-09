import type { Network } from "./network";

// Midenscan routes: /tx/<id>, /note/<id>, /account/<id or bech32>, /block/<number>.
// Mainnet has no public explorer yet.
const BASES: Partial<Record<Network, string>> = {
  testnet: "https://testnet.midenscan.com",
  devnet: "https://devnet.midenscan.com",
};

export type ExplorerKind = "tx" | "note" | "account" | "block";

const VALID: Record<ExplorerKind, RegExp> = {
  tx: /^0x[0-9a-f]{64}$/i,
  note: /^0x[0-9a-f]{64}$/i,
  account: /^(0x[0-9a-f]{30}|[a-z]{2,8}1[02-9ac-hj-np-z]+)$/i,
  block: /^\d{1,10}$/,
};

/** Link to the item on the network's explorer, or null when there is none or the id is malformed. */
export function explorerUrl(network: Network, kind: ExplorerKind, id: string | number): string | null {
  const base = BASES[network];
  const value = String(id).trim();
  if (!base || !VALID[kind].test(value)) return null;
  return `${base}/${kind}/${encodeURIComponent(value)}`;
}

export const EXPLORER_NAME = "Midenscan";
