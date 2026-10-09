import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ExplorerLink } from "@/components/ExplorerLink";
import { useWallet } from "@miden-sdk/miden-wallet-adapter-react";
import type { RpcClient } from "@miden-sdk/miden-sdk";
import { Badge, Notice } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { BRAND } from "@/brand";
import { WalletButton } from "@/lib/wallet";
import {
  assess, block, cleanMemo, fmtLocal, fmtUtc, mismatchReason, type Included, type Tip,
} from "./view/status";
import { Chevron, CopyGlyph, Perforation, PaperGrain, SlipSkeleton, Stamp, VerdictIcon } from "./view/visuals";
import { ScanToCheck } from "./view/qr";
import type { ShareCardData } from "./view/shareCard";
import { ShareImageDialog } from "./view/shareDialog";
import "./receipt.css";
import {
  decodeReceipt, formatAmount, isEncryptedFragment, isTransient, type Network, noteFileFromBase64, PasswordRequiredError,
  type ReceiptV1, release, toBech32, tokenInfo, type TokenInfo, UnsupportedReceiptError, type Verification,
  verifyNoteFile, withRpc, WrongPasswordError,
} from "notecheck";

/** Delay before the single automatic retry of a transient RPC error. */
const RETRY_DELAY_MS = 1500;

type Checked = {
  receipt: ReceiptV1;
  result: Verification;
  /** Token info per fungible asset, in order; null = unknown. */
  tokens: (TokenInfo | null)[];
  tip: Tip | null;
  checkedAt: Date;
};

type State =
  | { step: "empty" }
  | { step: "password"; fragment: string; error?: string }
  | { step: "loading"; message: string }
  | { step: "error"; title: string; message: string; next?: string; detail?: string; retry: boolean }
  | ({ step: "done" } & Checked);

const fragmentNow = () => window.location.hash.replace(/^#/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RESEND = "Ask the sender to resend it, and make sure the whole link was copied.";
/** Entrance order of a slip section (see .rc-rise in receipt.css). */
const step = (i: number) => ({ "--i": i }) as CSSProperties;

async function readTip(rpc: RpcClient): Promise<Tip | null> {
  try {
    const header = await rpc.getBlockHeaderByNumber();
    try { return { block: header.blockNum(), time: header.timestamp() }; } finally { release(header); }
  } catch {
    return null;
  }
}

export function ReceiptPage() {
  const [state, setState] = useState<State>({ step: "loading", message: "Reading receipt…" });
  // Every open or re-check takes a new number; results of an older one are dropped.
  const seq = useRef(0);
  // The decoded receipt for the current fragment, so a re-check needs no password.
  const kept = useRef<{ fragment: string; receipt: ReceiptV1 } | null>(null);

  const check = useCallback(async (receipt: ReceiptV1, my: number) => {
    const live = () => seq.current === my;
    const net = receipt.network;
    setState({ step: "loading", message: `Checking ${net}…` });
    const attempt = (bytes: Uint8Array) => withRpc(net, async (rpc) => {
      const result = await verifyNoteFile(rpc, bytes);
      const tip = result.status === "included" && result.summary.kind === "P2IDE" ? await readTip(rpc) : null;
      return { result, tip };
    });
    let out: { result: Verification; tip: Tip | null };
    try {
      const bytes = noteFileFromBase64(receipt.noteFile);
      try {
        out = await attempt(bytes);
      } catch (e) {
        if (e instanceof UnsupportedReceiptError || !isTransient(e) || !live()) throw e;
        await sleep(RETRY_DELAY_MS);
        if (!live()) return;
        out = await attempt(bytes);
      }
    } catch (e) {
      if (!live()) return;
      if (e instanceof UnsupportedReceiptError) {
        return setState({ step: "error", title: "This receipt can't be read", message: e.message, next: RESEND, retry: false });
      }
      return setState({
        step: "error",
        title: "Couldn't check the payment right now",
        message: `The ${net} node isn't responding. Try again in a minute.`,
        detail: (e as Error)?.message || String(e),
        retry: true,
      });
    }
    if (!live()) return;
    let tokens: (TokenInfo | null)[] = [];
    if (out.result.status === "included" && out.result.summary.assets.length > 0) {
      // The amount is not shown before its decimals are known.
      setState({ step: "loading", message: "Checking… looking up the token" });
      tokens = await Promise.all(out.result.summary.assets.map((a) => tokenInfo(net, a.faucetId).catch(() => null)));
      if (!live()) return;
    }
    setState({ step: "done", receipt, ...out, tokens, checkedAt: new Date() });
  }, []);

  const open = useCallback(async (fragment: string, password?: string) => {
    const my = ++seq.current;
    if (!fragment) return setState({ step: "empty" });
    const k = kept.current;
    if (!password && k && k.fragment === fragment) return check(k.receipt, my);
    if (isEncryptedFragment(fragment) && !password) return setState({ step: "password", fragment });
    setState({ step: "loading", message: password ? "Decrypting…" : "Reading receipt…" });
    let receipt: ReceiptV1;
    try {
      receipt = await decodeReceipt(fragment, password);
    } catch (e) {
      if (seq.current !== my) return;
      if (e instanceof WrongPasswordError) return setState({ step: "password", fragment, error: e.message });
      if (e instanceof PasswordRequiredError) return setState({ step: "password", fragment });
      return setState({ step: "error", title: "This receipt link can't be read", message: (e as Error).message, next: RESEND, retry: false });
    }
    if (seq.current !== my) return;
    kept.current = { fragment, receipt };
    if (receipt.network === "mainnet") {
      return setState({
        step: "error", title: "Can't check mainnet receipts yet",
        message: "This receipt is for mainnet, whose RPC is not public yet. It can't be verified here.", retry: false,
      });
    }
    return check(receipt, my);
  }, [check]);

  const recheck = useCallback(() => void open(fragmentNow()), [open]);

  useEffect(() => {
    const counter = seq;
    void open(fragmentNow());
    const onHash = () => void open(fragmentNow());
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      counter.current++;
    };
  }, [open]);

  return (
    <section className="receipt">
      {state.step === "empty" && (
        <p>No receipt in this link. <a href="/?tool=receipt">Create or open one</a>.</p>
      )}
      {state.step === "loading" && (
        <div className="rc-checking">
          <p className="muted rc-loading" role="status"><span className="rc-loading-dot" aria-hidden="true" />{state.message}</p>
          <SlipSkeleton />
        </div>
      )}
      {state.step === "error" && <ErrorView state={state} onRecheck={recheck} />}
      {state.step === "password" && (
        <PasswordForm error={state.error} onSubmit={(pw) => void open(state.fragment, pw)} />
      )}
      {state.step === "done" && <ReceiptView checked={state} onRecheck={recheck} />}
    </section>
  );
}

function PasswordForm({ error, onSubmit }: { error?: string; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); if (pw) onSubmit(pw); };
  return (
    <form onSubmit={submit} className="stack rc-card rc-pad rc-lock">
      <h2><LockGlyph /> Password-protected receipt</h2>
      <p className="muted">The sender shared the password separately from the link.</p>
      <div className="input">
        <label htmlFor="receipt-pw" className="input-label">Password</label>
        <input id="receipt-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <div><button type="submit" className="btn btn-primary" disabled={!pw}>Open receipt</button></div>
    </form>
  );
}

function ErrorView({ state, onRecheck }: { state: Extract<State, { step: "error" }>; onRecheck: () => void }) {
  return (
    <Slip>
      <div className="rc-verdict rc-bad rc-rise" style={step(0)}>
        <VerdictIcon kind="bad" />
        <div className="rc-verdict-text"><h2>{state.title}</h2></div>
      </div>
      <Perforation />
      <div className="rc-pad stack rc-rise" style={step(1)}>
        <Notice tone="bad">{state.message}{state.next && <> {state.next}</>}</Notice>
        {state.detail && (
          <details className="rc-raw">
            <summary><Chevron />Error details</summary>
            <code>{state.detail}</code>
          </details>
        )}
        {state.retry && <div><button type="button" className="btn" onClick={onRecheck}>Check again</button></div>}
      </div>
    </Slip>
  );
}

/** The paper slip: torn bottom edge, faint grain and a soft shadow, rising in once. */
function Slip({ children, labelledBy }: { children: ReactNode; labelledBy?: string }) {
  return (
    <div className="rc-slip-wrap">
      <article className="rc-card rc-slip" aria-labelledby={labelledBy}>
        <PaperGrain />
        {children}
      </article>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg className="rc-lock-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy rc-copy rc-noprint${copied ? " is-copied" : ""}`}
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard blocked; nothing to do */ }
      }}
    >
      <CopyGlyph done={copied} />{copied ? "Copied" : "Copy"}
      <span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span>
    </button>
  );
}

function Row({ label, children, copy, hint }: { label: string; children: ReactNode; copy?: string; hint?: ReactNode }) {
  return (
    <div className="rc-row">
      <dt>{label}</dt>
      <dd>
        {children}
        {copy !== undefined && <CopyButton value={copy} label={label.charAt(0).toLowerCase() + label.slice(1)} />}
        {hint && <span className="rc-extra muted">{hint}</span>}
      </dd>
    </div>
  );
}

const netLabel = (net: Network) => (net === "mainnet" ? net : `${net} (test money)`);

function NotOnChain({ checked, onRecheck }: { checked: Checked; onRecheck: () => void }) {
  const { receipt, result } = checked;
  const net = receipt.network;
  const notFound = result.status === "not-found";
  return (
    <Slip labelledBy="rc-verdict">
      <div className={`rc-verdict ${notFound ? "rc-warn" : "rc-bad"} rc-rise`} role="status" style={step(0)}>
        <VerdictIcon kind={notFound ? "unknown" : "bad"} />
        <div className="rc-verdict-text">
          <h2 id="rc-verdict">{notFound ? `Not found on ${net}` : "This receipt does not match the chain"}</h2>
          <p className="rc-sub">Checked {fmtLocal(checked.checkedAt)} in this browser · {netLabel(net)}</p>
        </div>
      </div>
      <Perforation />
      <div className="rc-pad stack rc-rise" style={step(1)}>
        <p>
          {notFound
            ? "No payment with this note ID has been recorded. It may still be on its way, the receipt may be for a different network, or the test network may have been reset."
            : <>The payment in this link differs from what the network recorded: {mismatchReason(result.status === "mismatch" ? result.reason : "")}.</>}
        </p>
        <p className="muted small">
          {notFound
            ? "If it was sent just now, wait a minute and check again. Otherwise ask the sender which network they used and to resend the receipt."
            : "Don't rely on this receipt. Ask the sender for a new one."}
        </p>
        <dl className="rc-rows">
          <Row label="Note ID" copy={result.summary.noteId}><code>{result.summary.noteId}</code></Row>
        </dl>
        <p className="muted small">Amounts and accounts in this link are not shown because the network doesn't confirm them.</p>
        <div><button type="button" className="btn rc-noprint" onClick={onRecheck}>Check again</button></div>
      </div>
    </Slip>
  );
}

function ReceiptView({ checked, onRecheck }: { checked: Checked; onRecheck: () => void }) {
  if (checked.result.status !== "included") return <NotOnChain checked={checked} onRecheck={onRecheck} />;
  return <Confirmed checked={checked} result={checked.result} onRecheck={onRecheck} />;
}

/** The check date on the stamp, in the reader's time zone like "Checked …": "9 OCT 2026". */
const stampDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();

/** "1 USDCX" for a verified token, else the base units, for the title and the print footer. */
function amountText(result: Included, tokens: (TokenInfo | null)[]): string | null {
  const a = result.summary.assets[0];
  if (!a) return null;
  const t = tokens[0];
  const more = result.summary.assets.length > 1 ? " + more" : "";
  return (t?.verified ? `${formatAmount(a.amount, t.decimals)} ${t.symbol}` : `${formatAmount(a.amount, 0)} base units`) + more;
}

/** The first amount for the share image: token units when verified, else base units. */
function cardAmount(result: Included, tokens: (TokenInfo | null)[]): ShareCardData["amount"] {
  const a = result.summary.assets[0];
  if (!a) return null;
  const t = tokens[0];
  const more = result.summary.assets.length > 1;
  return t?.verified
    ? { value: formatAmount(a.amount, t.decimals), unit: t.symbol, more }
    : { value: formatAmount(a.amount, 0), unit: "base units", more };
}

function Confirmed({ checked, result, onRecheck }: { checked: Checked; result: Included; onRecheck: () => void }) {
  const { receipt, tokens, tip, checkedAt } = checked;
  const net = receipt.network;
  const s = result.summary;
  const a = assess(result, tip, net);
  const memo = receipt.memo ? cleanMemo(receipt.memo) : "";
  const amount = amountText(result, tokens);
  const checkedText = fmtLocal(checkedAt);
  // The link as opened, fragment included; for a protected receipt that is the encrypted link (no password).
  const url = window.location.href;
  const passwordRequired = isEncryptedFragment(fragmentNow());
  const [sharing, setSharing] = useState(false);
  const shareData = useMemo(() => ({
    amount: cardAmount(result, tokens),
    received: result.spentAt !== null && a.received === "yes",
    network: net,
    noteId: s.noteId,
    checked: checkedText,
    url,
    passwordRequired,
  }), [result, tokens, a.received, net, s.noteId, checkedText, url, passwordRequired]);

  useEffect(() => {
    const prev = document.title;
    document.title = amount ? `Payment receipt · ${amount}` : "Payment receipt";
    return () => { document.title = prev; };
  }, [amount]);

  // Print with every section open, then put them back.
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = [...document.querySelectorAll<HTMLDetailsElement>(".receipt details.rc-expand:not([open])")];
      for (const d of opened) d.open = true;
    };
    const after = () => { for (const d of opened) d.open = false; opened = []; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);

  const received = result.spentTime === null
    ? "not claimed yet"
    : a.received === "yes"
      ? `received by the recipient ${fmtUtc(result.spentTime)}`
      : `claimed ${fmtUtc(result.spentTime)}`;

  return (
    <>
      <div className="rc-toolbar rc-noprint">
        {/* Only a chain-confirmed verdict can be turned into an image. */}
        {a.verdict === "good" && (
          <button type="button" className="btn rc-btn-icon" onClick={() => setSharing(true)} aria-haspopup="dialog">
            <ShareGlyph />Share image
          </button>
        )}
        <button type="button" className="btn" onClick={() => window.print()}>Save as PDF</button>
      </div>
      {sharing && a.verdict === "good" && (
        <ShareImageDialog data={shareData} title={amount ? `Payment receipt · ${amount}` : "Payment receipt"} onClose={() => setSharing(false)} />
      )}
      <Slip labelledBy="rc-verdict">
        <div className="rc-printonly rc-brand">
          <LogoMark size={22} /> <strong>{BRAND.name}</strong> · Payment receipt
        </div>
        <div className={`rc-verdict rc-${a.verdict} rc-rise`} role="status" style={step(0)}>
          <VerdictIcon kind={a.verdict} />
          <div className="rc-verdict-text">
            <h2 id="rc-verdict">{a.headline}</h2>
            <p className="rc-sub">Checked {checkedText} in this browser · {netLabel(net)}</p>
          </div>
          {a.verdict === "good" && <Stamp date={stampDate(checkedAt)} network={net} />}
        </div>
        {net !== "mainnet" && <p className="rc-testnet rc-rise" style={step(1)}>Test network — no real value</p>}
        <Perforation />

        <div className="rc-pad rc-rise" style={step(2)}>
          <Amounts network={net} result={result} tokens={tokens} />
          <p className="rc-when">Sent {fmtUtc(result.inclusionTime)} · {received}</p>

          <dl className="rc-rows">
            <Row label="Paid to" copy={toBech32(s.recipient, net)}><code>{toBech32(s.recipient, net)}</code></Row>
            <Row label="Paid from" copy={toBech32(s.sender, net)}><code>{toBech32(s.sender, net)}</code></Row>
            <Row label="Status">
              <span className={`rc-status rc-status-${a.status.tone}`}>{a.status.lead}</span>
              {a.status.rest && <span className="muted"> — {a.status.rest}</span>}
              {a.extra.map((x) => <span key={x} className="rc-extra muted">{x}</span>)}
            </Row>
          </dl>

          {memo && (
            <div className="rc-memo">
              <div className="rc-memo-label">Note from the sender · not checked</div>
              <p className="rc-memo-text">“{memo}”</p>
            </div>
          )}
        </div>

        <details className="rc-section rc-expand rc-rise" style={step(3)}>
          <summary><Chevron />Technical details (for verification)</summary>
          <dl className="rc-rows rc-tech">
            <Row label="Note ID" copy={s.noteId} hint="One payment = one note ID. Record it to avoid the same payment being presented twice.">
              <code>{s.noteId}</code> <ExplorerLink network={net} kind="note" id={s.noteId}>Midenscan</ExplorerLink>
            </Row>
            <Row label="Recipient account" copy={s.recipient}><code>{s.recipient}</code> <ExplorerLink network={net} kind="account" id={s.recipient}>Midenscan</ExplorerLink></Row>
            <Row label="Sender account" copy={s.sender}><code>{s.sender}</code> <ExplorerLink network={net} kind="account" id={s.sender}>Midenscan</ExplorerLink></Row>
            {s.assets.map((x, i) => (
              <Row
                key={x.faucetId} label={s.assets.length > 1 ? `Token faucet ${i + 1}` : "Token faucet"} copy={x.faucetId}
                hint={`${toBech32(x.faucetId, net)} · ${formatAmount(x.amount, 0)} base units`}
              >
                <code>{x.faucetId}</code>
              </Row>
            ))}
            <Row label="Included in block">{block(result.inclusionBlock)} · {fmtUtc(result.inclusionTime)} <ExplorerLink network={net} kind="block" id={result.inclusionBlock}>Midenscan</ExplorerLink></Row>
            <Row label="Spent in block">
              {result.spentAt === null ? "Not spent yet" : <>{block(result.spentAt)}{result.spentTime !== null && ` · ${fmtUtc(result.spentTime)}`} <ExplorerLink network={net} kind="block" id={result.spentAt}>Midenscan</ExplorerLink></>}
            </Row>
            <Row label="Note type">{s.kind} · {s.visibility} note</Row>
            {s.kind === "P2IDE" && (
              <>
                <Row label="Reclaim from block">{s.reclaimHeight === null ? "Never (reclaim disabled)" : block(s.reclaimHeight)}</Row>
                <Row label="Timelock until block">{s.timelockHeight === null ? "None" : block(s.timelockHeight)}</Row>
                {s.reclaimer && s.reclaimHeight !== null && (
                  <Row label="Reclaim account" copy={s.reclaimer} hint={s.reclaimer === s.sender ? "The sender" : undefined}>
                    <code>{s.reclaimer}</code>
                  </Row>
                )}
                <Row label="Latest block at check">{tip ? block(tip.block) : "Couldn't be read"}</Row>
              </>
            )}
            {receipt.createdAt && (
              <Row label="Created" hint="Claimed by the sender, not checked">
                {new Date(receipt.createdAt).toISOString().replace("T", " ").slice(0, 16) + " UTC"}
              </Row>
            )}
            {receipt.txId && (
              <Row label="Transaction ID" copy={receipt.txId} hint="Claimed by the sender, not checked"><code>{receipt.txId}</code> <ExplorerLink network={net} kind="tx" id={receipt.txId}>Midenscan</ExplorerLink></Row>
            )}
          </dl>
          <p className="muted small">Checking asks the Miden node about this note; the node can see when it is spent.</p>
        </details>

        <details className="rc-section rc-expand rc-rise" style={step(4)}>
          <summary><Chevron />What this receipt proves, and what it doesn't</summary>
          <div className="rc-proves">
            <div>
              <h3>Checked on the network</h3>
              <ul className="rc-yes">
                <li>These assets were sent in a note to the recipient account above, by the sender above.</li>
                <li>The note was recorded on {net} in block {block(result.inclusionBlock)}.</li>
                <li>Whether the note has been claimed, and in which block.</li>
              </ul>
            </div>
            <div>
              <h3>Not checked</h3>
              <ul className="rc-no">
                <li>Who claimed it, when the sender could also take it back (P2IDE notes with a reclaim block).</li>
                <li>A token's name and decimals, unless it is on the official token list.</li>
                <li>Anything else about either account. Other transactions stay private.</li>
                <li>The note, date and transaction ID from the sender: they are the sender's own words.</li>
              </ul>
            </div>
          </div>
        </details>

        <div className="rc-foot rc-rise" style={step(5)}>
          <div className="rc-foot-text">
            <p>Anyone who has this link can see this payment, and only this payment. Share it only with the people who need it.</p>
            <p className="rc-printonly">Checked on {checkedText}{amount ? ` · ${amount}` : ""}</p>
            <p className="rc-printonly rc-url">{url}</p>
            <div className="explorer-links rc-noprint">
              <button type="button" className="link" onClick={onRecheck}>Check again</button>
              <ExplorerLink network={net} kind="note" id={s.noteId}>See the note on Midenscan</ExplorerLink>
            </div>
          </div>
          <ScanToCheck url={url} passwordRequired={passwordRequired} />
        </div>
      </Slip>

      {result.spentAt === null && net === "testnet" && <ImportToWallet noteFileB64={receipt.noteFile} />}
    </>
  );
}

function Amounts({ network, result, tokens }: { network: Network; result: Included; tokens: (TokenInfo | null)[] }) {
  const s = result.summary;
  return (
    <div className="rc-amounts">
      {s.assets.length > 0 && <div className="rc-label">{s.assets.length > 1 ? "Amounts" : "Amount"}</div>}
      {s.assets.map((a, i) => {
        const t = tokens[i] ?? null;
        const faucet = (
          <p className="rc-faucet muted">Token faucet <code>{toBech32(a.faucetId, network)}</code></p>
        );
        if (t?.verified) {
          return (
            <p key={a.faucetId} className="rc-hero">
              <strong className="rc-num">{formatAmount(a.amount, t.decimals)}</strong> <span className="rc-sym">{t.symbol}</span>
            </p>
          );
        }
        if (t) {
          return (
            <div key={a.faucetId} className="rc-asset">
              <Badge tone="warn">Unverified token</Badge>
              <p className="rc-hero">
                <strong className="rc-num">{formatAmount(a.amount, 0)}</strong> <span className="rc-unit">base units</span>
              </p>
              <p className="muted">
                Its creator calls this {formatAmount(a.amount, t.decimals)} <span className="rc-claimed-sym">{t.symbol}</span> (symbol and decimals set by its creator).
              </p>
              {faucet}
            </div>
          );
        }
        return (
          <div key={a.faucetId} className="rc-asset">
            <p className="rc-hero">
              <strong className="rc-num">{formatAmount(a.amount, 0)}</strong> <span className="rc-unit">units of an unknown token</span>
            </p>
            {faucet}
          </div>
        );
      })}
      {s.otherAssets > 0 && <p className="muted small">Plus {s.otherAssets} non-fungible asset(s).</p>}
    </div>
  );
}

/** Lets the recipient pull the note into their wallet if private delivery didn't reach them. */
function ImportToWallet({ noteFileB64 }: { noteFileB64: string }) {
  const { connected, importPrivateNote } = useWallet();
  const [state, setState] = useState<{ busy?: boolean; done?: boolean; error?: string }>({});

  const run = async () => {
    if (!importPrivateNote) return;
    setState({ busy: true });
    try {
      await importPrivateNote(noteFileFromBase64(noteFileB64));
      setState({ done: true });
    } catch (e) {
      setState({ error: (e as Error).message || "The wallet didn't import the note." });
    }
  };

  return (
    <details className="import rc-noprint">
      <summary><Chevron />Are you the recipient? Receive this payment in your wallet</summary>
      <p className="muted small">
        Your wallet normally gets private notes automatically. If this one hasn't shown up, import it from this
        receipt. Only the recipient account can claim it.
      </p>
      {!connected && <WalletButton />}
      {connected && !state.done && (
        <div><button type="button" className="btn btn-primary" disabled={state.busy} onClick={() => void run()}>
          {state.busy ? "Waiting for the wallet…" : "Import into my wallet"}
        </button></div>
      )}
      {state.done && <Notice tone="info">Imported. Your wallet can now claim the note.</Notice>}
      {state.error && <Notice tone="bad">{state.error}</Notice>}
    </details>
  );
}

function ShareGlyph() {
  return (
    <svg className="rc-share-glyph" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M8 10V2M5 4.8L8 1.8l3 3" />
      <path d="M5.5 7H4.2A1.7 1.7 0 0 0 2.5 8.7v4.6A1.7 1.7 0 0 0 4.2 15h7.6a1.7 1.7 0 0 0 1.7-1.7V8.7A1.7 1.7 0 0 0 11.8 7h-1.3" />
    </svg>
  );
}
