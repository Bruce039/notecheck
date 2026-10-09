import { useState } from "react";

/** A made receipt link: one-line preview plus copy, open and (where supported) share. */
export function ReceiptLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the link stays selectable */ }
  };
  return (
    <div className="field receipt-link">
      <div className="field-label">Receipt link</div>
      <div className="link-box"><code title={url}>{url}</code></div>
      <div className="link-actions">
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
        <a className="btn" href={url.slice(url.indexOf("/r#"))}>Open</a>
        {canShare && (
          <button type="button" className="btn" onClick={() => void navigator.share({ title: "Payment receipt", url }).catch(() => undefined)}>
            Share
          </button>
        )}
      </div>
    </div>
  );
}
