import { useMemo, useState } from "react";
import { Badge, Field, Notice, TextInput, ToolCard } from "@/components/ui";
import { attempt } from "@/lib/attempt";
import { HRP, NETWORKS, type Network } from "@/lib/network";
import { toHex64 } from "@/tools/felt/felt";
import { accountTag } from "@/tools/tag/tag";
import { AccountAnatomy } from "./AccountAnatomy";
import { decodeAccount } from "./account";

const EXAMPLE = "mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk_qr7qqq9wr6w";

export function AddressTool({ network }: { network: Network }) {
  const [input, setInput] = useState("");
  const { result: a, error } = useMemo(() => attempt(input, decodeAccount), [input]);
  const others = NETWORKS.filter((n) => n !== network);
  const tagHex = a ? accountTag(a.hex).hex : "";

  return (
    <ToolCard
      title="Address / Account ID"
      intro="Paste a bech32 address (mtst1…, mm1…, mdev1…) or a 0x account ID. Everything is decoded locally."
    >
      <TextInput label="Address or account ID" value={input} onChange={setInput}
        placeholder="mtst1… or 0x…" example={EXAMPLE} />
      {error && <Notice tone="bad">{error}</Notice>}
      {a && (
        <>
          {a.input.kind === "bech32" && a.input.network !== network && (
            <Notice>
              This address uses the <code>{a.input.hrp}</code> prefix
              {a.input.network ? ` (${a.input.network})` : " (unknown network)"}, but you're on {network}.
              The account ID is the same on every network; only the prefix differs.
            </Notice>
          )}
          <div className="badges">
            <Badge tone={a.visibility === "public" ? "good" : "neutral"}>{a.visibility} state</Badge>
            <Badge>ID version {a.version}</Badge>
            {a.assetCallbacks && <Badge tone="warn">asset callbacks</Badge>}
          </div>
          <div className="grid">
            <Field label="Account ID (hex)" value={a.hex} />
            <Field label={`Address · ${network} (${HRP[network]})`} value={a.bech32[network]} />
            <Field label={`Wallet address · ${network}`} value={a.bech32Wallet[network]}
              hint="Same account with the BasicWallet interface suffix, as wallets display it." />
            <Field label="Prefix felt" value={a.prefix.toString()} hint={toHex64(a.prefix)} />
            <Field label="Suffix felt" value={a.suffix.toString()} hint={toHex64(a.suffix)} />
            <Field label="Default note tag" value={tagHex}
              hint="P2ID notes to this account carry this tag (top 14 bits of the prefix)." />
          </div>
          <AccountAnatomy key={a.hex} prefix={a.prefix} suffix={a.suffix} version={a.version}
            visibility={a.visibility} assetCallbacks={a.assetCallbacks} tagHex={tagHex} />
          <details>
            <summary>Other networks</summary>
            <div className="grid">
              {others.map((n) => <Field key={n} label={`${n} (${HRP[n]})`} value={a.bech32[n]} />)}
            </div>
          </details>
          <p className="muted small">
            Since protocol v0.17 an ID only encodes public/private state, the asset callback flag and the
            version. Whether it's a wallet or a faucet is not part of the ID.
          </p>
        </>
      )}
    </ToolCard>
  );
}
