import { useState, type ChangeEvent } from "react";
import { ExplorerLink } from "@/components/ExplorerLink";
import { ReceiptLink } from "@/components/ReceiptLink";
import { EXAMPLE_RECEIPT_PATH } from "./example";
import { Badge, Field, Notice, TextInput, ToolCard } from "@/components/ui";
import type { Network } from "@/lib/network";
import { withRpc } from "@/lib/rpc";
import { toBase64 } from "./bytes";
import { MEMO_MAX, encodeReceipt, receiptUrl } from "./format";
import { inspectNoteFileBytes, noteFileFromBase64, type NoteSummary } from "./inspect";
import { verifyReceipt, type Verification } from "./verify";

type Loaded = { bytes: Uint8Array; summary: NoteSummary; check?: Verification | { status: "error"; message: string } };

export function ReceiptsTool({ network }: { network: Network }) {
  return (
    <ToolCard
      title="Receipts"
      intro="A receipt is a link that lets someone check a private payment on chain without seeing the rest of your account."
    >
      <OpenReceipt />
      <CreateReceipt key={network} network={network} />
    </ToolCard>
  );
}

function OpenReceipt() {
  const [link, setLink] = useState("");
  const fragment = link.includes("#") ? link.slice(link.indexOf("#") + 1) : link.trim();
  return (
    <>
      <h3>Check a receipt</h3>
      <TextInput label="Receipt link" value={link} onChange={setLink} placeholder="https://…/r#r1.…" />
      <div className="link-actions">
        {fragment
          ? <a className="btn" href={`/r#${fragment}`}>Open</a>
          : <button type="button" className="btn" disabled>Open</button>}
        <a className="small" href={EXAMPLE_RECEIPT_PATH}>See an example receipt</a>
      </div>
    </>
  );
}

function CreateReceipt({ network }: { network: Network }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string>();
  const [pasted, setPasted] = useState("");
  const [memo, setMemo] = useState("");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = async (bytes: Uint8Array) => {
    setError(undefined); setUrl(undefined); setLoaded(null);
    let summary: NoteSummary;
    try {
      summary = inspectNoteFileBytes(bytes);
    } catch (e) {
      const code = (e as { code?: string }).code;
      return setError(code === "malformed"
        ? "That isn't a Miden note file. Export one with the Miden CLI: miden export --note <id> --export-type full (it writes <id>.mno)."
        : (e as Error).message);
    }
    setLoaded({ bytes, summary });
    if (network === "mainnet") return;
    try {
      const check = await withRpc(network, (rpc) => verifyReceipt(rpc, bytes));
      setLoaded({ bytes, summary, check });
    } catch (e) {
      setLoaded({ bytes, summary, check: { status: "error", message: (e as Error).message } });
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 64 * 1024) {
      setLoaded(null); setUrl(undefined);
      return setError(`"${file.name}" isn't a Miden note file (they're about 0.5 KB, exported from the Miden CLI as .mno).`);
    }
    await load(new Uint8Array(await file.arrayBuffer()));
  };

  const onPaste = async () => {
    try {
      await load(noteFileFromBase64(pasted.trim()));
    } catch (e) {
      // Don't leave a previously read note on screen next to this error.
      setLoaded(null); setUrl(undefined);
      setError((e as Error).message);
    }
  };

  const create = async () => {
    if (!loaded) return;
    setBusy(true);
    try {
      const fragment = await encodeReceipt({
        v: 1,
        network,
        noteFile: toBase64(loaded.bytes),
        memo: memo.trim() || undefined,
        createdAt: new Date().toISOString(),
      }, password || undefined);
      setUrl(receiptUrl(window.location.origin, fragment));
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const check = loaded?.check;
  return (
    <>
      <h3>For developers: receipt from a CLI note file</h3>
      <p className="muted small">
        Payments made in the Pay tab get a receipt automatically. Use this if you sent a note with the Miden CLI:
        {" "}<code>miden export --note &lt;id&gt; --export-type full</code> writes <code>&lt;id&gt;.mno</code>.
        Only P2ID and P2IDE notes are accepted: a receipt reveals the note's secrets, which is only safe when the note
        can be consumed by its target alone.
      </p>
      <div className="input">
        <label htmlFor="notefile" className="input-label">Note file (.mno)</label>
        <input id="notefile" type="file" accept=".mno,application/octet-stream" onChange={(e) => void onFile(e)} />
      </div>
      <TextInput label="…or paste it as base64" value={pasted} onChange={setPasted} placeholder="CsgDGsUD…" />
      {pasted.trim() && <div><button type="button" className="btn" onClick={() => void onPaste()}>Read</button></div>}
      {error && <Notice tone="bad">{error}</Notice>}

      {loaded && (
        <div className="stack">
          <div className="badges">
            <Badge>{loaded.summary.kind}</Badge>
            {check === undefined && network !== "mainnet" && <Badge>checking {network}…</Badge>}
            {check?.status === "included" && <Badge tone="good">on {network}, block {check.inclusionBlock.toLocaleString("en-US")}</Badge>}
            {check?.status === "not-found" && <Badge tone="bad">not found on {network}</Badge>}
            {check?.status === "mismatch" && <Badge tone="bad">does not match chain</Badge>}
            {check?.status === "error" && <Badge tone="warn">couldn't reach {network}</Badge>}
          </div>
          {check?.status === "not-found" && (
            <Notice>This note isn't on {network} (yet). The link will show "not found" until it is committed. Check the network selector.</Notice>
          )}
          <Field label="Note ID" value={loaded.summary.noteId} />
          <ExplorerLink network={network} kind="note" id={loaded.summary.noteId}>See the note on Midenscan</ExplorerLink>
          <TextInput label={`Memo (optional, up to ${MEMO_MAX} characters)`} value={memo} onChange={(v) => setMemo(v.slice(0, MEMO_MAX))} placeholder="Invoice #42" />
          <div className="input">
            <label htmlFor="receipt-new-pw" className="input-label">Password (optional)</label>
            <input id="receipt-new-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
          {password && password.length < 8 && <Notice tone="bad">Use at least 8 characters: anyone with the link can try passwords offline.</Notice>}
          {password && <p className="muted small">Send the password through a different channel than the link.</p>}
          <div><button type="button" className="btn btn-primary" disabled={busy || (!!password && password.length < 8)} onClick={() => void create()}>Create link</button></div>
          {url && (
            <>
              <ReceiptLink url={url} />
              <p className="muted small">
                Anyone with this link{password ? " and the password" : ""} can see this payment's amount, sender and recipient.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
