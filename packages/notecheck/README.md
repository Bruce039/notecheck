# notecheck

Verifiable private payment receipts and payment requests for [Miden](https://miden.xyz), as a
library and a command-line tool. It is the code behind
[NoteCheck](https://notecheck-miden.vercel.app).

Miden payments are private: the chain doesn't show who paid whom or how much. A NoteCheck
receipt is a link that carries one payment note. Whoever opens it can check the amount, the
recipient and the sender against the Miden network, and learns nothing else about either
account. A payment request is a link that asks for a payment.

- Verify receipt links, in the browser or in Node.
- Make receipt links from a wallet-reported note or a `miden export` note file.
- Make and read payment request links.
- The formats are specified in [SPEC.md](./SPEC.md).

> Testnet only for now: mainnet has no public RPC yet. Independent project, not affiliated with Miden.

## Install

```
npm i notecheck @miden-sdk/miden-sdk
```

`@miden-sdk/miden-sdk` (0.17.3 or a later 0.17) is a peer dependency. In Node (22 or newer) the
SDK uses its native binding, published for macOS (arm64, x64) and Linux x64 (glibc). In the
browser it loads its WASM build; with Vite, add `@miden-sdk/vite-plugin`.

## Verify a receipt

```ts
import { verifyReceipt } from "notecheck";

const check = await verifyReceipt("https://notecheck-miden.vercel.app/r#r1.H4sI…");
// or: verifyReceipt(link, { password }) for an r1e. link

if (check.status === "confirmed") {
  const [a] = check.amount;
  console.log(`${a.formatted} ${a.symbol} to ${check.recipient.bech32}, block ${check.inclusionBlock}`);
}
```

`verifyReceipt` returns plain JSON:

| Field | |
|-------|-|
| `status` | `"confirmed"`: on chain, and the funds can only go (or went) to the recipient. `"committed-reclaimable"`: on chain, but a P2IDE note whose funds can go, or may have gone, back to the reclaimer. `"not-found"` and `"mismatch"`: not confirmed. |
| `amount` | `[{ faucetId, amount, symbol?, decimals?, formatted?, verified }]`, `amount` in base units as a string. `verified` is true for tokens in the official token list and the network's fee token. |
| `recipient`, `sender` | `{ bech32, hex }` |
| `inclusionBlock`, `inclusionTime` | From the node; time as ISO 8601. |
| `spentAt`, `spentTime`, `received` | Whether and when the note was consumed. `received` is `"yes"`, `"maybe"` (P2IDE consumed after the reclaim block) or `"no"`. |
| `reclaim`, `timelockHeight`, `tip` | P2IDE details and the chain tip they were compared with. |
| `claims` | `{ memo?, createdAt?, txId? }`: the sender's statements, **not checked**. |
| `explorer` | `{ note, tx? }` Midenscan links. |

It throws for links that can't be read (damaged, wrong or missing password, not a P2ID/P2IDE
note) and for RPC errors, after one retry of a transient one. Options: `password`, `network`
(refuse receipts for other networks), `rpc` (your own `RpcClient`), `tokens` (your own token
lookup, or `false` to skip it).

The lower-level `verifyNoteFile(rpc, noteFileBytes)` checks a note file directly.

## Create a receipt from a wallet-reported note

After a send, the Miden wallet reports the transaction's output notes. Pick the payment note
and make a receipt once it is committed:

```ts
import { createReceipt, pickPaymentNote } from "notecheck";

const { outputNotes } = await wallet.waitForTransaction(txId);
const note = pickPaymentNote(outputNotes, { recipient, faucetId, amount: 1_500_000n });

const { url, noteId } = await createReceipt({
  network: "testnet",
  note,                       // an SDK Note or its serialized bytes
  memo: "Invoice #42",
  password: undefined,        // optional, at least 8 characters
});
```

`createReceipt` waits until the note is committed (polling every 3 s, up to 3 minutes; pass
`wait: { timeoutMs, intervalMs, signal }`, or `wait: false` to check once) and packs it with the
node's inclusion proof. With `noteFile` instead of `note` (a Full note file, e.g. from
`miden export --note <id> --export-type full`), it checks that the note is on chain as described.
Only P2ID and P2IDE notes are accepted: a receipt reveals the note's details, which is only safe
when the note can be consumed by its target alone. Links point to
`https://notecheck-miden.vercel.app` unless you pass `baseUrl`.

## Create a payment request

```ts
import { createRequest, decodeRequest } from "notecheck";

const { url, request } = await createRequest({
  network: "testnet",
  to: "mtst1ap6wl92rd8jfwsgehu25ukeh5ykn7970",
  amountDecimal: "1.5",      // or amount: 1_500_000n in base units
  // faucetId defaults to the network's fee token (USDCX on testnet)
  memo: "Invoice #7",
  ref: "INV-0007",
});

const same = await decodeRequest(url);
```

Requests are unsigned: whoever pays should confirm the address with you.

## Command line

```
npx notecheck verify "https://notecheck-miden.vercel.app/r#r1.H4sI…"
```

```
✓ Payment confirmed on the Miden network (testnet)

  Amount      1 USDCX
  Paid to     mtst1ap6wl92rd8jfwsgehu25ukeh5ykn7970
  Paid from   mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk
  Included    block 83,790 · 9 Oct 2026, 12:24 UTC
  Claimed     yes, the recipient claimed it in block 83,793 · 9 Oct 2026, 12:24 UTC
  Note        0x13d80a89d128fd636d7ca2bd35c672ab7ba1ed6be9fdf053f94e78d3af52406c (P2ID, private)

  Sender's claims (not checked)
  Memo        Invoice #42

  Explorer    https://testnet.midenscan.com/note/0x13d80a89d128fd636d7ca2bd35c672ab7ba1ed6be9fdf053f94e78d3af52406c
```

| Command | |
|---------|-|
| `notecheck verify <link> [--password <pw>] [--json]` | Check a receipt. The password can also come from `NOTECHECK_PASSWORD`. |
| `notecheck inspect <file.mno \| base64 \| link> [--network <n>] [--json]` | Decode a note file or receipt offline. |
| `notecheck receipt <file.mno> [--network <n>] [--memo <text>] [--password <pw>] [--base-url <url>] [--json]` | Make a receipt link from a Full note file that is on chain. |
| `notecheck request --to <address> --amount <decimal> [--token <faucet> \| --usdcx] [--memo <text>] [--ref <text>] [--network <n>] [--base-url <url>] [--json]` | Make a payment request link. |

```
$ notecheck request --to mtst1ap6wl92rd8jfwsgehu25ukeh5ykn7970 --amount 1.5 --usdcx --memo "Invoice #7"
Payment request: 1.5 USDCX to mtst1ap6wl92rd8jfwsgehu25ukeh5ykn7970 on testnet
  Memo        Invoice #7

https://notecheck-miden.vercel.app/?tool=pay#q1.H4sIAAAAAAAAE…

The link is unsigned: the payer should confirm the address with you before paying.
```

Exit codes: `0` confirmed (or done), `1` receipt checked but not confirmed (not found, mismatch
or reclaimable), `2` usage, input or network error. `NOTECHECK_DEBUG=1` prints stack traces.

## What a receipt proves

- These assets were sent as a note to this recipient account, by this sender account.
- The note was committed to the network, in a given block.
- Whether the note has been consumed, and when.

It doesn't prove who consumed it (a P2IDE note can go back to its sender after a deadline, and
the result says so), anything else about either account, or the memo and date, which come from
the sender. One payment is one note ID; record it so the same receipt isn't presented twice.
Checking a receipt asks a Miden node about that note, so the node can link the note to its later
spend. More in the [project README](https://github.com/Bruce039/notecheck#how-a-receipt-works)
and [SPEC.md](./SPEC.md).

## Other exports

Format functions (`encodeReceipt`, `decodeReceipt`, `encodeRequest`, `validateRequest`, …),
note inspection (`inspectNote`, `inspectNoteFileBytes`), the payment helpers
(`pickPaymentNote`, `receiptIfCommitted`, `waitForReceipt`), account helpers (`parseAccountId`,
`normalizeAccountId`, `toBech32`), networks (`HRP`, `endpoint`, `networkId`), a per-network RPC
queue (`withRpc`), token metadata (`tokenInfo`, `formatAmount`, `parseAmount`) and explorer
links. All are typed; see `dist/index.d.ts`.

In the browser build, arrays of SDK objects and some by-value parameters are consumed by the
call. The helpers here read what they need before handing objects over and free what they
create; `release(...)` frees SDK objects of your own.

## License

MIT
