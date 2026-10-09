import type { AccountId } from "@miden-sdk/miden-sdk";
import { parseAccountId } from "@/tools/address/account";
import { release } from "@/lib/wasm";

/** The part of RpcClient this check needs; injectable for tests. */
export type AllowlistRpc = {
  isAccountAllowed(id: AccountId): Promise<boolean>;
  isInvitationCodeValid(code: string): Promise<boolean>;
};

export type AllowlistResult = { hex: string; allowed: boolean };

/**
 * Asks the node whether the account may be created. `true` also when the node
 * enforces no allowlist; existing accounts are never gated, so it says nothing about them.
 */
export async function checkAccountAllowed(rpc: Pick<AllowlistRpc, "isAccountAllowed">, raw: string): Promise<AllowlistResult> {
  const { id } = parseAccountId(raw);
  try {
    const hex = id.toString();
    return { hex, allowed: await rpc.isAccountAllowed(id) };
  } finally { release(id); }
}

export const MAX_CODE_LENGTH = 128;

/**
 * Asks the node whether an invite code can still be used to register an account. The query
 * doesn't consume the code (registerAccount would, and is never called here). `true` also when
 * the node enforces no allowlist.
 */
export async function checkInvitationCode(rpc: Pick<AllowlistRpc, "isInvitationCodeValid">, raw: string): Promise<boolean> {
  const code = raw.trim();
  if (!code) throw new Error("Enter an invite code.");
  if (code.length > MAX_CODE_LENGTH || /[\s\p{Cc}]/u.test(code)) {
    throw new Error("That doesn't look like an invite code (no spaces, up to 128 characters).");
  }
  try {
    return await rpc.isInvitationCodeValid(code);
  } catch (e) {
    // Nodes older than the allowlist release answer "not implemented".
    if (e instanceof Error && /not implemented|not supported/i.test(e.message)) throw new UnsupportedError();
    throw e;
  }
}

export class UnsupportedError extends Error {
  constructor() { super("This node doesn't support invite-code checks yet."); }
}
