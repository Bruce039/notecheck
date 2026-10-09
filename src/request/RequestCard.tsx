import { Notice } from "@/components/ui";
import type { Network } from "@/lib/network";
import type { TokenInfo } from "@/lib/tokens";
import { requestAmountText, shortAddress } from "./display";
import { toBech32 } from "@/tools/address/account";
import type { PaymentRequestV1 } from "./format";
import "./request.css";

/** The request a payer is looking at, with the checks they should make before paying it. */
export function RequestCard({ req, token, network, edited, onEdit, onDismiss }: {
  req: PaymentRequestV1;
  token: TokenInfo | null | undefined;
  network: Network;
  edited: boolean;
  onEdit?: () => void;
  onDismiss: () => void;
}) {
  const mismatch = req.network !== network;
  return (
    <section className="req-card" aria-label="Payment request">
      <div className="req-card-head">
        <span className="req-card-kicker">Payment request</span>
        <span className="req-card-actions">
          {onEdit && !edited && !mismatch && <button type="button" className="link" onClick={onEdit}>Edit</button>}
          <button type="button" className="link" onClick={onDismiss}>Dismiss</button>
        </span>
      </div>
      <p className="req-card-line">
        <code title={req.to}>{shortAddress(req.to)}</code> requests{" "}
        <strong className="req-card-amount">{requestAmountText(req, token)}</strong>
        {req.memo && <span className="req-card-memo"> · {req.memo}</span>}
        {req.ref && <span className="req-card-ref"> · ref {req.ref}</span>}
      </p>
      <div className="req-card-to small">
        <span className="muted">Pays to</span> <code>{req.to}</code>
      </div>
      <p className="req-card-check small">Check the recipient address with the person who sent you this request.</p>
      {mismatch && (
        <Notice tone="bad">This request is for {req.network}. Switch the network at the top to {req.network} to pay it.</Notice>
      )}
      {token === null && (
        <Notice tone="bad">
          Unknown token: its decimals can't be determined, so this request can't be paid from here.
          Faucet <code>{toBech32(req.faucetId, req.network)}</code>.
        </Notice>
      )}
      {token && !token.verified && (
        <div className="notice notice-warn req-card-unverified" role="alert">
          <strong>Unverified token.</strong> Anyone can create a token called {token.symbol}; its name and decimals were
          set by whoever created it, and it isn't in the official token list. Make sure this is the token you mean to
          pay with. Faucet <code>{toBech32(req.faucetId, req.network)}</code>.
        </div>
      )}
      {edited && <p className="small muted">You changed the request's details. Check them before you pay.</p>}
    </section>
  );
}
