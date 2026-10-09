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

export function endpoint(network: Network): Endpoint {
  switch (network) {
    case "testnet": return Endpoint.testnet();
    case "devnet": return Endpoint.devnet();
    case "mainnet": throw new Error("Mainnet RPC is not public yet.");
  }
}

/** Network named by a bech32 string's prefix, or null for an unknown/custom prefix. */
export function networkFromHrp(hrp: string): Network | null {
  const hit = NETWORKS.find((n) => HRP[n] === hrp.toLowerCase());
  return hit ?? null;
}
