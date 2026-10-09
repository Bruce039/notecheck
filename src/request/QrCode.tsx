import { useMemo } from "react";
import qrcode from "qrcode-generator";

const QUIET = 4;

/** Module path of a QR code for `text`, plus its size in modules (quiet zone included). */
function qrPath(text: string): { d: string; size: number } {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    }
  }
  return { d, size: n + QUIET * 2 };
}

/** Inline SVG QR code: dark modules on a white tile in both themes, so any camera reads it. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { d, size } = useMemo(() => qrPath(text), [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect className="qr-light" width={size} height={size} />
      <path className="qr-dark" d={d} />
    </svg>
  );
}
