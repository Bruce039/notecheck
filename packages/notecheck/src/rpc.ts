import { RpcClient } from "@miden-sdk/miden-sdk";
import { endpoint, type Network } from "./network.js";

const clients = new Map<Network, RpcClient>();
const queues = new Map<Network, Promise<unknown>>();

/** One RpcClient per network, created on first use. Throws for mainnet (no public RPC yet). */
export function rpcClient(network: Network): RpcClient {
  let c = clients.get(network);
  if (!c) {
    c = new RpcClient(endpoint(network));
    clients.set(network, c);
  }
  return c;
}

/**
 * Runs `fn` with the network's RpcClient after every earlier call on that network
 * has settled. The WASM client is single-threaded, so calls must not overlap.
 */
export function withRpc<T>(network: Network, fn: (rpc: RpcClient) => Promise<T>): Promise<T> {
  const prev = queues.get(network) ?? Promise.resolve();
  const next = prev.then(() => fn(rpcClient(network)));
  queues.set(network, next.catch(() => undefined));
  return next;
}
