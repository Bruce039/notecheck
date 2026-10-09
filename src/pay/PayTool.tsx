import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Transaction } from "@miden-sdk/miden-wallet-adapter-base";
import { useWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { ReceiptLink } from "@/components/ReceiptLink";
import { Hero } from "@/components/hero/Hero";
import { Badge, Notice, ToolCard } from "@/components/ui";
import { attempt } from "@/lib/attempt";
import type { Network } from "@/lib/network";
import { withRpc } from "@/lib/rpc";
import { formatAmount, tokenInfo, type TokenInfo } from "@/lib/tokens";
import { WalletButton } from "@/lib/wallet";
import { toBase64 } from "@/receipt/bytes";
import { MEMO_MAX, encodeReceipt, receiptUrl } from "@/receipt/format";
import { noteFileFromBase64 } from "@/receipt/inspect";
import { normalizeAccountId, parseAccountId, toBech32 } from "@/tools/address/account";
import { release } from "@/lib/wasm";
import { HRP } from "@/lib/network";
import { decodeRequest, isRequestFragment, receiptMemoFor, type PaymentRequestV1 } from "@/request/format";
import { useTokenInfo } from "@/request/useTokenInfo";
import { RequestCard } from "@/request/RequestCard";
import { requestAmountText, shortAddress } from "@/request/display";
import { PayStepper } from "./Stepper";
import "./pay.css";
import {
  clearPending, loadPending, loadRecent, parseAmount, pickPaymentNote, removeRecent, saveRecent, savePending,
  waitForReceipt, type PendingPayment, type RecentReceipt,
} from "./payment";

const MIN_PASSWORD = 8;
const passwordError = (pw: string) =>
  pw && pw.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters: anyone with the link can try passwords offline.` : undefined;

/** Recipient as typed, checked against the selected network. Returns the canonical hex. */
function checkRecipient(raw: string, network: Network): string {
  const { id, input } = parseAccountId(raw);
  const hex = id.toString();
  release(id);
  if (input.kind === "bech32" && input.network !== network) {
    throw new Error(`This is a ${input.network ?? input.hrp} address (${input.hrp}1…); you're paying on ${network} (${HRP[network]}1…).`);
  }
  return hex;
}

/** `walletFaucetId` is the string the wallet gave us; it is passed back to the wallet unchanged. */
type Holding = { faucetId: string; walletFaucetId: string; amount: bigint; token: TokenInfo | null | undefined };

/** `at` is the PayStepper step: 0 wallet prompt, 1 wallet working, 2 on chain, 3 building the receipt. */
type Stage =
  | { step: "form" }
  | { step: "progress"; at: number; startedAt: number }
  | { step: "done"; url: string; protectedBy: boolean; requester?: string; startedAt: number }
  | { step: "error"; message: string; saved?: boolean; at: number; startedAt: number };

type WaitFn = NonNullable<ReturnType<typeof useWallet>["waitForTransaction"]>;

const errorText = (e: unknown) => {
  const err = e as { message?: string; error?: { message?: string } };
  return [err.message, err.error?.message].filter(Boolean).join(": ") || String(e);
};

/**
 * The wallet builds and sends the note itself (so every account type, multisig included, gets the
 * auth data it needs) and reports the full output note on completion. The receipt is made from
 * that note once it is confirmed to be the payment that was asked for.
 */
async function finishReceipt(
  p: PendingPayment, wait: WaitFn | undefined, connected: boolean, password?: string,
  onNoteKnown?: () => void,
): Promise<string> {
  let record = p;
  if (!record.noteB64) {
    if (!wait || !connected) throw new Error("Connect the wallet that sent this payment, then finish its receipt.");
    let out;
    try {
      out = await wait(record.txId);
    } catch (e) {
      const msg = errorText(e);
      // Only a failure the wallet reports for the transaction itself is final. A timeout,
      // a locked or disconnected wallet, or any other error may still be followed by the
      // payment landing, so the record stays and can be finished later.
      const reported = (e as { name?: string }).name === "WalletTransactionError" && !/timed out|not confirmed|timeout/i.test(msg);
      if (reported) {
        clearPending(record.txId);
        throw new Error(`The wallet reports the transaction failed: ${msg}`);
      }
      throw new Error(`The wallet hasn't confirmed the payment yet (${msg}).`);
    }
    const noteBytes = pickPaymentNote(out.outputNotes, {
      recipient: record.recipient, faucetId: record.faucetId, amount: BigInt(record.amount),
    });
    record = { ...record, noteB64: toBase64(noteBytes), chainTxId: out.txHash };
    savePending(record);
    onNoteKnown?.();
  }
  const noteFile = await waitForReceipt((fn) => withRpc(record.network, fn), noteFileFromBase64(record.noteB64!));
  const txId = record.chainTxId && /^0x[0-9a-f]{64}$/.test(record.chainTxId) ? record.chainTxId : undefined;
  const fragment = await encodeReceipt({
    v: 1,
    network: record.network,
    noteFile: toBase64(noteFile),
    memo: record.memo,
    createdAt: record.createdAt,
    txId,
  }, password || undefined);
  const url = receiptUrl(window.location.origin, fragment);
  saveRecent({ url, createdAt: record.createdAt, amount: record.amount, recipient: record.recipient, network: record.network });
  clearPending(record.txId);
  return url;
}

/** A form input that a payment request can lock (read-only, with the request's value). */
function FormInput({ label, value, onChange, placeholder, locked }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; locked?: boolean;
}) {
  const id = useId();
  return (
    <div className={locked ? "input input-locked" : "input"}>
      <span className="input-label">
        <label htmlFor={id}>{label}</label>
        {locked && <span className="lock-tag">from the request</span>}
      </span>
      <input
        id={id}
        value={value}
        readOnly={locked}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
      />
    </div>
  );
}

type RequestState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ok"; req: PaymentRequestV1 }
  | { status: "error"; message: string };

const requestHash = () => (typeof window !== "undefined" && isRequestFragment(window.location.hash) ? window.location.hash : "");

/** The payment request in the URL fragment (`#q1.…`), decoded; follows hash changes. */
function usePaymentRequest(): { state: RequestState; hash: string; dismiss: () => void } {
  const [hash, setHash] = useState(requestHash);
  const [decoded, setDecoded] = useState<{ hash: string; state: RequestState }>();
  useEffect(() => {
    const onChange = () => setHash(requestHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  useEffect(() => {
    if (!hash) return;
    let live = true;
    decodeRequest(hash).then(
      (req) => live && setDecoded({ hash, state: { status: "ok", req } }),
      (e: unknown) => live && setDecoded({ hash, state: { status: "error", message: errorText(e) } }),
    );
    return () => { live = false; };
  }, [hash]);
  const dismiss = useCallback(() => {
    if (isRequestFragment(window.location.hash)) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setHash("");
  }, []);
  const state: RequestState = !hash ? { status: "none" } : decoded?.hash === hash ? decoded.state : { status: "loading" };
  return { state, hash, dismiss };
}

const plainAmount = (v: bigint, decimals: number) => formatAmount(v, decimals).replace(/,/g, "");

export function PayTool({ network }: { network: Network }) {
  const { connected, address, requestAssets, requestTransaction, waitForTransaction } = useWallet();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [assetsError, setAssetsError] = useState<string>();
  const [faucet, setFaucet] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<Stage>({ step: "form" });
  const [pending, setPending] = useState<PendingPayment[]>(() => loadPending());
  const [recent, setRecent] = useState<RecentReceipt[]>(() => loadRecent());
  const [resumePassword, setResumePassword] = useState("");

  const { state: reqState, hash: reqHash, dismiss: dismissRequest } = usePaymentRequest();
  const req = reqState.status === "ok" ? reqState.req : undefined;
  const reqToken = useTokenInfo(req?.network ?? network, req?.faucetId);
  const [unlockedFor, setUnlockedFor] = useState<string>();
  const reqUsable = !!req && req.network === network;
  /** While set, recipient, token, amount and memo come from the request and can't be changed. */
  const lockedReq = reqUsable && unlockedFor !== reqHash ? req : undefined;
  const reqToHex = useMemo(() => (req ? attempt(req.to, normalizeAccountId).result : undefined), [req]);

  const loadAssets = useCallback(async () => {
    if (!requestAssets) return;
    setAssetsError(undefined);
    try {
      const list = await requestAssets();
      const hs: Holding[] = list.map((a) => ({
        faucetId: normalizeAccountId(a.faucetId),
        walletFaucetId: a.faucetId,
        amount: BigInt(a.amount),
        token: undefined,
      }));
      setHoldings(hs);
      if (hs[0]) setFaucet((f) => f || hs[0].faucetId);
      hs.forEach((h) => void tokenInfo(network, h.faucetId).then((token) =>
        setHoldings((cur) => cur?.map((x) => (x.faucetId === h.faucetId ? { ...x, token } : x)) ?? cur)));
    } catch (e) {
      setAssetsError(errorText(e));
    }
  }, [requestAssets, network]);

  // requestAssets opens a wallet prompt each time, so it only runs on request.
  useEffect(() => {
    if (!connected) setHoldings(null);
  }, [connected]);

  const faucetValue = lockedReq ? lockedReq.faucetId : faucet;
  const holding = holdings?.find((h) => h.faucetId.toLowerCase() === faucetValue.toLowerCase());
  const decimals = holding?.token?.decimals;
  const recipientValue = lockedReq ? lockedReq.to : recipient;
  const amountValue = lockedReq
    ? (decimals !== undefined ? plainAmount(BigInt(lockedReq.amount), decimals) : "")
    : amount;
  const memoValue = lockedReq ? receiptMemoFor(lockedReq) : memo;
  const missingToken = !!lockedReq && !!holdings && holdings.length > 0 && !holding;

  /** "Edit": the request's values become ordinary, editable form values. */
  const unlock = () => {
    if (!lockedReq) return;
    setRecipient(recipientValue);
    setFaucet(faucetValue);
    setAmount(amountValue);
    setMemo(memoValue);
    setUnlockedFor(reqHash);
  };

  const recipientCheck = useMemo(() => attempt(recipientValue, (s) => checkRecipient(s, network)), [recipientValue, network]);
  const pwError = passwordError(password);
  const amountCheck = useMemo(
    () => (decimals === undefined ? {} : attempt(amountValue, (s) => {
      const v = parseAmount(s, decimals);
      if (v <= 0n) throw new Error("Amount must be positive.");
      // The wallet's send request takes a JS number.
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large for a wallet send.");
      return v;
    })),
    [amountValue, decimals],
  );
  const ownAccount = useMemo(() => (address ? attempt(address.split("_")[0], normalizeAccountId).result : undefined), [address]);
  const toSelf = recipientCheck.result !== undefined && recipientCheck.result === ownAccount;
  const overBalance = holding && amountCheck.result !== undefined && amountCheck.result > holding.amount;
  const canPay = connected && address && holding && decimals !== undefined && recipientCheck.result
    && amountCheck.result && !overBalance && !toSelf && !pwError && !(req && !reqUsable);

  const run = async (p: PendingPayment, pw?: string, opts: { startedAt?: number; requester?: string } = {}) => {
    const startedAt = opts.startedAt ?? Date.now();
    let at = p.noteB64 ? 3 : 1;
    setStage({ step: "progress", at, startedAt });
    try {
      const url = await finishReceipt(p, waitForTransaction, connected, pw, () => {
        at = 3;
        setStage({ step: "progress", at, startedAt });
      });
      setPending(loadPending());
      setRecent(loadRecent());
      if (opts.requester) dismissRequest();
      setStage({ step: "done", url, protectedBy: !!pw, requester: opts.requester, startedAt });
    } catch (e) {
      setPending(loadPending());
      setStage({ step: "error", message: errorText(e), saved: loadPending().some((x) => x.txId === p.txId), at, startedAt });
    }
  };

  const pay = async () => {
    if (!canPay || !requestTransaction || !address || !holding || amountCheck.result === undefined || !recipientCheck.result) return;
    const startedAt = Date.now();
    setStage({ step: "progress", at: 0, startedAt });
    let txId: string;
    try {
      const tx = Transaction.createSendTransaction(
        address, toBech32(recipientCheck.result, network), holding.walletFaucetId, "private", Number(amountCheck.result),
      );
      txId = await requestTransaction(tx);
    } catch (e) {
      return setStage({ step: "error", message: `The wallet didn't send the payment. ${errorText(e)}`, at: 0, startedAt });
    }
    const record: PendingPayment = {
      txId,
      network,
      recipient: recipientCheck.result,
      faucetId: holding.faucetId,
      amount: amountCheck.result.toString(),
      memo: memoValue.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    savePending(record);
    setPending(loadPending());
    // The receipt goes back to the requester when this pays their request.
    const requester = req && reqToHex === recipientCheck.result ? req.to : undefined;
    await run(record, password, { startedAt, requester });
  };

  const reset = () => { setStage({ step: "form" }); setAmount(""); setMemo(""); setPassword(""); };

  const busy = stage.step === "progress";
  const showRequest = reqState.status !== "none" && stage.step === "form";

  return (
    <>
    {!connected && stage.step === "form" && reqState.status === "none" && <Hero docsHref="/?tool=docs" />}
    <ToolCard
      title={req && stage.step === "form" ? "Pay a request" : "Make a payment"}
      intro={req && stage.step === "form"
        ? "Someone asked you for a payment. Connect your wallet to pay it privately; you get a receipt link to send back."
        : "Connect your wallet to send a private payment. Its receipt link appears here when the payment is on chain."}
    >
      {showRequest && reqState.status === "loading" && <p className="muted small">Reading the payment request…</p>}
      {showRequest && reqState.status === "error" && (
        <Notice tone="bad">
          This payment request link can't be read: {reqState.message}{" "}
          <button type="button" className="link" onClick={dismissRequest}>Dismiss</button>
        </Notice>
      )}
      {showRequest && req && (
        <RequestCard
          req={req}
          token={reqToken}
          network={network}
          edited={reqUsable && !lockedReq}
          onEdit={connected ? unlock : undefined}
          onDismiss={dismissRequest}
        />
      )}
      {network !== "testnet" && <Notice>Payments run on testnet for now. Switch the network to testnet.</Notice>}
      <WalletButton />

      {pending.length > 0 && !busy && (
        <Notice tone="info">
          {pending.length === 1 ? "A payment" : `${pending.length} payments`} from an earlier visit still need a receipt.
          {!connected && pending.some((p) => !p.noteB64) && " Connect the wallet that sent it to finish."}
          {pending.map((p) => (
            <div key={p.txId} className="pending">
              <span>{p.amount} base units to <code>{toBech32(p.recipient, p.network).slice(0, 16)}…</code></span>
              <button
                type="button"
                className="link"
                disabled={(!p.noteB64 && !connected) || !!passwordError(resumePassword)}
                title={!p.noteB64 && !connected ? "Connect the wallet that sent it first" : undefined}
                onClick={() => void run(p, resumePassword || undefined)}
              >
                finish receipt
              </button>
              <button type="button" className="link" onClick={() => { clearPending(p.txId); setPending(loadPending()); }}>discard</button>
            </div>
          ))}
          <div className="input pending-pw">
            <label htmlFor="resume-pw" className="input-label">Receipt password (optional)</label>
            <input id="resume-pw" type="password" value={resumePassword} onChange={(e) => setResumePassword(e.target.value)} autoComplete="new-password" />
          </div>
          {passwordError(resumePassword) && <span className="small">{passwordError(resumePassword)}</span>}
        </Notice>
      )}

      {recent.length > 0 && stage.step === "form" && (
        <details className="recent">
          <summary>Receipts made in this browser ({recent.length})</summary>
          <p className="muted small">Kept only in this browser so a closed tab doesn't lose a link. Anyone who can use this browser can open them.</p>
          {recent.map((r) => (
            <div key={r.url} className="pending">
              <span className="small">{new Date(r.createdAt).toLocaleString()} · {r.amount} base units to <code>{toBech32(r.recipient, r.network).slice(0, 14)}…</code></span>
              <a className="link" href={r.url.slice(r.url.indexOf("/r#"))}>open</a>
              <button type="button" className="link" onClick={() => void navigator.clipboard?.writeText(r.url).catch(() => undefined)}>copy</button>
              <button type="button" className="link" onClick={() => { removeRecent(r.url); setRecent(loadRecent()); }}>remove</button>
            </div>
          ))}
        </details>
      )}

      {connected && network === "testnet" && stage.step === "form" && !(req && !reqUsable) && (
        <div className="stack">
          {!holdings && (
            <div><button type="button" className="btn" onClick={() => void loadAssets()}>Load my tokens</button>
              <span className="muted small"> Your wallet asks before sharing balances.</span></div>
          )}
          {assetsError && <Notice tone="bad">Couldn't read the wallet's assets: {assetsError}</Notice>}
          {holdings && holdings.length === 0 && (
            <Notice>This account has no assets yet.{lockedReq && ` This request asks for ${requestAmountText(lockedReq, reqToken)}.`}</Notice>
          )}
          {missingToken && lockedReq && (
            <Notice tone="bad">
              Your wallet doesn't hold {reqToken?.symbol ?? "the token"} this request asks for
              ({requestAmountText(lockedReq, reqToken)}), so it can't be paid from this account.
              Faucet <code>{toBech32(lockedReq.faucetId, network)}</code>.
            </Notice>
          )}
          {holdings && holdings.length > 0 && !missingToken && (
            <div className={lockedReq ? "input input-locked" : "input"}>
              <span className="input-label">
                <label htmlFor="pay-token">Token</label>
                {lockedReq && <span className="lock-tag">from the request</span>}
              </span>
              <select id="pay-token" value={faucetValue} disabled={!!lockedReq} onChange={(e) => setFaucet(e.target.value)}>
                {holdings.map((h) => (
                  <option key={h.faucetId} value={h.faucetId}>
                    {h.token
                      ? `${h.token.symbol}${h.token.verified ? "" : " (unverified)"} · balance ${formatAmount(h.amount, h.token.decimals)}`
                      : `${h.faucetId.slice(0, 12)}… · ${h.amount} base units`}
                  </option>
                ))}
              </select>
              {holding && holding.token === null && <span className="small muted">Unknown token: decimals can't be determined, so it can't be sent from here.</span>}
              {holding?.token && !holding.token.verified && !lockedReq && (
                <Notice>
                  Unverified token: its name and decimals were set by whoever created it, and it isn't in the official
                  token list. Faucet <code>{toBech32(holding.faucetId, network)}</code>.
                </Notice>
              )}
            </div>
          )}
          <FormInput label="Recipient address" value={recipientValue} onChange={setRecipient} placeholder="mtst1…" locked={!!lockedReq} />
          {recipientCheck.error && <Notice tone="bad">{recipientCheck.error}</Notice>}
          <FormInput
            label={`Amount${holding?.token ? ` (${holding.token.symbol})` : ""}`}
            value={amountValue}
            onChange={setAmount}
            placeholder={lockedReq ? requestAmountText(lockedReq, reqToken) : "10.5"}
            locked={!!lockedReq}
          />
          {amountCheck.error && <Notice tone="bad">{amountCheck.error}</Notice>}
          {overBalance && <Notice tone="bad">More than the balance.</Notice>}
          {toSelf && <Notice tone="bad">That's the connected account.</Notice>}
          <FormInput
            label={`Memo for the receipt (optional, up to ${MEMO_MAX} characters)`}
            value={memoValue}
            onChange={(v) => setMemo(v.slice(0, MEMO_MAX))}
            placeholder="Invoice #42"
            locked={!!lockedReq}
          />
          <div className="input">
            <label htmlFor="pay-pw" className="input-label">Receipt password (optional)</label>
            <input id="pay-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
          {pwError && <Notice tone="bad">{pwError}</Notice>}
          <div className="badges">
            <Badge>private P2ID note</Badge>
            <Badge>fee paid by the wallet</Badge>
          </div>
          <p className="muted small">Your wallet shows its usual send screen. Check the amount and recipient before you approve.</p>
          <div><button type="button" className="btn btn-primary" disabled={!canPay} onClick={() => void pay()}>Review in wallet</button></div>
        </div>
      )}

      {stage.step === "progress" && <PayStepper at={stage.at} startedAt={stage.startedAt} status="running" />}
      {stage.step === "error" && (
        <div className="stack">
          <PayStepper at={stage.at} startedAt={stage.startedAt} status="failed" />
          <Notice tone="bad">{stage.message}</Notice>
          {stage.saved && <p className="muted small">If the payment still goes through, you can finish its receipt later from this page. Don't send it again.</p>}
          <div><button type="button" className="btn" onClick={reset}>Back</button></div>
        </div>
      )}
      {stage.step === "done" && (
        <div className="stack pay-done">
          <PayStepper at={4} startedAt={stage.startedAt} status="done" />
          <div className="status status-good pay-done-status">
            <span className="pay-slip" aria-hidden="true">
              <svg viewBox="0 0 40 40" focusable="false">
                <path className="pay-slip-slot" d="M6 7h28" />
                <g className="pay-slip-paper">
                  <path className="pay-slip-body" d="M11 7h18v24l-3-2-3 2-3-2-3 2-3-2-3 2z" />
                  <path className="pay-slip-check" d="M15 18l3.5 3.5L25 15" pathLength={1} />
                </g>
              </svg>
            </span>
            <div>
              <h2>Payment committed</h2>
              <p className="muted">
                {stage.requester
                  ? <>Send this receipt back to <code title={stage.requester}>{shortAddress(stage.requester)}</code> so they can check the payment.</>
                  : "Share the receipt with the recipient or your accountant."}
              </p>
            </div>
          </div>
          <div className="pay-reveal">
            <ReceiptLink url={stage.url} />
            <p className="muted small">
              Anyone with this link{stage.protectedBy ? " and the password" : ""} can see this payment.
              Your wallet also delivers the note to the recipient privately; if that doesn't arrive, the recipient
              can import it from this link.
            </p>
            <div><button type="button" className="btn" onClick={reset}>New payment</button></div>
          </div>
        </div>
      )}
    </ToolCard>
    </>
  );
}
