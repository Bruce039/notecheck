# NoteCheck link formats

Version 1. This document specifies the two link formats used by NoteCheck and the `notecheck`
package:

- **miden-receipt/v1**: a receipt for a private Miden payment, prefixes `r1.` and `r1e.`
- **miden-request/v1**: a payment request, prefix `q1.`

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. Common encoding

Both formats carry a JSON object in the URL fragment, so the data is never sent to a web server.

```
fragment = prefix || base64url( gzip( utf8( json ) ) )
```

- `json` is a single JSON object, UTF-8 encoded.
- `gzip` is RFC 1952 (any compression level).
- `base64url` is RFC 4648 §5 without padding. Decoders MUST reject characters outside
  `A-Z a-z 0-9 - _` and lengths with `length % 4 == 1`.
- Decoders MUST cap the decompressed size (limits below) and stop inflating once it is exceeded.
- Decoders MUST drop object fields they don't know. Writers MUST NOT rely on unknown fields
  surviving a round trip.

A link is `origin + path + "#" + fragment`. Readers SHOULD accept the whole link, the fragment
with a leading `#`, or the bare fragment, and take everything after the first `#`.

## 2. Receipts: miden-receipt/v1

### 2.1 URL

```
https://notecheck-miden.vercel.app/r#r1.<data>     plain
https://notecheck-miden.vercel.app/r#r1e.<data>    password-protected
```

Any origin MAY host a verifier; the path for receipts is `/r`.

### 2.2 JSON

| Field       | Type   | Required | Rules |
|-------------|--------|----------|-------|
| `v`         | number | yes      | `1` |
| `network`   | string | yes      | `"testnet"`, `"devnet"` or `"mainnet"` |
| `noteFile`  | string | yes      | Standard base64 (RFC 4648 §4, `+/`, padding allowed), matching `^[A-Za-z0-9+/]+={0,2}$`, at most 12,000 characters. Decodes to `NoteFile.serialize()` in the **NoteWithProof** ("Full") format, at most 65,536 bytes. |
| `memo`      | string | no       | At most 280 characters before cleaning (2.5). Sender's claim. |
| `createdAt` | string | no       | A date string that `Date.parse` accepts; writers use ISO 8601 UTC. Sender's claim. |
| `txId`      | string | no       | `^0x[0-9a-f]{64}$`, the on-chain transaction id. Sender's claim. |

Example (before compression):

```json
{"v":1,"network":"testnet","noteFile":"CsgDGsUD…","memo":"Invoice #42","createdAt":"2026-10-09T12:25:00.000Z"}
```

### 2.3 Limits

| Item | Limit |
|------|-------|
| Fragment, including prefix | 16,384 characters |
| Decompressed JSON | 32,768 bytes |
| `noteFile` (base64) | 12,000 characters |
| Decoded note file | 65,536 bytes |

A P2ID receipt has a note file of about 460 bytes and a fragment of about 650 characters.

### 2.4 Password protection (`r1e.`)

```
data = base64url( salt[16] || iv[12] || ciphertext || tag[16] )
key  = PBKDF2-HMAC-SHA256( utf8(password), salt, 600000 iterations, 32 bytes )
ciphertext || tag = AES-256-GCM( key, iv, plaintext = gzip(utf8(json)) ), no associated data
```

- `salt` and `iv` MUST be fresh random bytes for every link.
- Decryption failure (wrong password or altered data) MUST be reported as such; it is not
  distinguishable from tampering.
- The size limits of 2.3 apply to the fragment and to the decrypted, decompressed JSON.
- Writers SHOULD require passwords of at least 8 characters: anyone with the link can try
  passwords offline.

### 2.5 Memo cleaning

Writers and readers apply the same cleaning before storing or showing a memo:

1. Replace runs of whitespace (including U+2028, U+2029) with one space.
2. Remove control and format characters (Unicode `Cc`, `Cf`: bidi overrides and isolates,
   zero-width characters).
3. Collapse repeated spaces and trim.
4. Remove leading check and cross marks (`✓ ✔ ☑ ✅ ✕ ✗ ✘ ❌`) and trim again, so a memo can't
   imitate the verdict.

An empty memo after cleaning is dropped.

### 2.6 What a verifier MUST check

A receipt proves something only after these checks. Everything shown as verified MUST come from
the note in `noteFile`, never from `memo`, `createdAt` or `txId`.

1. **Decode** the fragment (section 1, 2.3, 2.4) and validate the JSON (2.2).
2. **Deserialize** the note file. It MUST be in NoteWithProof format; note-ID-only and
   details-only files are rejected.
3. **Script check.** The note's script root MUST equal the standard **P2ID** or **P2IDE** script
   root (miden-standards 0.17). Any other script MUST be rejected: a receipt reveals the note's
   serial number and storage, so a note without a target check could be consumed by anyone who
   sees the link.
4. **Storage check.** P2ID storage is `[target_suffix, target_prefix, salt_0, salt_1]`; P2IDE
   storage is `[reclaimer_suffix, reclaimer_prefix, target_suffix, target_prefix, reclaim_height,
   timelock_height]`. The account IDs MUST be valid; heights MUST fit in u32 (`0` means none).
5. **Recompute the note ID** from the note's contents (recipient, assets, metadata). The ID in
   the file's inclusion proof is not trusted.
6. **Look the note ID up on the named network** (`GetNotesById`). Not found means the receipt
   is not confirmed.
7. **Compare metadata.** The sender, tag and note type the node reports MUST equal the note's.
   A difference is a mismatch and the receipt is not confirmed.
8. **Inclusion block** is taken from the node's inclusion proof, and its time from the node's
   block header.
9. **Spend status.** Look up the note's nullifier (`GetNullifierCommitHeight`, from the
   inclusion block). A result means the note was consumed in that block.
10. **P2IDE reclaim.** If `reclaim_height` is set, the reclaimer can consume the note from block
    `max(reclaim_height, timelock_height)` on, and the chain does not say who consumed it. A
    verifier MUST NOT present such a note as received by the target unless it was consumed
    before that block; while it is unspent, it MUST compare that block with the current chain
    tip (and treat an unknown tip as the worst case).

Token symbols and decimals are display data. Verifiers SHOULD take them from the official
Miden token list (or the network's fee token) and mark any other token as unverified, since
anyone can deploy a faucet with any name.

### 2.7 What a receipt does not prove

- Who consumed the note (see 2.6.10 for P2IDE).
- Anything about either account beyond this note.
- The memo, date and transaction id: they are the sender's claims.
- That a payment wasn't presented twice: one payment is one note ID; record it.

Checking a receipt asks a Miden node about that note ID and nullifier, so the node can link the
note to its later spend.

## 3. Payment requests: miden-request/v1

### 3.1 URL

```
https://notecheck-miden.vercel.app/?tool=pay#q1.<data>
```

Requests are never encrypted.

### 3.2 JSON

| Field       | Type   | Required | Rules |
|-------------|--------|----------|-------|
| `v`         | number | yes      | `1` |
| `network`   | string | yes      | `"testnet"`, `"devnet"` or `"mainnet"` |
| `to`        | string | yes      | The requester's plain bech32 address, at most 100 characters: no `_…` routing suffix, no 0x hex. Its human-readable part MUST be the network's (`mtst` testnet, `mdev` devnet, `mm` mainnet). |
| `faucetId`  | string | yes      | Token faucet account ID as lowercase hex, `^0x[0-9a-f]{30}$`, a valid account ID. |
| `amount`    | string | yes      | Base units, `^[1-9][0-9]{0,18}$` and at most 2^63 − 1. |
| `memo`      | string | no       | At most 280 characters, cleaned as in 2.5. |
| `ref`       | string | no       | Invoice number or similar, at most 64 characters, cleaned as in 2.5. |
| `createdAt` | string | no       | At most 40 characters, accepted by `Date.parse`. |

Limits: the fragment is at most 4,096 characters and the decompressed JSON at most 4,096 bytes.

A receipt for a paid request SHOULD carry the memo `memo · ref <ref>` (cleaned, at most 280
characters), so the requester can match the two.

### 3.3 Requests are unsigned

Anyone can make a request link with any address. A payer MUST check the recipient address with
the requester through another channel before paying. Wallets and payment pages SHOULD show the
full address and say so.

## 4. Versioning

- The prefix names the format and its major version: `r1.`, `r1e.` and `q1.` are version 1.
  An incompatible change gets a new prefix (`r2.`, `q2.`) and a new `v` value; readers MUST
  reject prefixes they don't know and `v` values other than the one the prefix implies.
- Within version 1, new optional fields MAY be added. Readers drop unknown fields, so older
  readers keep working; a new field MUST NOT change the meaning of an existing one.
- The note file is the Miden `NoteFile` serialization of the SDK in use. If a protocol upgrade
  changes it, receipts made before the upgrade may stop decoding; that is not a format change.
- Testnet resets remove old notes from the chain; receipts from before a reset then verify as
  not found.
