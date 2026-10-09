import { AccountId, BasicFungibleFaucetComponent } from "@miden-sdk/miden-sdk";
import { HRP, type Network } from "./network.js";
import { withRpc } from "./rpc.js";
import { release } from "./wasm.js";

export type TokenInfo = {
  symbol: string;
  decimals: number;
  name?: string;
  source: "token-list" | "chain";
  /**
   * True for tokens in the official list and for the network's own fee token. Anyone can
   * deploy a faucet named "USDCX" with any decimals, so on-chain metadata alone is not trusted.
   */
  verified: boolean;
};

/**
 * Each network's native fee faucet. It is not in the token list (wallets treat it as verified
 * by default), so it is pinned here. A testnet reset changes it; until this is updated the
 * token simply shows as unverified, which is the safe failure.
 */
export const FEE_FAUCETS: Partial<Record<Network, string>> = {
  testnet: "0x4cbdcaffe75f0a317482224dae6436",
};

/** Same URL the Miden wallet reads; served with `Access-Control-Allow-Origin: *`. */
export function tokenListUrl(network: Network): string {
  return `https://raw.githubusercontent.com/0xMiden/token-list/main/${network}.json`;
}

const MAX_DECIMALS = 18;
const SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
const FETCH_TIMEOUT_MS = 10_000;

function validDecimals(d: unknown): d is number {
  return typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= MAX_DECIMALS;
}

function cleanName(n: unknown): string | undefined {
  if (typeof n !== "string") return undefined;
  // Drop control and bidi-override characters; the name is rendered as text.
  const s = n.replace(/[\p{Cc}‎‏‪-‮⁦-⁩]/gu, "").trim();
  return s.length > 0 && s.length <= 60 ? s : undefined;
}

/** Lowercase 0x hex of a valid account ID, or null. */
function normalizeHex(hex: string): string | null {
  let id: AccountId | undefined;
  try {
    id = AccountId.fromHex(hex.trim().toLowerCase());
    return id.toString().toLowerCase();
  } catch {
    return null;
  } finally {
    release(id);
  }
}

/**
 * Parses a token-list document (tokenlists.org shape with `network` and bech32
 * `faucetId`). Entries that are malformed, belong to another network or repeat
 * a faucet ID are skipped. Keys are lowercase 0x hex account IDs.
 */
export function parseTokenList(json: unknown, network: Network): Map<string, TokenInfo> {
  const out = new Map<string, TokenInfo>();
  const tokens = (json as { tokens?: unknown } | null)?.tokens;
  if (!Array.isArray(tokens)) return out;
  const prefix = `${HRP[network]}1`;
  const seen = new Set<string>();
  for (const t of tokens.slice(0, 10_000)) {
    if (typeof t !== "object" || t === null) continue;
    const { network: net, faucetId, symbol, decimals, name } = t as Record<string, unknown>;
    if (net !== network) continue;
    if (typeof faucetId !== "string" || !faucetId.startsWith(prefix) || faucetId.length > 100) continue;
    if (typeof symbol !== "string" || !SYMBOL_RE.test(symbol)) continue;
    if (!validDecimals(decimals)) continue;
    let id: AccountId | undefined;
    let hex: string;
    try {
      id = AccountId.fromBech32(faucetId);
      hex = id.toString().toLowerCase();
    } catch {
      continue;
    } finally {
      release(id);
    }
    if (seen.has(hex)) {
      // Conflicting duplicates make the entry untrustworthy.
      out.delete(hex);
      continue;
    }
    seen.add(hex);
    const info: TokenInfo = { symbol, decimals, source: "token-list", verified: true };
    const n = cleanName(name);
    if (n !== undefined) info.name = n;
    out.set(hex, info);
  }
  return out;
}

const lists = new Map<Network, Promise<Map<string, TokenInfo>>>();

/** The network's token list. A 404 means no list (empty, cached); other failures reject and are not cached. */
function tokenList(network: Network): Promise<Map<string, TokenInfo>> {
  let p = lists.get(network);
  if (!p) {
    p = (async () => {
      const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined;
      const res = await fetch(tokenListUrl(network), { signal });
      if (res.status === 404) return new Map<string, TokenInfo>();
      if (!res.ok) throw new Error(`token list: HTTP ${res.status}`);
      return parseTokenList(await res.json(), network);
    })();
    lists.set(network, p);
    p.catch(() => {
      if (lists.get(network) === p) lists.delete(network);
    });
  }
  return p;
}

/**
 * Reads the fungible-faucet metadata of a public faucet over RPC.
 * Returns null when the account is private or is not a fungible faucet; RPC
 * errors (including "account not found") reject.
 */
async function chainInfo(network: Network, hex: string): Promise<TokenInfo | null> {
  return withRpc(network, async (rpc) => {
    const id = AccountId.fromHex(hex);
    try {
      if (!id.isPublic()) return null;
      const fetched = await rpc.getAccountDetails(id); // borrows `id`
      const account = fetched.account();
      release(fetched);
      if (!account) return null;
      let faucet: BasicFungibleFaucetComponent;
      try {
        faucet = BasicFungibleFaucetComponent.fromAccount(account); // consumes `account`
      } catch {
        return null;
      }
      try {
        const sym = faucet.symbol();
        const symbol = sym.toString();
        release(sym);
        const decimals = faucet.decimals();
        const name = cleanName(faucet.tokenName());
        if (!SYMBOL_RE.test(symbol) || !validDecimals(decimals)) return null;
        const info: TokenInfo = { symbol, decimals, source: "chain", verified: FEE_FAUCETS[network] === hex };
        if (name !== undefined) info.name = name;
        return info;
      } finally {
        release(faucet);
      }
    } finally {
      release(id);
    }
  });
}

const cache = new Map<string, Promise<TokenInfo | null>>();

async function resolve(network: Network, hex: string): Promise<{ info: TokenInfo | null; final: boolean }> {
  let final = true;
  try {
    const hit = (await tokenList(network)).get(hex);
    if (hit) return { info: hit, final: true };
  } catch {
    final = false;
  }
  if (network === "mainnet") return { info: null, final }; // no public RPC yet
  try {
    const info = await chainInfo(network, hex);
    // A chain hit is still revisited when the list failed, since the list takes precedence.
    return { info, final };
  } catch {
    return { info: null, final: false };
  }
}

/**
 * Symbol and decimals for a fungible faucet: the official token list first,
 * then on-chain metadata for public faucets. Returns null when unknown or on
 * error; errors are not cached, so a later call retries.
 */
export function tokenInfo(network: Network, faucetIdHex: string): Promise<TokenInfo | null> {
  const hex = normalizeHex(faucetIdHex);
  if (!hex) return Promise.resolve(null);
  const key = `${network}:${hex}`;
  let p = cache.get(key);
  if (!p) {
    const r = resolve(network, hex);
    p = r.then((x) => x.info);
    cache.set(key, p);
    const mine = p;
    void r.then((x) => {
      if (!x.final && cache.get(key) === mine) cache.delete(key);
    });
  }
  return p;
}

/**
 * Formats base units as a decimal string without floating point:
 * `formatAmount(1500000n, 6)` is "1.5", `formatAmount(1234500n, 3)` is "1,234.5".
 */
export function formatAmount(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const int = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = decimals === 0 ? "" : (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** Decimal string → base units, exact. "1.5", 6 → 1500000n. */
export function parseAmount(input: string, decimals: number): bigint {
  const s = input.trim().replace(/[_,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter an amount like 12.5");
  const [int, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places.`);
  return BigInt(int + frac.padEnd(decimals, "0"));
}
