import { useEffect, useRef, useState, type ReactNode } from "react";
import { BRAND } from "@/brand";
import { EXAMPLE_RECEIPT_PATH } from "@/receipt/example";
import "./docs.css";

// In-app guide (?tool=docs). Plain text first for people paying and checking receipts,
// developer material after. Every fact here mirrors the app's own copy and the README.

type SectionId =
  | "what-is-notecheck" | "pay" | "check" | "receive" | "proves"
  | "developer-tools" | "cli" | "faq" | "glossary";

const SECTIONS: { id: SectionId; title: string }[] = [
  { id: "what-is-notecheck", title: "What is NoteCheck" },
  { id: "pay", title: "Pay with a receipt" },
  { id: "check", title: "Check a receipt" },
  { id: "receive", title: "Receive the payment in your wallet" },
  { id: "proves", title: "What a receipt proves, and what it doesn't" },
  { id: "developer-tools", title: "Developer tools" },
  { id: "cli", title: "Receipts from the Miden CLI" },
  { id: "faq", title: "FAQ" },
  { id: "glossary", title: "Glossary" },
];

const title = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.title;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Tracks which section is being read, and which sections have scrolled into view once. */
function useScrollSpy(ids: SectionId[]) {
  const [active, setActive] = useState<SectionId>(ids[0]);
  const [seen, setSeen] = useState<ReadonlySet<SectionId>>(() => new Set());
  const [animate] = useState(() => typeof IntersectionObserver === "function" && !prefersReducedMotion());

  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const visible = new Set<string>();

    // A section counts as "being read" while it crosses the band near the top of the viewport.
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target.id);
        else visible.delete(e.target.id);
      }
      const first = ids.find((id) => visible.has(id));
      if (first) setActive(first);
    }, { rootMargin: "-15% 0px -70% 0px" });

    const reveal = new IntersectionObserver((entries) => {
      const shown = entries.filter((e) => e.isIntersecting).map((e) => e.target);
      if (shown.length === 0) return;
      for (const t of shown) reveal.unobserve(t);
      setSeen((cur) => new Set([...cur, ...shown.map((t) => t.id as SectionId)]));
    }, { rootMargin: "0px 0px -8% 0px" });

    for (const el of els) { spy.observe(el); reveal.observe(el); }
    return () => { spy.disconnect(); reveal.disconnect(); };
  }, [ids]);

  return { active, seen, animate };
}

export function DocsPage() {
  const ids = useRef(SECTIONS.map((s) => s.id)).current;
  const { active, seen, animate } = useScrollSpy(ids);
  const mobileToc = useRef<HTMLDetailsElement>(null);

  // Deep links (/?tool=docs#faq): the section exists only after this renders.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id && ids.includes(id as SectionId)) document.getElementById(id)?.scrollIntoView?.();
  }, [ids]);

  const tocLinks = (onPick?: () => void) => (
    <ol>
      {SECTIONS.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            className={s.id === active ? "docs-toc-on" : undefined}
            aria-current={s.id === active ? "location" : undefined}
            onClick={onPick}
          >
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  );

  const section = (id: SectionId, children: ReactNode) => (
    <Section id={id} hidden={animate && !seen.has(id)}>{children}</Section>
  );

  return (
    <div className="docs" data-anim={animate ? "on" : undefined}>
      <header className="docs-hero">
        <p className="docs-eyebrow">Docs</p>
        <h2 className="docs-hero-title">How to use {BRAND.name}</h2>
        <p className="docs-hero-lead">{BRAND.pitch}</p>
        <div className="docs-hero-actions">
          <a className="btn btn-primary" href="/?tool=pay">Go to Pay</a>
          <a className="btn" href={EXAMPLE_RECEIPT_PATH}>See an example receipt</a>
        </div>
      </header>

      <details className="docs-toc-mobile" ref={mobileToc}>
        <summary>On this page</summary>
        <nav aria-label="On this page">
          {tocLinks(() => { if (mobileToc.current) mobileToc.current.open = false; })}
        </nav>
      </details>

      <aside className="docs-aside">
        <nav className="docs-toc" aria-label="On this page">
          <p className="docs-toc-title">On this page</p>
          {tocLinks()}
        </nav>
      </aside>

      <div className="docs-body">
        {section("what-is-notecheck", <>
          <p>
            Payments on Miden are private: the chain doesn't show who paid whom, or how much. That's the point,
            but it leaves a gap when you need to prove a payment to the person you paid, or to your accountant.
            {" "}{BRAND.name} fills it. Pay through your wallet, get a link, share it. Whoever opens the link sees
            the amount, the recipient and the sender, checked against the Miden network in their own browser,
            and nothing else about your account.
          </p>
          <p>
            Everything runs in your browser. There is no backend and no sign-up: the receipt lives in the part of
            the link after the <code>#</code>, which browsers never send to a server. {BRAND.name} also has a few
            small <a href="#developer-tools">developer tools</a> for working with Miden addresses, felts, hashes,
            note tags and fees, plus an allowlist check.
          </p>
          <Callout tone="info" title="Testnet only for now">
            Payments use Miden's test network, so the money has no real value. {BRAND.name} is an independent
            project, not affiliated with Miden.
          </Callout>
        </>)}

        {section("pay", <>
          <p>
            You need the <strong>Bread wallet</strong> browser extension in desktop Chrome, with a testnet
            account that holds some tokens. The person you pay needs a Miden address
            (on testnet it starts with <code>mtst1</code>).
          </p>
          <ol className="docs-steps">
            <Step title="Open the Pay tab">
              Go to <a href="/?tool=pay">Pay</a> and check that the network selector at the top right says
              {" "}<strong>testnet</strong>.
            </Step>
            <Step title="Connect wallet">
              Click <Ui>Connect wallet</Ui> and approve the connection in the wallet. A green
              {" "}<Ui>connected</Ui> badge and your shortened address appear. If no wallet is found, the tab
              shows a <Ui>Get the wallet</Ui> link instead.
            </Step>
            <Step title="Load my tokens">
              Click <Ui>Load my tokens</Ui>. Your wallet asks for permission before sharing your balances;
              approve it. Then pick the token you want to pay with. Each one shows its balance, and a token
              that isn't on the official list is marked <Ui>(unverified)</Ui>.
            </Step>
            <Step title="Fill in the payment">
              Enter the <strong>recipient address</strong> and the <strong>amount</strong> (for example
              {" "}<code>10.5</code>). Optionally add a <strong>memo</strong> for the receipt, up to 280
              characters (for example <code>Invoice #42</code>), and a <strong>receipt password</strong> of at
              least 8 characters. {BRAND.name} warns you if the address is for another network, the amount is
              over your balance, or you're paying your own account.
            </Step>
            <Step title="Review in wallet">
              Click <Ui>Review in wallet</Ui>. The wallet opens its usual send screen. Check the amount and the
              recipient there before you approve. The wallet pays the network fee.
            </Step>
            <Step title="Wait a minute or two">
              Your wallet builds, proves and sends the payment, then delivers it privately to the recipient.
              This usually takes one to two minutes. You can follow the progress in your wallet.
            </Step>
            <Step title="Share your receipt link">
              When the payment is committed you see <Ui>Payment committed</Ui> and the receipt link, with
              {" "}<Ui>Copy link</Ui>, <Ui>Open</Ui> and, where your device supports it, <Ui>Share</Ui>.
              Send the link to the person you paid or to your accountant.
            </Step>
          </ol>
          <Callout tone="info" title="Using a password">
            Anyone with the link can see this payment. With a password, they also need the password. Send it
            through a different channel than the link: for example the link by email and the password by
            phone.
          </Callout>
          <Callout tone="warn" title="Don't pay twice">
            If you close the tab or something goes wrong after you approved, the payment is remembered in this
            browser. Next time you open Pay you'll see that a payment from an earlier visit still needs a
            receipt: connect the same wallet and click <Ui>finish receipt</Ui> (enter the password again first
            if you want one). Don't send the payment again while one is still pending.
          </Callout>
          <p className="docs-note">
            Receipts you make are kept under <Ui>Receipts made in this browser</Ui> on the Pay tab, so a closed
            tab doesn't lose a link. Anyone who can use this browser can open them; use <Ui>remove</Ui> when
            you no longer need one.
          </p>
        </>)}

        {section("check", <>
          <p>
            For the person you paid, or your accountant. Open the receipt link, or paste it into
            {" "}<a href="/?tool=receipt">Receipts</a> and click <Ui>Open</Ui>. Your browser reads the receipt
            and asks the Miden network about this one payment. It takes a few seconds.
          </p>
          <h3>What each part means</h3>
          <dl className="docs-defs">
            <dt>Verdict</dt>
            <dd>
              The banner at the top. <Ui>Payment confirmed on the Miden network</Ui> means the network recorded
              exactly this payment. An amber banner such as <Ui>Payment committed — the sender can still take it
              back</Ui> appears for a P2IDE payment the sender can reclaim if it stays unclaimed (see below).
              {" "}<Ui>Not found on testnet</Ui> means the network has no record of it yet, and <Ui>This receipt
              does not match the chain</Ui> means the link was changed or is broken: don't rely on it.
            </dd>
            <dt>Amount</dt>
            <dd>
              The amount and token, for tokens on the official token list. Any other token is shown in base
              units with an <Ui>Unverified token</Ui> badge, because anyone can create a token with any name.
            </dd>
            <dt>Paid to / Paid from</dt>
            <dd>The recipient's and the sender's Miden addresses, each with a Copy button.</dd>
            <dt>Status</dt>
            <dd>
              <Ui>✓ Received</Ui> once the recipient has claimed the funds, or <Ui>Waiting for the recipient to
              claim</Ui> until then. The line under the amount also gives the date it was sent.
            </dd>
            <dt>Note from the sender · not checked</dt>
            <dd>
              The memo. It is the sender's own words: the network doesn't check it, and neither does
              {" "}{BRAND.name}.
            </dd>
            <dt>Technical details</dt>
            <dd>
              The note ID, account IDs, token faucet, blocks and note type, for anyone who wants to check
              further. Record the <strong>note ID</strong>: one payment has exactly one note ID.
            </dd>
          </dl>
          <Callout tone="warn" title="P2IDE: payments the sender can take back">
            Some payments are made as P2IDE notes, which let the sender take the funds back from a given block
            if the recipient hasn't claimed them. The receipt says when that's possible. If such a note was
            claimed after that block, the chain doesn't show who claimed it, so the receipt says it may have
            gone back to the sender.
          </Callout>
          <h3>Save as PDF and Check again</h3>
          <p>
            <Ui>Save as PDF</Ui> opens your browser's print dialog with every section expanded; choose
            {" "}<em>Save as PDF</em> as the printer. <Ui>Check again</Ui> asks the network once more, for
            example to see whether the payment has been claimed since, or after a <Ui>Not found</Ui> for a
            payment sent a moment ago.
          </p>
          <h3>Password-protected receipts</h3>
          <p>
            If the link has a password, the page asks for it before showing anything. The sender gives it to you
            separately. The receipt is unlocked in your browser; the password is never sent anywhere.
          </p>
          <p><a href={EXAMPLE_RECEIPT_PATH}>See an example receipt</a></p>
        </>)}

        {section("receive", <>
          <p>
            Usually you don't need to do anything. The sender's wallet delivers the payment privately to your
            wallet, where it shows up like any incoming payment for you to claim.
          </p>
          <p>
            If it hasn't arrived, open the receipt link. While the payment is still unclaimed, the bottom of the
            page has <Ui>Are you the recipient? Receive this payment in your wallet</Ui>. Connect your wallet and
            click <Ui>Import into my wallet</Ui>; your wallet can then claim it. Only the recipient account can
            claim the payment, so sharing the receipt doesn't let anyone else take it.
          </p>
        </>)}

        {section("proves", <>
          <p>Opening a receipt link:</p>
          <ol className="docs-plain">
            <li>decodes the note in the link and recomputes its note ID from its contents,</li>
            <li>asks a Miden node for that note ID and compares the sender, tag and note type it reports,</li>
            <li>asks whether the note has been spent (its nullifier published), that is, claimed.</li>
          </ol>
          <p>
            Changing the amount or the recipient changes the note ID, so an edited receipt won't match anything
            on the network.
          </p>
          <div className="docs-compare">
            <div className="docs-compare-col docs-compare-yes">
              <h3>A receipt proves</h3>
              <ul>
                <li>These assets were sent as a note to this recipient account, by this sender account.</li>
                <li>The note was committed to the network, in a given block.</li>
                <li>Whether the note has been consumed, and when.</li>
              </ul>
            </div>
            <div className="docs-compare-col docs-compare-no">
              <h3>It doesn't prove</h3>
              <ul>
                <li>
                  Who consumed it. For P2ID only the recipient can. A P2IDE note can also go back to its sender
                  after a deadline, and the receipt says so.
                </li>
                <li>Anything else about either account.</li>
                <li>The memo and date. They come from the sender and are shown as such.</li>
                <li>That a payment wasn't presented twice. One payment is one note ID; record it.</li>
              </ul>
            </div>
          </div>
          <h3>Privacy notes</h3>
          <ul>
            <li>
              Checking a receipt asks the Miden node about that note, so the node can link the note to its later
              spend.
            </li>
            <li>
              A receipt link contains the note's details. Only P2ID and P2IDE notes are accepted, because anyone
              who knows the details of a note without a target check could consume it.
            </li>
            <li>
              Token names come from the official Miden token list. A token that isn't in the list, apart from the
              network's own fee token, is marked unverified, since anyone can create a token with any name.
            </li>
            <li>Anyone who has the link can see this payment, and only this payment. Share it only with the people who need it.</li>
          </ul>
        </>)}

        {section("developer-tools", <>
          <p>
            Small helpers for people building on Miden. They run in your browser; the ones marked
            {" "}<em>network</em> ask a node of the network chosen in the selector at the top right.
          </p>
          <div className="docs-tools">
            <Tool id="address" name="Address">
              Paste a bech32 address (<code>mtst1…</code>, <code>mdev1…</code>, <code>mm1…</code>) or a
              {" "}<code>0x</code> account ID to get the account ID in hex, the address on each network, the
              prefix and suffix felts and the default note tag. Decoded locally.
              <Example in="mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk_qr7qqq9wr6w" out="Account ID (hex), addresses per network, prefix/suffix felts, note tag" />
            </Tool>
            <Tool id="felt" name="Felt / Word">
              Converts integers to field elements of the Goldilocks field
              (p = 2<sup>64</sup> − 2<sup>32</sup> + 1), in decimal and 64-bit hex, and shows the value mod p
              when it is out of range. A word is four felts: enter them as a list or as <code>0x</code> plus 64
              hex characters.
              <Example in="[1, 2, 3, 4]" out="The word as hex, and its four felts" />
            </Tool>
            <Tool id="tag" name="Note tag">
              The tag a note to a given account carries. Clients sync notes by tag, so the slider (0 to 32 bits,
              14 by default) trades privacy for less noise; <Ui>Matches</Ui> shows the share of accounts whose
              notes look the same to the node.
            </Tool>
            <Tool id="hash" name="Hash">
              Hashes a list of felts, or a UTF-8 string, with Poseidon2 (the protocol's native hash) and with
              RPO256 for comparison. Each digest is shown as word hex and as felts.
              <Example in="hello" out="Poseidon2 and RPO256 digests" />
            </Tool>
            <Tool id="fee" name="Fee" network>
              Computes a transaction fee from its cycle count and the verification base fee, which it can read
              from the latest block: fee = base fee × (⌊log₂ cycles⌋ + 1).
              <Example in="100000 cycles" out="17 × the base fee" />
            </Tool>
            <Tool id="allowlist" name="Allowlist" network>
              Asks whether the node would accept creating this account. A yes is also the answer when the node
              enforces no allowlist. Only account creation is gated: an account that already exists keeps
              working.
            </Tool>
          </div>
        </>)}

        {section("cli", <>
          <p>
            Payments made in the Pay tab get a receipt automatically. If you sent a P2ID or P2IDE note with the
            Miden CLI, export it in full format:
          </p>
          <pre className="docs-pre"><code>miden export --note &lt;note-id&gt; --export-type full</code></pre>
          <p>
            This writes <code>&lt;note-id&gt;.mno</code>. Open <a href="/?tool=receipt">Receipts</a>, and under
            {" "}<Ui>For developers: receipt from a CLI note file</Ui> choose the file (or paste it as base64).
            {" "}{BRAND.name} reads the note and checks it on the selected network. Add an optional memo and
            password, then click <Ui>Create link</Ui>.
          </p>
          <h3>Link format</h3>
          <pre className="docs-pre"><code>https://&lt;site&gt;/r#r1.&lt;base64url(gzip(json))&gt;</code></pre>
          <p>
            The JSON holds the serialized note file plus an optional memo (up to 280 characters) and date.
            With a password the payload is encrypted with PBKDF2-SHA256 (600,000 iterations) and AES-256-GCM,
            and the link starts with <code>r1e.</code> instead.
          </p>
        </>)}

        {section("faq", <>
          <div className="docs-faq">
            <Faq q="Why testnet only?">
              {BRAND.name} is new, and payments run on Miden's test network for now. Mainnet's public node isn't
              available yet, so mainnet receipts can't be checked here.
            </Faq>
            <Faq q="Why do I need the Bread wallet?">
              Your wallet holds your keys and sends the payment; {BRAND.name} never sees them. You only need the
              wallet to pay, or to import a payment you received. Checking a receipt needs no wallet.
            </Faq>
            <Faq q="Is my data sent anywhere?">
              There is no {BRAND.name} server. The page talks to a Miden node to check notes, reads token names
              from the official Miden token list, and talks to your wallet. The receipt itself stays in the
              link. Pending payments and receipts you made are saved only in this browser.
            </Faq>
            <Faq q="What happens if testnet resets?">
              Old receipts then show <Ui>Not found on testnet</Ui>, because the network no longer has those
              payments. That doesn't mean the payment was faked; it means it can't be checked any more.
            </Faq>
            <Faq q="Which browsers work?">
              Checking receipts and the developer tools work in recent browsers: Chrome or Edge 96+, Firefox 113+
              and Safari 16.4+. Paying needs the wallet extension, so use desktop Chrome.
            </Faq>
            <Faq q="Can a receipt be faked?">
              The amount and the recipient can't be changed without breaking the match with the network: the
              page then says <Ui>This receipt does not match the chain</Ui>. The memo, though, can say anything,
              which is why it's labelled <Ui>not checked</Ui>.
            </Faq>
            <Faq q="Can the same payment be shown twice?">
              Yes, a link can be shared more than once. One payment is one note ID, so record the note ID from
              {" "}<Ui>Technical details</Ui> and don't accept the same one twice.
            </Faq>
          </div>
        </>)}

        {section("glossary", <>
          <dl className="docs-glossary">
            <dt>Note</dt><dd>How value moves on Miden: a small package of assets sent to an account, which that account then claims (consumes).</dd>
            <dt>P2ID</dt><dd>"Pay to ID": a note only the named recipient account can claim. The standard payment.</dd>
            <dt>P2IDE</dt><dd>A P2ID note with extras: the sender can take it back after a given block, and/or the recipient can claim it only after a given block.</dd>
            <dt>Note ID</dt><dd>A fingerprint of the note's full contents. Change the amount or the recipient and the ID changes.</dd>
            <dt>Nullifier</dt><dd>A marker published when a note is spent, so it can't be spent twice. It shows that a note was claimed, not by whom.</dd>
            <dt>Faucet / token</dt><dd>A faucet is the account that issues a token. A token is identified by its faucet's ID, not by its name.</dd>
            <dt>Testnet</dt><dd>Miden's public test network. Its tokens have no value, and it is reset from time to time.</dd>
            <dt>Block</dt><dd>A numbered, timestamped batch of transactions the network records together.</dd>
          </dl>
        </>)}

        <p className="docs-foot muted small">{BRAND.disclaimer}</p>
      </div>
    </div>
  );
}

function Section({ id, hidden, children }: { id: SectionId; hidden: boolean; children: ReactNode }) {
  return (
    <section id={id} className={hidden ? "docs-section" : "docs-section docs-in"} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="docs-h">
        {title(id)}
        <a className="docs-anchor" href={`#${id}`} aria-label={`Link to “${title(id)}”`}>#</a>
      </h2>
      {children}
    </section>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <strong className="docs-step-title">{title}</strong>
      <p>{children}</p>
    </li>
  );
}

/** A button or label as it appears in the app. */
function Ui({ children }: { children: ReactNode }) {
  return <span className="docs-ui">{children}</span>;
}

function Callout({ tone, title, children }: { tone: "info" | "warn"; title: string; children: ReactNode }) {
  return (
    <aside className={`docs-callout docs-callout-${tone}`}>
      <span className="docs-callout-icon" aria-hidden>{tone === "info" ? "i" : "!"}</span>
      <div>
        <p className="docs-callout-title">{title}</p>
        <p>{children}</p>
      </div>
    </aside>
  );
}

function Tool({ id, name, network, children }: { id: string; name: string; network?: boolean; children: ReactNode }) {
  return (
    <article className="docs-tool">
      <h3>
        <a href={`/?tool=${id}`} data-tool={id}>{name}</a>
        {network && <span className="docs-tag">network</span>}
      </h3>
      <div>{children}</div>
    </article>
  );
}

function Example({ in: input, out }: { in: string; out: string }) {
  return (
    <div className="docs-example">
      <span className="docs-example-k">Try</span><code>{input}</code>
      <span className="docs-example-k">Get</span><span>{out}</span>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="docs-faq-item">
      <summary>{q}</summary>
      <p>{children}</p>
    </details>
  );
}
