import { readFileSync, statSync } from "node:fs";
import { toBech32 } from "./account.js";
import { createReceipt, createRequest, verifyReceipt, type ReceiptAmount, type ReceiptCheck } from "./api.js";
import { inspectNoteFileBytes, noteFileFromBase64 } from "./inspect.js";
import { NETWORKS, type Network } from "./network.js";
import { PasswordRequiredError, decodeReceipt, fragmentOf, isEncryptedFragment } from "./receipt.js";
import { FEE_FAUCETS, formatAmount, tokenInfo } from "./tokens.js";

export type Io = {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
  color: boolean;
};

/** Exit codes: 0 confirmed / done, 1 checked but not confirmed, 2 usage, input or network error. */
export const EXIT = { ok: 0, notConfirmed: 1, error: 2 } as const;

export class UsageError extends Error {}

const HELP = `notecheck: verifiable private payment receipts and payment requests for Miden

Usage:
  notecheck verify <link-or-fragment> [--password <pw>] [--json]
  notecheck inspect <file.mno | base64 | receipt link> [--network <name>] [--password <pw>] [--json]
  notecheck receipt <file.mno> [--network <name>] [--memo <text>] [--password <pw>] [--base-url <url>] [--json]
  notecheck request --to <address> --amount <decimal> [--token <faucet id> | --usdcx]
                    [--memo <text>] [--ref <text>] [--network <name>] [--base-url <url>] [--json]

Commands:
  verify    Check a receipt link against the Miden network it names.
  inspect   Decode a note file or receipt offline: note ID, kind, amount, recipient, sender.
  receipt   Make a receipt link from a note file exported in Full format
            (miden export --note <id> --export-type full). The note must be on chain.
  request   Make a payment request link. Requests are unsigned: the payer should
            confirm the address with you.

Options:
  --json         Print a JSON object instead of text.
  --password     Receipt password. verify and inspect also read NOTECHECK_PASSWORD.
  --network      testnet (default), devnet or mainnet.
  --base-url     Site the link opens (default https://notecheck-miden.vercel.app).
  --token        Token faucet ID or bech32 address (default: the network's fee token).
  --usdcx        Use the testnet USDCX faucet.
  -h, --help     Show this help.
  -v, --version  Show the version.

Exit codes: 0 confirmed or done, 1 receipt not confirmed (not found, mismatch or
reclaimable), 2 usage, input or network error. Set NOTECHECK_DEBUG=1 for stack traces.`;

type Spec = { values: string[]; flags: string[]; positionals: number };

const SPECS: Record<string, Spec> = {
  verify: { values: ["password"], flags: ["json"], positionals: 1 },
  inspect: { values: ["network", "password"], flags: ["json"], positionals: 1 },
  receipt: { values: ["network", "memo", "password", "base-url"], flags: ["json"], positionals: 1 },
  request: { values: ["to", "amount", "token", "memo", "ref", "network", "base-url"], flags: ["json", "usdcx"], positionals: 0 },
};

type Parsed = { positionals: string[]; values: Record<string, string | undefined>; flags: Set<string> };

export function parseArgs(command: string, args: string[]): Parsed {
  const spec = SPECS[command];
  const out: Parsed = { positionals: [], values: {}, flags: new Set() };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      out.positionals.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith("--") || a.length === 2) {
      out.positionals.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq < 0 ? undefined : eq);
    if (spec.flags.includes(name)) {
      if (eq >= 0) throw new UsageError(`--${name} takes no value.`);
      out.flags.add(name);
    } else if (spec.values.includes(name)) {
      const value = eq >= 0 ? a.slice(eq + 1) : args[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value.`);
      out.values[name] = value;
    } else {
      throw new UsageError(`Unknown option --${name} for "${command}".`);
    }
  }
  if (out.positionals.length !== spec.positionals) {
    throw new UsageError(spec.positionals === 0
      ? `"${command}" takes no arguments besides options.`
      : `"${command}" takes ${spec.positionals} argument; see notecheck --help.`);
  }
  return out;
}

function networkOf(p: Parsed): Network {
  const n = p.values.network ?? "testnet";
  if (!NETWORKS.includes(n as Network)) throw new UsageError(`Unknown network "${n}"; use ${NETWORKS.join(", ")}.`);
  return n as Network;
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}

const isFile = (path: string) => {
  try { return statSync(path).isFile(); } catch { return false; }
};

/** Note file bytes from a path, or from base64 text when no such file exists. */
function noteFileInput(arg: string): Uint8Array {
  if (isFile(arg)) return new Uint8Array(readFileSync(arg));
  // A note file is ~460 bytes, so its base64 is far longer than a typical path.
  if (arg.length < 100 || !/^[A-Za-z0-9+/_=\s-]+$/.test(arg)) throw new UsageError(`No such file: ${arg}`);
  return noteFileFromBase64(arg);
}

const json = (io: Io, v: unknown) => io.out(JSON.stringify(v, null, 2));

const paint = (io: Io, code: string, s: string) => (io.color ? `\x1b[${code}m${s}\x1b[0m` : s);
const row = (label: string, value: string) => `  ${label.padEnd(11)} ${value}`;
const num = (n: number) => n.toLocaleString("en-US");

/** ISO time as "9 Oct 2026, 12:24 UTC". */
function utc(isoTime: string): string {
  return new Date(isoTime).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}

function amountText(a: ReceiptAmount, network: Network): string {
  if (a.formatted !== undefined && a.symbol) {
    return `${a.formatted} ${a.symbol}${a.verified ? "" : " (unverified token: anyone can name a token this way)"}`;
  }
  return `${a.amount} base units of token ${toBech32(a.faucetId, network)} (unknown token)`;
}

function verdict(io: Io, r: ReceiptCheck): string {
  const net = r.network;
  switch (r.status) {
    case "confirmed":
      return paint(io, "32", `✓ Payment confirmed on the Miden network (${net})`);
    case "committed-reclaimable": {
      const who = r.reclaim && r.reclaim.by.hex !== r.sender.hex ? "another account" : "the sender";
      return paint(io, "33", r.spentAt !== null
        ? `! Payment committed on ${net}, but it may have gone back to ${who}`
        : `! Payment committed on ${net}, but ${who} can take it back while it is unclaimed`);
    }
    case "not-found":
      return paint(io, "31", `✗ Not found on ${net}: no note with this ID is on chain`);
    case "mismatch":
      return paint(io, "31", `✗ Doesn't match the chain: the note on ${net} differs from the one in the link`);
  }
}

function claimedText(r: ReceiptCheck): string {
  const when = r.spentAt === null ? "" : `block ${num(r.spentAt)}${r.spentTime ? ` · ${utc(r.spentTime)}` : ""}`;
  if (r.received === "yes") return `yes, the recipient claimed it in ${when}`;
  if (r.received === "maybe") {
    return `in ${when}, by the recipient or by ${r.reclaim?.by.bech32 ?? "the sender"} (the chain doesn't show which)`;
  }
  return "not yet";
}

export function printCheck(io: Io, r: ReceiptCheck): void {
  io.out(verdict(io, r));
  io.out("");
  const rows: [string, string][] = [];
  for (const a of r.amount) rows.push(["Amount", amountText(a, r.network)]);
  if (r.otherAssets > 0) rows.push(["Other", `${r.otherAssets} non-fungible asset(s)`]);
  rows.push(["Paid to", r.recipient.bech32]);
  rows.push(["Paid from", r.sender.bech32]);
  if (r.inclusionBlock !== null) {
    rows.push(["Included", `block ${num(r.inclusionBlock)}${r.inclusionTime ? ` · ${utc(r.inclusionTime)}` : ""}`]);
    rows.push(["Claimed", claimedText(r)]);
  }
  if (r.timelockHeight !== null && r.spentAt === null) {
    rows.push(["Timelock", `the recipient can claim it from block ${num(r.timelockHeight)}`]);
  }
  if (r.reclaim && r.spentAt === null) {
    rows.push(["Reclaim", `${r.reclaim.by.bech32} can take it back from block ${num(r.reclaim.from)} while unclaimed`
      + (r.tip ? ` (now at block ${num(r.tip.block)})` : "")]);
  }
  rows.push(["Note", `${r.noteId} (${r.kind}, ${r.visibility})`]);
  for (const [k, v] of rows) io.out(row(k, v));
  if (r.status === "not-found") {
    io.out("");
    io.out("  The payment may not be on chain yet, the link may be for another network, or it was altered.");
  }
  if (r.mismatch) {
    io.out("");
    io.out(`  ${r.mismatch}`);
  }
  const c = r.claims;
  if (c.memo || c.createdAt || c.txId) {
    io.out("");
    io.out("  Sender's claims (not checked)");
    if (c.memo) io.out(row("Memo", c.memo));
    if (c.createdAt) io.out(row("Created", utc(c.createdAt)));
    if (c.txId) io.out(row("Tx", c.txId));
  }
  if (r.explorer.note) {
    io.out("");
    io.out(row("Explorer", r.explorer.note));
  }
}

async function cmdVerify(p: Parsed, io: Io): Promise<number> {
  const link = p.positionals[0];
  let password = p.values.password;
  if (password === undefined && isEncryptedFragment(fragmentOf(link))) password = io.env.NOTECHECK_PASSWORD || undefined;
  let r: ReceiptCheck;
  try {
    r = await verifyReceipt(link, { password });
  } catch (e) {
    if (e instanceof PasswordRequiredError) {
      throw new Error("This receipt is password-protected. Pass --password or set NOTECHECK_PASSWORD.");
    }
    throw e;
  }
  if (p.flags.has("json")) json(io, r);
  else printCheck(io, r);
  return r.status === "confirmed" ? EXIT.ok : EXIT.notConfirmed;
}

async function cmdInspect(p: Parsed, io: Io): Promise<number> {
  const arg = p.positionals[0];
  let network = networkOf(p);
  let bytes: Uint8Array;
  const fragment = fragmentOf(arg);
  if (!isFile(arg) && /^r1e?\./.test(fragment)) {
    const password = p.values.password ?? (io.env.NOTECHECK_PASSWORD || undefined);
    const receipt = await decodeReceipt(fragment, password).catch((e: unknown) => {
      if (e instanceof PasswordRequiredError) {
        throw new Error("This receipt is password-protected. Pass --password or set NOTECHECK_PASSWORD.");
      }
      throw e;
    });
    if (p.values.network === undefined) network = receipt.network;
    bytes = noteFileFromBase64(receipt.noteFile);
  } else {
    bytes = noteFileInput(arg);
  }
  const s = inspectNoteFileBytes(bytes);
  const party = (hex: string) => ({ bech32: toBech32(hex, network), hex });
  const view = {
    noteId: s.noteId,
    kind: s.kind,
    visibility: s.visibility,
    network,
    amount: s.assets.map((a) => ({ faucetId: a.faucetId, amount: a.amount.toString() })),
    otherAssets: s.otherAssets,
    recipient: party(s.recipient),
    sender: party(s.sender),
    tag: s.tag,
    nullifier: s.nullifier,
    reclaimHeight: s.reclaimHeight,
    timelockHeight: s.timelockHeight,
    reclaimer: s.reclaimer === null ? null : party(s.reclaimer),
  };
  if (p.flags.has("json")) {
    json(io, view);
    return EXIT.ok;
  }
  io.out(`Note file (offline, not checked against the chain; addresses shown for ${network})`);
  io.out("");
  io.out(row("Note", view.noteId));
  io.out(row("Kind", `${view.kind}, ${view.visibility}`));
  for (const a of s.assets) io.out(row("Amount", `${a.amount} base units of token ${toBech32(a.faucetId, network)}`));
  if (s.otherAssets > 0) io.out(row("Other", `${s.otherAssets} non-fungible asset(s)`));
  io.out(row("Recipient", `${view.recipient.bech32} (${view.recipient.hex})`));
  io.out(row("Sender", `${view.sender.bech32} (${view.sender.hex})`));
  if (s.kind === "P2IDE") {
    io.out(row("Reclaim", view.reclaimer && s.reclaimHeight !== null
      ? `${view.reclaimer.bech32} from block ${num(s.reclaimHeight)}` : "disabled"));
    io.out(row("Timelock", s.timelockHeight === null ? "none" : `until block ${num(s.timelockHeight)}`));
  }
  io.out(row("Nullifier", s.nullifier));
  return EXIT.ok;
}

async function cmdReceipt(p: Parsed, io: Io): Promise<number> {
  const network = networkOf(p);
  const bytes = noteFileInput(p.positionals[0]);
  const made = await createReceipt({
    network,
    noteFile: bytes,
    memo: p.values.memo,
    password: p.values.password,
    baseUrl: p.values["base-url"],
  });
  if (p.flags.has("json")) {
    json(io, { url: made.url, fragment: made.fragment, noteId: made.noteId, network, encrypted: p.values.password !== undefined });
    return EXIT.ok;
  }
  io.out(paint(io, "32", `✓ Note ${made.noteId} is on ${network}`));
  io.out("");
  io.out(made.url);
  if (p.values.password !== undefined) {
    io.out("");
    io.out("The link is password-protected. Send the password separately from the link.");
  }
  return EXIT.ok;
}

async function cmdRequest(p: Parsed, io: Io): Promise<number> {
  const network = networkOf(p);
  const to = p.values.to;
  const amount = p.values.amount;
  if (!to) throw new UsageError("request needs --to <address>.");
  if (!amount) throw new UsageError("request needs --amount <decimal>, e.g. --amount 1.5");
  if (p.flags.has("usdcx") && p.values.token) throw new UsageError("Use either --token or --usdcx.");
  let faucetId = p.values.token;
  if (p.flags.has("usdcx")) {
    if (network !== "testnet") throw new UsageError("--usdcx is for testnet; pass --token for other networks.");
    faucetId = FEE_FAUCETS.testnet;
  }
  const made = await createRequest({
    network, to, faucetId, amountDecimal: amount, memo: p.values.memo, ref: p.values.ref, baseUrl: p.values["base-url"],
  });
  const token = await tokenInfo(network, made.request.faucetId);
  if (p.flags.has("json")) {
    json(io, { url: made.url, fragment: made.fragment, request: made.request, token });
    return EXIT.ok;
  }
  const r = made.request;
  const shown = token ? `${formatAmount(BigInt(r.amount), token.decimals)} ${token.symbol}` : `${r.amount} base units`;
  io.out(`Payment request: ${shown} to ${r.to} on ${network}`);
  if (token && !token.verified) io.out("  The token is not in the official token list.");
  if (r.memo) io.out(row("Memo", r.memo));
  if (r.ref) io.out(row("Reference", r.ref));
  io.out("");
  io.out(made.url);
  io.out("");
  io.out("The link is unsigned: the payer should confirm the address with you before paying.");
  return EXIT.ok;
}

const COMMANDS: Record<string, (p: Parsed, io: Io) => Promise<number>> = {
  verify: cmdVerify,
  inspect: cmdInspect,
  receipt: cmdReceipt,
  request: cmdRequest,
};

export async function run(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help" || command === "help") {
    io.out(HELP);
    return command ? EXIT.ok : EXIT.error;
  }
  if (command === "-v" || command === "--version") {
    io.out(version());
    return EXIT.ok;
  }
  const fn = COMMANDS[command];
  try {
    if (!fn) throw new UsageError(`Unknown command "${command}". Run notecheck --help.`);
    if (rest.includes("--help") || rest.includes("-h")) {
      io.out(HELP);
      return EXIT.ok;
    }
    return await fn(parseArgs(command, rest), io);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    io.err(`notecheck: ${message}`);
    if (io.env.NOTECHECK_DEBUG === "1" && e instanceof Error && e.stack) io.err(e.stack);
    return EXIT.error;
  }
}
