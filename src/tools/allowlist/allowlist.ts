import type { AccountId } from "@miden-sdk/miden-sdk";
import { parseAccountId } from "@/tools/address/account";
import { release } from "@/lib/wasm";

/** The part of RpcClient this check needs; injectable for tests. */
export type AllowlistRpc = { isAccountAllowed(id: AccountId): Promise<boolean> };

export type AllowlistResult = { hex: string; allowed: boolean };

/**
 * Asks the node whether the account may be created. `true` also when the node
 * enforces no allowlist; existing accounts are never gated, so it says nothing about them.
 */
export async function checkAccountAllowed(rpc: AllowlistRpc, raw: string): Promise<AllowlistResult> {
  const { id } = parseAccountId(raw);
  try {
    const hex = id.toString();
    return { hex, allowed: await rpc.isAccountAllowed(id) };
  } finally { release(id); }
}
