// "Scan to check": the receipt link as a QR code, so another device (or a printed receipt) can
// open and re-check it. Always dark on white, whatever the theme, because scanners expect that.
import { useId, useMemo, useState, type CSSProperties } from "react";
import { QR_QUIET_ZONE, RECEIPT_QR_ECC, qrSvgPath } from "@/lib/qr";

/** A QR code from qrSvgPath as an inline SVG, with its quiet zone. */
export function QrSvg({ qr, className }: { qr: { size: number; path: string }; className?: string }) {
  const q = QR_QUIET_ZONE;
  const box = qr.size + 2 * q;
  return (
    <svg
      className={className} viewBox={`${-q} ${-q} ${box} ${box}`} role="img"
      aria-label="QR code for this receipt link" shapeRendering="crispEdges" data-modules={qr.size}
      // Whole pixels per module on screen (see .rc-qr-svg), so a 1x display shows sharp modules.
      style={{ "--qr-total": box } as CSSProperties}
    >
      <rect x={-q} y={-q} width={box} height={box} fill="#ffffff" />
      <path d={qr.path} fill="#111118" />
    </svg>
  );
}

/**
 * The QR block of the slip footer. On wide screens and in print it is always shown; on small
 * screens it sits behind a "Show QR code" toggle (see .rc-qr in receipt.css) to keep the slip short.
 */
export function ScanToCheck({ url, passwordRequired }: { url: string; passwordRequired: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const qr = useMemo(() => qrSvgPath(url, RECEIPT_QR_ECC), [url]);
  return (
    <div className={`rc-qr${open ? " is-open" : ""}`}>
      <button
        type="button" className="link rc-qr-toggle" aria-expanded={open} aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <QrGlyph />{open ? "Hide QR code" : "Show QR code"}
      </button>
      <div className="rc-qr-body" id={bodyId}>
        {qr ? (
          <>
            <div className="rc-qr-tile"><QrSvg qr={qr} className="rc-qr-svg" /></div>
            <p className="rc-qr-cap">
              <strong>Scan to check</strong>
              <span className="rc-noprint">Opens it on another device</span>
              {passwordRequired && <span className="rc-qr-pw">Password required</span>}
            </p>
          </>
        ) : (
          <p className="rc-qr-cap rc-qr-none">This link is too long for a QR code. Share the link itself.</p>
        )}
      </div>
    </div>
  );
}

function QrGlyph() {
  return (
    <svg className="rc-qr-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9.5 9.5h2v2h-2zM12.5 12.5h2v2h-2zM12.5 9.5h2M9.5 13.5h1" />
    </svg>
  );
}
