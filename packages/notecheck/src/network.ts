import { Endpoint, NetworkId } from "@miden-sdk/miden-sdk";

export type Network = "testnet" | "devnet" | "mainnet";

export const NETWORKS: Network[] = ["testnet", "devnet", "mainnet"];

/** Bech32 human-readable part per network. */
export const HRP: Record<Network, string> = {
  mainnet: "mm",
  testnet: "mtst",
  devnet: "mdev",
};

export function networkId(network: Network): NetworkId {
  switch (network) {
    case "mainnet": return NetworkId.mainnet();
    case "testnet": return NetworkId.testnet();
    case "devnet": return NetworkId.devnet();
  }
}

/** Mainnet node (the SDK has no preset for it yet; rpc.cedar.miden.io is the same node). */
export const MAINNET_RPC_URL = "https://rpc.mainnet.miden.io";

export function endpoint(network: Network): Endpoint {
  switch (network) {
    case "testnet": return Endpoint.testnet();
    case "devnet": return Endpoint.devnet();
    case "mainnet": return new Endpoint(MAINNET_RPC_URL);
  }
}

/** Network named by a bech32 string's prefix, or null for an unknown/custom prefix. */
export function networkFromHrp(hrp: string): Network | null {
  const hit = NETWORKS.find((n) => HRP[n] === hrp.toLowerCase());
  return hit ?? null;
}

/** Network of a bech32 address (`mm1…`, `mtst1…`), or null for hex or an unknown prefix. */
export function addressNetwork(address: string): Network | null {
  const sep = address.lastIndexOf("1");
  return sep > 0 ? networkFromHrp(address.slice(0, sep)) : null;
}
