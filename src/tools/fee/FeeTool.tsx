import { useEffect, useMemo, useRef, useState } from "react";
import { Field, Notice, TextInput, ToolCard } from "@/components/ui";
import { attempt } from "@/lib/attempt";
import type { Network } from "@/lib/network";
import { withRpc } from "@/lib/rpc";
import { release } from "@/lib/wasm";
import { computeFee, parseBaseFee, parseCycles } from "./fee";

type Fetched = { network: Network; block: number; baseFee: string };

export function FeeTool({ network }: { network: Network }) {
  const [cycles, setCycles] = useState("");
  const [baseFee, setBaseFee] = useState("");
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [fetchError, setFetchError] = useState<{ network: Network; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const current = useRef(network);
  useEffect(() => { current.current = network; }, [network]);

  const c = useMemo(() => attempt(cycles, parseCycles), [cycles]);
  const b = useMemo(() => attempt(baseFee, parseBaseFee), [baseFee]);
  const fee = c.result !== undefined && b.result !== undefined ? computeFee(c.result, b.result) : null;
  const fromChain = fetched?.network === network && fetched.baseFee === baseFee.trim() ? fetched : null;
  const error = fetchError?.network === network ? fetchError.message : null;

  async function fetchBaseFee() {
    const net = network;
    setLoading(true);
    setFetchError(null);
    try {
      const r = await withRpc(net, async (rpc) => {
        const header = await rpc.getBlockHeaderByNumber();
        try {
          return { block: header.blockNum(), baseFee: String(header.verificationBaseFee()) };
        } finally { release(header); }
      });
      if (current.current !== net) return;
      setFetched({ network: net, ...r });
      setBaseFee(r.baseFee);
    } catch (e) {
      setFetchError({ network: net, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolCard
      title="Fee"
      intro="A transaction pays the verification base fee once per power of two of its cycle count."
    >
      <TextInput label="Transaction cycles" value={cycles} onChange={setCycles}
        placeholder="65536" example="100000" />
      {c.error && <Notice tone="bad">{c.error}</Notice>}

      <TextInput label="Verification base fee (base units)" value={baseFee} onChange={setBaseFee}
        placeholder="from the latest block header" />
      {network === "mainnet" ? (
        <Notice tone="info">Mainnet RPC is not public yet. Enter the base fee manually.</Notice>
      ) : (
        <p className="small">
          <button type="button" className="btn" onClick={fetchBaseFee} disabled={loading}>
            {loading ? "Fetching…" : `Fetch from ${network}`}
          </button>
          {fromChain && <span className="muted"> · block {fromChain.block}</span>}
        </p>
      )}
      {error && <Notice tone="bad">Could not read the block header: {error}</Notice>}
      {b.error && <Notice tone="bad">{b.error}</Notice>}

      {fee && (
        <>
          <div className="grid">
            <Field label="Fee (base units)" value={fee.fee.toString()}
              hint="Raw amount of the network's fee asset; its decimals are not applied." />
            <Field label="Formula" copy={false}
              value={`${fee.baseFee} × (⌊log₂ ${fee.cycles}⌋ + 1) = ${fee.baseFee} × ${fee.logCycles} = ${fee.fee}`} />
            <Field label="Same fee for" copy={false}
              value={`${fee.stepMin} – ${fee.stepMax} cycles`} />
            <Field label="Next step" copy={false}
              value={fee.nextStep === null
                ? "none (2^29 cycle limit)"
                : `${fee.nextStep} cycles (${fee.cyclesUntilNext} more) → ${fee.baseFee * BigInt(fee.logCycles + 1)}`} />
          </div>
          <p className="muted small">
            Formula from miden-protocol v0.17.1 (<code>TransactionFee</code>, kernel <code>compute_fee</code>).
            The kernel counts cycles when the fee is computed, plus the caller's estimate of the cycles
            still to run. The output-notes part of the fee is zero in this version.
          </p>
        </>
      )}
    </ToolCard>
  );
}
