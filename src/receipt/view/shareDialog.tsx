// "Share image": a small modal that previews the receipt card, lets the amount be hidden, and
// hands the PNG to the system share sheet or saves it. Shown only for chain-confirmed receipts.
import { useEffect, useId, useRef, useState } from "react";
import { Notice } from "@/components/ui";
import { canShareFile, downloadBlob, renderShareCard, shareFile, type ShareCardData } from "./shareCard";

type Rendered = { blob: Blob; dataUrl: string };

export function ShareImageDialog({ data, title, onClose }: {
  data: Omit<ShareCardData, "hideAmount">;
  /** Title passed to the share sheet. */
  title: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [hideAmount, setHideAmount] = useState(false);
  const [image, setImage] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const headingId = useId();
  const noteId = useId();

  // Open as a modal (focus moves in, Escape closes, the page behind is inert); give focus back after.
  useEffect(() => {
    const d = ref.current!;
    // Remember the opener once (a StrictMode re-run would otherwise see focus already inside).
    const active = document.activeElement as HTMLElement | null;
    if (!opener.current && active && !d.contains(active)) opener.current = active;
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    // No close() here: it would fire "close" (and onClose) after a remount in StrictMode. Leaving the
    // DOM takes the dialog out of the top layer anyway.
    return () => { opener.current?.focus?.(); };
  }, []);

  // Redraw whenever the options change; a stale render is dropped.
  const { amount, received, network, noteId: nid, checked, url, passwordRequired } = data;
  useEffect(() => {
    let live = true;
    setImage(null);
    setError(null);
    setDone(null);
    renderShareCard({ amount, received, network, noteId: nid, checked, url, passwordRequired, hideAmount })
      .then((r) => { if (live) setImage(r); })
      .catch((e) => { if (live) setError((e as Error)?.message || "The image couldn't be created."); });
    return () => { live = false; };
  }, [amount, received, network, nid, checked, url, passwordRequired, hideAmount]);

  const file = image ? shareFile(image.blob) : null;
  const canShare = file !== null && canShareFile(file);

  const share = async () => {
    if (!file || !image) return;
    try {
      await navigator.share({ files: [file], title });
      setDone("Shared.");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      downloadBlob(image.blob);
      setDone("Sharing isn't available here, so the image was downloaded.");
    }
  };
  const download = () => {
    if (!image) return;
    downloadBlob(image.blob);
    setDone("Downloaded notecheck-receipt.png.");
  };

  return (
    <dialog
      ref={ref} className="rc-share" aria-labelledby={headingId} aria-describedby={noteId}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rc-share-body">
        <div className="rc-share-head">
          <h2 id={headingId}>Share an image of this receipt</h2>
          <button type="button" className="rc-share-x" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        <div className={`rc-share-preview${image ? " is-ready" : ""}`}>
          {image
            ? <img src={image.dataUrl} width={1200} height={630} alt={`Preview of the receipt image${hideAmount ? ", amount hidden" : ""}`} />
            : !error && <span className="muted small" role="status">Drawing the image…</span>}
        </div>
        <label className="rc-share-check">
          <input type="checkbox" checked={hideAmount} onChange={(e) => setHideAmount(e.target.checked)} />
          Hide amount
        </label>
        <p id={noteId} className="muted small rc-share-note">
          The image shows the amount (unless hidden), status and a QR to this receipt. Anyone who scans it can open the receipt.
          {data.passwordRequired && " They will still need the password."} The note from the sender is not included.
        </p>
        {error && <Notice tone="bad">Couldn't create the image: {error}</Notice>}
        {done && <p className="small rc-share-done" role="status">{done}</p>}
        <div className="rc-share-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {canShare && <button type="button" className="btn" disabled={!image} onClick={download}>Download</button>}
          <button type="button" className="btn btn-primary" disabled={!image} onClick={canShare ? () => void share() : download}>
            {canShare ? "Share…" : "Download image"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
