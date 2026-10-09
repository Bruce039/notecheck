import { AccountInterface, Address } from "@miden-sdk/miden-sdk";
import { NETWORKS, networkId, parseAccountId, release, type AccountInput, type Network } from "notecheck";

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
  input: AccountInput;
  /** Plain bech32 address per network. */
  bech32: Record<Network, string>;
  /** Bech32 address with the BasicWallet interface suffix, per network. */
  bech32Wallet: Record<Network, string>;
};

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
