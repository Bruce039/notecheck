import { AccountId, AccountInterface, Address } from "@miden-sdk/miden-sdk";
import { NETWORKS, networkFromHrp, networkId, type Network } from "@/lib/network";
import { release } from "@/lib/wasm";

/**
 * Account ID layout (miden-protocol v0.17, ID version 1):
 *   prefix: [hash (58 bits) | asset callback flag (1) | account type (1) | version (4)]
 *   suffix: [zero bit | hash (55 bits) | 8 zero bits]
 * Account type is only public/private now; faucet vs. wallet is not in the ID.
 */
export type AccountInfo = {
  hex: string;
  prefix: bigint;
  suffix: bigint;
  version: number;
  visibility: "public" | "private";
  assetCallbacks: boolean;
  /** Where the input came from. */
  input: { kind: "hex" } | { kind: "bech32"; hrp: string; network: Network | null; hasInterface: boolean };
  /** Plain bech32 address per network. */
  bech32: Record<Network, string>;
  /** Bech32 address with the BasicWallet interface suffix, per network. */
  bech32Wallet: Record<Network, string>;
};

export function parseAccountId(raw: string): { id: AccountId; input: AccountInfo["input"] } {
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

export function decodeAccount(raw: string): AccountInfo {
  const { id, input } = parseAccountId(raw);
  try {
    const prefix = id.prefix().asInt();
    const suffix = id.suffix().asInt();
    const meta = Number(prefix & 0xffn);
    const bech32 = {} as Record<Network, string>;
    const bech32Wallet = {} as Record<Network, string>;
    for (const n of NETWORKS) {
      const address = Address.fromAccountId(id);
      bech32[n] = address.toBech32(networkId(n));
      release(address);
      bech32Wallet[n] = id.toBech32(networkId(n), AccountInterface.BasicWallet);
    }
    return {
      hex: id.toString(),
      prefix,
      suffix,
      version: meta & 0b1111,
      visibility: (meta >> 4) & 1 ? "public" : "private",
      assetCallbacks: ((meta >> 5) & 1) === 1,
      input,
      bech32,
      bech32Wallet,
    };
  } finally { release(id); }
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
