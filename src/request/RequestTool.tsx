import { useId, useMemo, useState, type ReactNode } from "react";
import { useWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { Badge, Notice, TextInput, ToolCard } from "@/components/ui";
import { attempt } from "@/lib/attempt";
import { QrCode } from "./QrCode";
import { RequestLink } from "./RequestLink";
import { useTokenInfo } from "./useTokenInfo";
import "./request.css";
import {
  encodeRequest, FEE_FAUCETS, formatAmount, HRP, MEMO_MAX, type Network, parseAccountId, parseAmount,
  type PaymentRequestV1, REF_MAX, release, requestUrl, toBech32,
} from "notecheck";

/** An address or ID on `network`, as its 0x hex. Bech32 input from another network is refused. */
function checkOnNetwork(raw: string, network: Network, what: string): string {
  const { id, input } = parseAccountId(raw);
  const hex = id.toString().toLowerCase();
  release(id);
  if (input.kind === "bech32" && input.hrp !== HRP[network]) {
    throw new Error(`This ${what} is for ${input.network ?? input.hrp} (${input.hrp}1…); the request is on ${network} (${HRP[network]}1…).`);
  }
  return hex;
}

const plain = (address: string | null | undefined) => (address ? address.split("_")[0] : "");

/** Text input with an optional quick action next to its label. */
function Input({ label, value, onChange, placeholder, action }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; action?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="input">
      <span className="input-label"><label htmlFor={id}>{label}</label>{action}</span>
      <input
        id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        spellCheck={false} autoComplete="off" autoCapitalize="off"
      />
    </div>
  );
}

export function RequestTool({ network }: { network: Network }) {
  const { connected, address } = useWallet();
  const own = connected ? plain(address) : "";
  const fee = FEE_FAUCETS[network];
  const [to, setTo] = useState(own);
  const [faucet, setFaucet] = useState(() => (fee ? toBech32(fee, network) : ""));
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [ref, setRef] = useState("");
  const [made, setMade] = useState<{ key: string; url: string }>();
  const [error, setError] = useState<string>();

  const toCheck = useMemo(() => attempt(to, (s) => checkOnNetwork(s, network, "address")), [to, network]);
  const faucetCheck = useMemo(() => attempt(faucet, (s) => checkOnNetwork(s, network, "token")), [faucet, network]);
  const token = useTokenInfo(network, faucetCheck.result);
  const amountCheck = useMemo(
    () => (!token ? {} : attempt(amount, (s) => {
      const v = parseAmount(s, token.decimals);
      if (v <= 0n) throw new Error("Amount must be positive.");
      // The payer's wallet takes the amount as a JS number.
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large for a wallet send.");
      return v;
    })),
    [amount, token],
  );

  const request: PaymentRequestV1 | undefined = toCheck.result && faucetCheck.result && amountCheck.result
    ? {
      v: 1,
      network,
      to: toBech32(toCheck.result, network),
      faucetId: faucetCheck.result,
      amount: amountCheck.result.toString(),
      ...(memo.trim() ? { memo: memo.trim() } : {}),
      ...(ref.trim() ? { ref: ref.trim() } : {}),
    }
    : undefined;
  const key = request ? JSON.stringify(request) : "";
  const link = made && made.key === key ? made.url : undefined;

  const create = async () => {
    if (!request) return;
    setError(undefined);
    try {
      const fragment = await encodeRequest({ ...request, createdAt: new Date().toISOString() });
      setMade({ key, url: requestUrl(window.location.origin, fragment) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ToolCard
      title="Request a payment"
      intro="Make a link that asks for a payment. Whoever opens it gets the Pay form filled in; when they pay, they get a receipt link to send back to you."
    >
      <div className="stack">
        <div>
          <Input
            label="Your address (where the payment goes)" value={to} onChange={setTo} placeholder={`${HRP[network]}1…`}
            action={own && plain(to) !== own && (
              <button type="button" className="link" onClick={() => setTo(own)}>use connected wallet</button>
            )}
          />
          {toCheck.error && <Notice tone="bad">{toCheck.error}</Notice>}
        </div>

        <div>
          <Input
            label="Token (faucet ID)" value={faucet} onChange={setFaucet} placeholder="0x…"
            action={fee && <button type="button" className="link" onClick={() => setFaucet(toBech32(fee, network))}>use {network} USDCX</button>}
          />
          {faucetCheck.error && <Notice tone="bad">{faucetCheck.error}</Notice>}
          {faucetCheck.result && token === undefined && <p className="muted small req-token">Looking up the token…</p>}
          {faucetCheck.result && token === null && (
            <Notice tone="bad">Unknown token: its decimals can't be determined, so a request can't be made for it here.</Notice>
          )}
          {token && (
            <div className="badges req-token">
              <Badge tone={token.verified ? "good" : "warn"}>{token.verified ? "verified" : "unverified"}</Badge>
              <Badge>{token.symbol}</Badge>
              <Badge>{token.decimals} decimals</Badge>
              {token.name && <Badge>{token.name}</Badge>}
            </div>
          )}
          {token && !token.verified && (
            <Notice>
              Unverified token: its name and decimals were set by whoever created it, and it isn't in the official token list.
              The person paying will see the same warning.
            </Notice>
          )}
        </div>

        <div>
          <TextInput label={`Amount${token ? ` (${token.symbol})` : ""}`} value={amount} onChange={setAmount} placeholder="10.5" />
          {amountCheck.error && <Notice tone="bad">{amountCheck.error}</Notice>}
        </div>
        <TextInput label={`Memo (optional, up to ${MEMO_MAX} characters)`} value={memo} onChange={(v) => setMemo(v.slice(0, MEMO_MAX))} placeholder="Design work, October" />
        <TextInput label={`Reference (optional, up to ${REF_MAX} characters)`} value={ref} onChange={(v) => setRef(v.slice(0, REF_MAX))} placeholder="INV-0042" />

        <div><button type="button" className="btn btn-primary" disabled={!request} onClick={() => void create()}>Create request link</button></div>
        {error && <Notice tone="bad">{error}</Notice>}

        {link && request && token && (
          <div className="req-out">
            <div className="req-out-main">
              <p className="req-summary">
                Asking for <strong>{formatAmount(BigInt(request.amount), token.decimals)} {token.symbol}</strong>
                {request.memo && <> · {request.memo}</>}
                {request.ref && <> · ref {request.ref}</>}
              </p>
              <RequestLink url={link} />
              <p className="muted small">
                Send this to the person who pays you. When they pay, they get a receipt link to send back.
              </p>
              <p className="muted small">
                The link only describes the payment; nothing is sent or reserved. Anyone with it can see the amount,
                memo and your address.
              </p>
            </div>
            <figure className="req-qr">
              <div className="req-qr-tile"><QrCode text={link} label="QR code of the request link" /></div>
              <figcaption className="muted small">Scan to open the request</figcaption>
            </figure>
          </div>
        )}
      </div>
    </ToolCard>
  );
}
