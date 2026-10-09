// QR codes for receipt links, drawn by the page itself (inline SVG on screen and in print,
// canvas modules in the share image), so no image request or extra asset is needed.
import qrcode from "qrcode-generator";

export type QrEcc = "L" | "M";

/**
 * Error correction for receipt links. Links are 700–1000 characters of base64url (byte mode),
 * so every step up in correction costs a lot of density: a 688-character link is version 18
 * (89 modules) at L, 21 (101) at M and 25 (117) at Q. Fewer, larger modules scan more reliably
 * from a screen or a 3.5 cm print than extra redundancy helps, and nothing is overlaid on the
 * code, so L (about 7 % recoverable) is the better trade-off here.
 */
export const RECEIPT_QR_ECC: QrEcc = "L";

/** Light modules around the code, in modules. The QR spec asks for 4. */
export const QR_QUIET_ZONE = 4;

export type QrMatrix = { size: number; isDark: (row: number, col: number) => boolean };

/** The module matrix for `text`, at the smallest version that fits; null when it is too long for any QR code. */
export function qrMatrix(text: string, ecc: QrEcc = "M"): QrMatrix | null {
  // Byte mode with the library's default Latin-1 mapping: page URLs are ASCII (percent-encoded).
  const qr = qrcode(0, ecc);
  try {
    qr.addData(/[^\x20-\x7e]/.test(text) ? encodeURI(text) : text, "Byte");
    qr.make();
  } catch {
    // "code length overflow": more data than version 40 holds at this level (or a lone surrogate).
    return null;
  }
  const size = qr.getModuleCount();
  return { size, isDark: (r, c) => qr.isDark(r, c) };
}

/**
 * The dark modules of a QR code as one SVG path in module units (viewBox `0 0 size size`),
 * with horizontal runs merged so the path stays compact and edges stay crisp. The quiet zone is
 * not included; the caller pads the viewBox. Null when the text doesn't fit in a QR code.
 */
export function qrSvgPath(text: string, ecc: QrEcc = "M"): { size: number; path: string } | null {
  const m = qrMatrix(text, ecc);
  if (!m) return null;
  let path = "";
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.isDark(r, c)) { c++; continue; }
      const start = c;
      while (c < m.size && m.isDark(r, c)) c++;
      path += `M${start} ${r}h${c - start}v1h${start - c}z`;
    }
  }
  return { size: m.size, path };
}
