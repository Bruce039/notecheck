import { useState } from "react";
import { Badge, Field, Notice, TextInput, ToolCard } from "@/components/ui";
import type { Network } from "@/lib/network";
import { withRpc } from "@/lib/rpc";
import { checkAccountAllowed, type AllowlistResult } from "./allowlist";

const EXAMPLE = "mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk_qr7qqq9wr6w";

type Outcome = { network: Network; input: string } & ({ result: AllowlistResult } | { error: string });

export function AllowlistTool({ network }: { network: Network }) {
  const [input, setInput] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  // Only show an answer for what is on screen now.
  const shown = outcome?.network === network && outcome.input === input ? outcome : null;

  async function check() {
    const net = network, raw = input;
    setLoading(true);
    try {
      const result = await withRpc(net, (rpc) => checkAccountAllowed(rpc, raw));
      setOutcome({ network: net, input: raw, result });
    } catch (e) {
      setOutcome({ network: net, input: raw, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolCard
      title="Allowlist"
      intro={`Can this account be created on ${network}? Nodes may gate account creation behind an allowlist.`}
    >
      <TextInput label="Account (address or 0x ID)" value={input} onChange={setInput}
        placeholder="mtst1… or 0x…" example={EXAMPLE} />
      {network === "mainnet" ? (
        <Notice tone="info">Mainnet RPC is not public yet, so this can't be checked.</Notice>
      ) : (
        <p className="small">
          <button type="button" className="btn btn-primary" onClick={check} disabled={loading || !input.trim()}>
            {loading ? "Checking…" : `Check on ${network}`}
          </button>
        </p>
      )}
      {shown && "error" in shown && <Notice tone="bad">{shown.error}</Notice>}
      {shown && "result" in shown && (
        <>
          <div className="badges">
            {shown.result.allowed
              ? <Badge tone="good">can be created</Badge>
              : <Badge tone="bad">not allowed</Badge>}
          </div>
          <Field label="Account ID (hex)" value={shown.result.hex} />
          <Notice tone="info">
            {shown.result.allowed
              ? `The ${network} node would accept this account's creation. That is also the answer when the node enforces no allowlist, so it doesn't prove the account is registered.`
              : `The ${network} node enforces an allowlist and this account is not registered, so a transaction creating it would be rejected.`}
          </Notice>
        </>
      )}
      <p className="muted small">
        Only account creation is gated: an account that already exists on chain keeps working
        whatever this says. Invite codes can't be checked without spending them in SDK 0.17, so this
        tool doesn't ask for one.
      </p>
    </ToolCard>
  );
}
