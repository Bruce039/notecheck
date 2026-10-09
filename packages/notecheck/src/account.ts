import { AccountId, Address } from "@miden-sdk/miden-sdk";
import { HRP, networkFromHrp, networkId, type Network } from "./network.js";
import { release } from "./wasm.js";

/** Where a parsed account ID came from. */
export type AccountInput =
  | { kind: "hex" }
  | { kind: "bech32"; hrp: string; network: Network | null; hasInterface: boolean };

/**
 * Parses a 0x-hex account ID or a bech32 address (with or without its `_…` routing suffix).
 * The caller owns the returned AccountId and must release it.
 */
export function parseAccountId(raw: string): { id: AccountId; input: AccountInput } {
  const s = raw.trim();
  if (!s) throw new Error("Enter an account ID or address.");
  if (/^0x/i.test(s)) {
    if (!/^0x[0-9a-f]{30}$/i.test(s)) {
      throw new Error("Hex account IDs are 0x + 30 hex chars (15 bytes).");
    }
    return { id: AccountId.fromHex(s.toLowerCase()), input: { kind: "hex" } };
  }
  // The `_…` routing suffix carries the interface/tag hints, not the ID. Some wallet-issued
  // suffixes fail to decode ("invalid note tag length"), so, like the wallet, parse without it.
  const [body] = s.split("_");
  const sep = body.lastIndexOf("1");
  if (sep <= 0) throw new Error("Not a 0x-hex ID or a bech32 address.");
  const hrp = body.slice(0, sep).toLowerCase();
  const hasInterface = s.includes("_");
  const address = Address.fromBech32(body);
  try {
    return {
      id: address.accountId(),
      input: { kind: "bech32", hrp, network: networkFromHrp(hrp), hasInterface },
    };
  } finally { release(address); }
}

/** Plain bech32 address for a 0x account ID on `network`; falls back to the hex on error. */
export function toBech32(hex: string, network: Network): string {
  try {
    const id = AccountId.fromHex(hex);
    const address = Address.fromAccountId(id);
    // toBech32 consumes the NetworkId it is given.
    const out = address.toBech32(networkId(network));
    release(address, id);
    return out;
  } catch {
    return hex;
  }
}

/** Canonical 0x hex for an address or ID; throws a readable error on bad input. */
export function normalizeAccountId(raw: string): string {
  const { id } = parseAccountId(raw);
  const hex = id.toString();
  release(id);
  return hex;
}

/**
 * Lowercase 0x hex of an address or ID meant for `network`. Bech32 input from another
 * network is refused; hex input has no network and is accepted.
 */
export function accountOnNetwork(raw: string, network: Network, what = "address"): string {
  const { id, input } = parseAccountId(raw);
  const hex = id.toString().toLowerCase();
  release(id);
  if (input.kind === "bech32" && input.hrp !== HRP[network]) {
    throw new Error(`This ${what} is for ${input.network ?? input.hrp} (${input.hrp}1…), not ${network} (${HRP[network]}1…).`);
  }
  return hex;
}
