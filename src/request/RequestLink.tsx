import { useState } from "react";

/** A made payment-request link: one-line preview plus copy, open and (where supported) share. */
export function RequestLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the link stays selectable */ }
  };
  const at = url.indexOf("/?tool=pay#");
  return (
    <div className="field request-link">
      <div className="field-label">Request link</div>
      <div className="link-box"><code title={url}>{url}</code></div>
      <div className="link-actions">
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
        <a className="btn" href={at >= 0 ? url.slice(at) : url}>Open</a>
        {canShare && (
          <button type="button" className="btn" onClick={() => void navigator.share({ title: "Payment request", url }).catch(() => undefined)}>
            Share
          </button>
        )}
      </div>
    </div>
  );
}
