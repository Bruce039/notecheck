import { Note, type RpcClient } from "@miden-sdk/miden-sdk";
import { accountOnNetwork, toBech32 } from "./account.js";
import { toBase64 } from "./bytes.js";
import { explorerUrl } from "./explorer.js";
import { inspectNote, noteFileFromBase64, UnsupportedReceiptError, type NoteSummary } from "./inspect.js";
import type { Network } from "./network.js";
import { receiptIfCommitted, waitForReceipt, type ReceiptRpc } from "./payment.js";
import { decodeReceipt, encodeReceipt, fragmentOf, receiptUrl } from "./receipt.js";
import { encodeRequest, isRequestFragment, requestUrl, validateRequest, type PaymentRequestV1 } from "./request.js";
import { withRpc } from "./rpc.js";
import { fundsStatus, isTransient, type Tip } from "./status.js";
import { FEE_FAUCETS, formatAmount, parseAmount, tokenInfo, type TokenInfo } from "./tokens.js";
import { verifyNoteFile, type Verification, type VerifyRpc } from "./verify.js";
import { bytesOf, release } from "./wasm.js";

/** Where links point unless a `baseUrl` is given. */
export const DEFAULT_BASE_URL = "https://notecheck-miden.vercel.app";

/** Shortest receipt password accepted: anyone with the link can try passwords offline. */
export const MIN_PASSWORD_LENGTH = 8;

/** Token metadata lookup; the default is `tokenInfo` (official token list, then chain). */
export type TokenLookup = (network: Network, faucetId: string) => Promise<TokenInfo | null>;

export type Party = { bech32: string; hex: string };

export type ReceiptAmount = {
  /** Lowercase 0x hex faucet account ID. */
  faucetId: string;
  /** Base units, as a decimal string. */
  amount: string;
  symbol?: string;
  decimals?: number;
  /** `amount` in whole tokens, e.g. "1.5"; present when the decimals are known. */
  formatted?: string;
  /** True for tokens in the official token list and the network's fee token. */
  verified: boolean;
};

/**
 * - `confirmed`: the note is on chain as described, and the funds can only go (or went) to the recipient.
 * - `committed-reclaimable`: on chain, but a P2IDE note whose funds may go, or may have gone, back to the reclaimer.
 * - `not-found`: no note with this ID on chain.
 * - `mismatch`: the note ID is on chain, but with a different sender, tag or note type.
 */
export type ReceiptStatus = "confirmed" | "committed-reclaimable" | "not-found" | "mismatch";

/** Result of `verifyReceipt`; plain JSON (no bigints, dates as ISO strings). */
export type ReceiptCheck = {
  status: ReceiptStatus;
  network: Network;
  noteId: string;
  kind: "P2ID" | "P2IDE";
  visibility: "private" | "public";
  /** Fungible assets in the note. Checked against the chain only when the note was found and matched. */
  amount: ReceiptAmount[];
  /** Number of non-fungible assets, which are not listed. */
  otherAssets: number;
  recipient: Party;
  sender: Party;
  inclusionBlock: number | null;
  inclusionTime: string | null;
  /** Block in which the note was consumed, or null while it is unspent (or not found). */
  spentAt: number | null;
  spentTime: string | null;
  /** Whether the recipient got the funds, as far as the chain shows; null when not on chain. */
  received: "yes" | "maybe" | "no" | null;
  /** P2IDE with reclaim enabled: from this block `by` may take the funds back while unspent. */
  reclaim: { from: number; by: Party } | null;
  /** P2IDE: the recipient can consume the note only from this block. */
  timelockHeight: number | null;
  /** Chain tip read for P2IDE notes; null otherwise or when it couldn't be read. */
  tip: { block: number; time: string } | null;
  /** Why the status is `mismatch`. */
  mismatch?: string;
  /** The sender's own statements in the link. They are not checked against anything. */
  claims: { memo?: string; createdAt?: string; txId?: string };
  explorer: { note: string | null; tx?: string | null };
  checkedAt: string;
};

export type VerifyOptions = {
  /** Needed for `r1e.` links. */
  password?: string;
  /** RPC to use instead of the built-in per-network client. */
  rpc?: VerifyRpc;
  /** Expected network; a receipt for another network is refused. */
  network?: Network;
  /** Token lookup, or false to skip it (amounts then have no symbol). */
  tokens?: TokenLookup | false;
};

const RETRY_DELAY_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (unix: number) => new Date(unix * 1000).toISOString();
const party = (hex: string, network: Network): Party => ({ bech32: toBech32(hex, network), hex });

async function readTip(rpc: VerifyRpc): Promise<Tip | null> {
  try {
    const header = await rpc.getBlockHeaderByNumber();
    try { return { block: header.blockNum(), time: header.timestamp() }; } finally { release(header); }
  } catch {
    return null;
  }
}

/**
 * Decodes a receipt link (or its fragment) and checks it against the network it names: the note ID
 * is recomputed from the note in the link, looked up on chain and its metadata compared, then its
 * nullifier is checked. Throws for links that can't be read (wrong password, damaged link, not a
 * P2ID/P2IDE note) and for RPC errors; a transient RPC error is retried once.
 */
export async function verifyReceipt(linkOrFragment: string, opts: VerifyOptions = {}): Promise<ReceiptCheck> {
  const fragment = fragmentOf(linkOrFragment);
  if (isRequestFragment(fragment)) throw new Error("This is a payment request link, not a receipt.");
  const receipt = await decodeReceipt(fragment, opts.password);
  const network = receipt.network;
  if (opts.network && opts.network !== network) throw new Error(`This receipt is for ${network}, not ${opts.network}.`);
  const bytes = noteFileFromBase64(receipt.noteFile);

  const once = () => {
    const run = async (rpc: VerifyRpc) => {
      const result = await verifyNoteFile(rpc, bytes);
      const tip = result.status === "included" && result.summary.kind === "P2IDE" ? await readTip(rpc) : null;
      return { result, tip };
    };
    return opts.rpc ? run(opts.rpc) : withRpc(network, (rpc: RpcClient) => run(rpc));
  };
  let out: { result: Verification; tip: Tip | null };
  try {
    out = await once();
  } catch (e) {
    if (e instanceof UnsupportedReceiptError || !isTransient(e)) throw e;
    await sleep(RETRY_DELAY_MS);
    out = await once();
  }

  const { result, tip } = out;
  const s = result.summary;
  const lookup = opts.tokens === false ? null : (opts.tokens ?? tokenInfo);
  const tokens = result.status === "included" && lookup
    ? await Promise.all(s.assets.map((a) => lookup(network, a.faucetId).catch(() => null)))
    : s.assets.map(() => null);

  const claims: ReceiptCheck["claims"] = {};
  if (receipt.memo) claims.memo = receipt.memo;
  if (receipt.createdAt) claims.createdAt = receipt.createdAt;
  if (receipt.txId) claims.txId = receipt.txId;

  const base = {
    network,
    noteId: s.noteId,
    kind: s.kind,
    visibility: s.visibility,
    amount: s.assets.map((a, i) => amountOf(a, tokens[i])),
    otherAssets: s.otherAssets,
    recipient: party(s.recipient, network),
    sender: party(s.sender, network),
    timelockHeight: s.timelockHeight,
    claims,
    explorer: explorerLinks(network, s, receipt.txId),
    checkedAt: new Date().toISOString(),
  };
  const reclaimOf = (from: number | null) =>
    from === null || s.reclaimer === null ? null : { from, by: party(s.reclaimer, network) };

  if (result.status !== "included") {
    const p2ideReclaim = s.kind === "P2IDE" && s.reclaimHeight !== null
      ? Math.max(s.reclaimHeight, s.timelockHeight ?? 0)
      : null;
    return {
      status: result.status,
      ...base,
      inclusionBlock: null, inclusionTime: null, spentAt: null, spentTime: null, received: null,
      reclaim: reclaimOf(p2ideReclaim),
      tip: null,
      ...(result.status === "mismatch" ? { mismatch: result.reason } : {}),
    };
  }
  const funds = fundsStatus(s, result.spentAt, tip);
  return {
    status: funds.confirmed ? "confirmed" : "committed-reclaimable",
    ...base,
    inclusionBlock: result.inclusionBlock,
    inclusionTime: iso(result.inclusionTime),
    spentAt: result.spentAt,
    spentTime: result.spentTime === null ? null : iso(result.spentTime),
    received: funds.received,
    reclaim: reclaimOf(funds.reclaimFrom),
    tip: tip ? { block: tip.block, time: iso(tip.time) } : null,
  };
}

function amountOf(a: { faucetId: string; amount: bigint }, token: TokenInfo | null): ReceiptAmount {
  const out: ReceiptAmount = { faucetId: a.faucetId, amount: a.amount.toString(), verified: token?.verified ?? false };
  if (token) {
    out.symbol = token.symbol;
    out.decimals = token.decimals;
    out.formatted = formatAmount(a.amount, token.decimals);
  }
  return out;
}

function explorerLinks(network: Network, s: NoteSummary, txId: string | undefined): ReceiptCheck["explorer"] {
  const links: ReceiptCheck["explorer"] = { note: explorerUrl(network, "note", s.noteId) };
  if (txId) links.tx = explorerUrl(network, "tx", txId);
  return links;
}

export type WaitOptions = { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal };

export type CreateReceiptOptions = {
  network: Network;
  /** A NoteFile in Full format (with inclusion proof), as bytes or base64, e.g. from `miden export`. */
  noteFile?: Uint8Array | string;
  /** The payment note itself (an SDK Note, or its serialized bytes), e.g. as the wallet reports it. */
  note?: Note | Uint8Array;
  memo?: string;
  /** Encrypts the link (`r1e.`); at least MIN_PASSWORD_LENGTH characters. */
  password?: string;
  /** Site the link opens; defaults to DEFAULT_BASE_URL. */
  baseUrl?: string;
  /** On-chain transaction id to include as a claim. */
  txId?: string;
  /** Defaults to now. */
  createdAt?: string;
  rpc?: ReceiptRpc & VerifyRpc;
  /**
   * With `note`: wait until the note is committed (default, up to 3 minutes), or check once
   * (false) and fail if it isn't committed yet.
   */
  wait?: boolean | WaitOptions;
};

export type CreatedReceipt = {
  url: string;
  /** The link's fragment, without '#'. */
  fragment: string;
  noteId: string;
  /** Base64 NoteFile (Full format) inside the receipt. */
  noteFile: string;
};

/**
 * Makes a receipt link for a P2ID/P2IDE payment note. From a `noteFile`, the note must already be
 * on chain as described; from a `note`, the note's inclusion proof is fetched once it is committed.
 * Other note scripts are refused: a receipt reveals the note's details, which is only safe when
 * the note can be consumed by its target alone.
 */
export async function createReceipt(opts: CreateReceiptOptions): Promise<CreatedReceipt> {
  const { network } = opts;
  if ((opts.noteFile === undefined) === (opts.note === undefined)) {
    throw new Error("Pass either noteFile or note.");
  }
  if (opts.password !== undefined && opts.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters: anyone with the link can try passwords offline.`);
  }
  const call = <T>(fn: (rpc: ReceiptRpc & VerifyRpc) => Promise<T>): Promise<T> =>
    opts.rpc ? fn(opts.rpc) : withRpc(network, fn);

  let fileBytes: Uint8Array;
  let noteId: string;
  if (opts.noteFile !== undefined) {
    const bytes = typeof opts.noteFile === "string" ? noteFileFromBase64(opts.noteFile) : opts.noteFile;
    const check = await call((rpc) => verifyNoteFile(rpc, bytes));
    if (check.status === "not-found") {
      throw new Error(`Note ${check.summary.noteId} is not on ${network}. Check the network, or wait until it is committed.`);
    }
    if (check.status === "mismatch") throw new Error(`The note on chain doesn't match the file: ${check.reason}.`);
    fileBytes = bytes;
    noteId = check.summary.noteId;
  } else {
    const noteBytes = opts.note instanceof Uint8Array ? opts.note : bytesOf(opts.note!.serialize());
    const note = Note.deserialize(noteBytes);
    try {
      noteId = inspectNote(note).noteId;
    } finally { release(note); }
    if (opts.wait === false) {
      const file = await call((rpc) => receiptIfCommitted(rpc, noteBytes));
      if (!file) throw new Error(`Note ${noteId} isn't committed on ${network} yet.`);
      fileBytes = file;
    } else {
      fileBytes = await waitForReceipt(call, noteBytes, typeof opts.wait === "object" ? opts.wait : {});
    }
  }

  const noteFile = toBase64(fileBytes);
  const fragment = await encodeReceipt({
    v: 1,
    network,
    noteFile,
    memo: opts.memo?.trim() || undefined,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    txId: opts.txId,
  }, opts.password || undefined);
  return { url: receiptUrl(opts.baseUrl ?? DEFAULT_BASE_URL, fragment), fragment, noteId, noteFile };
}

export type CreateRequestOptions = {
  network: Network;
  /** The requester's address (bech32, with or without its `_…` suffix) or 0x account ID. */
  to: string;
  /** Token faucet (bech32 or 0x hex). Defaults to the network's fee token (USDCX on testnet). */
  faucetId?: string;
  /** Amount in base units. */
  amount?: bigint | string;
  /** Amount in whole tokens, e.g. "1.5"; converted with `decimals` or the token's own. */
  amountDecimal?: string;
  decimals?: number;
  memo?: string;
  /** Invoice number or similar. */
  ref?: string;
  /** Defaults to now. */
  createdAt?: string;
  baseUrl?: string;
  tokens?: TokenLookup;
};

export type CreatedRequest = { url: string; fragment: string; request: PaymentRequestV1 };

/**
 * Makes a payment request link. The request is unsigned: the payer should confirm the address
 * with the requester through another channel.
 */
export async function createRequest(opts: CreateRequestOptions): Promise<CreatedRequest> {
  const { network } = opts;
  const to = toBech32(accountOnNetwork(opts.to, network, "address"), network);
  const faucetRaw = opts.faucetId ?? FEE_FAUCETS[network];
  if (!faucetRaw) throw new Error(`No default token on ${network}; pass faucetId.`);
  const faucetId = accountOnNetwork(faucetRaw, network, "token");

  let amount: bigint;
  if ((opts.amount === undefined) === (opts.amountDecimal === undefined)) {
    throw new Error("Pass either amount (base units) or amountDecimal.");
  }
  if (opts.amountDecimal !== undefined) {
    let decimals = opts.decimals;
    if (decimals === undefined) {
      const info = await (opts.tokens ?? tokenInfo)(network, faucetId);
      if (!info) throw new Error(`Token ${faucetId} is unknown on ${network}, so its decimals can't be read; pass decimals.`);
      decimals = info.decimals;
    }
    amount = parseAmount(opts.amountDecimal, decimals);
  } else {
    const raw = String(opts.amount).trim();
    if (!/^\d+$/.test(raw)) throw new Error("amount must be a whole number of base units.");
    amount = BigInt(raw);
  }
  if (amount <= 0n) throw new Error("Amount must be positive.");
  // The payer's wallet takes the amount as a JS number.
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large for a wallet send.");

  const request = validateRequest({
    v: 1, network, to, faucetId, amount: amount.toString(),
    memo: opts.memo?.trim() || undefined,
    ref: opts.ref?.trim() || undefined,
    createdAt: opts.createdAt ?? new Date().toISOString(),
  });
  const fragment = await encodeRequest(request);
  return { url: requestUrl(opts.baseUrl ?? DEFAULT_BASE_URL, fragment), fragment, request };
}
