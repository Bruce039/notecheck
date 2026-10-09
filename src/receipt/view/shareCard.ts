// The shareable receipt image: a 1200×630 PNG card drawn on a canvas in the browser. It is an
// image, so it uses fixed light colours whatever the page theme. It carries only chain-confirmed
// facts (amount unless hidden, status, network, short note ID, check date) and a QR code to the
// receipt; the sender's memo is never part of it. Drawing is separate from the canvas so it can be
// tested with a fake 2D context.
import { QR_QUIET_ZONE, RECEIPT_QR_ECC, qrMatrix } from "@/lib/qr";
import { BRAND } from "@/brand";
import { type Network } from "notecheck";

export const CARD_W = 1200;
export const CARD_H = 630;
export const SHARE_FILE_NAME = "notecheck-receipt.png";

export type ShareCardData = {
  /** First fungible asset; null when the note carries none. */
  amount: { value: string; unit: string; more: boolean } | null;
  hideAmount: boolean;
  /** True once the recipient has claimed the note (chain-confirmed). */
  received: boolean;
  network: Network;
  noteId: string;
  /** When this browser checked the receipt, already formatted. */
  checked: string;
  /** The receipt link the QR code opens (never contains a password). */
  url: string;
  passwordRequired: boolean;
};

const C = {
  bg: "#efedf8",
  paper: "#ffffff",
  ink: "#16161d",
  muted: "#5e5e6e",
  faint: "#8c8ca1",
  line: "#e3e3ea",
  chip: "#f3f3f7",
  accent: "#3b2fc9",
  good: "#17663f",
  goodSoft: "#e6f4ec",
  qr: "#111118",
};
const SANS = `"Plus Jakarta Sans Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

// Layout: a paper slip with a torn bottom edge, details on the left, the QR panel on the right.
const SLIP = { x: 40, y: 36, w: 1120, h: 552, r: 26, tooth: 16, toothH: 8 };
const LEFT = 92;
const SPLIT = 784;
const LEFT_MAX = SPLIT - LEFT - 40;
const PANEL_CX = (SPLIT + SLIP.x + SLIP.w) / 2;

type Ctx = CanvasRenderingContext2D;

export const shortNoteId = (id: string) => (id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);

const netText = (n: Network) => (n === "mainnet" ? "mainnet" : `${n} · test money`);

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function setSpacing(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Shrinks a font until `text` fits `max` pixels; returns the size used. */
function fitFont(ctx: Ctx, text: string, weight: number, size: number, min: number, max: number, family = SANS): number {
  for (; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= max) return size;
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return min;
}

function drawSlip(ctx: Ctx) {
  const { x, y, w, h, r, tooth, toothH } = SLIP;
  const bottom = y + h;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, bottom, r);
  ctx.lineTo(x + w, bottom);
  // Torn edge: a row of teeth from right to left.
  const n = Math.round(w / tooth);
  const step = w / n;
  for (let i = 0; i < n; i++) {
    ctx.lineTo(x + w - (i + 0.5) * step, bottom + toothH);
    ctx.lineTo(x + w - (i + 1) * step, bottom);
  }
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLogo(ctx: Ctx, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 64, size / 64);
  ctx.beginPath();
  ctx.moveTo(17, 12);
  ctx.arcTo(17, 8, 21, 8, 4);
  ctx.lineTo(43, 8);
  ctx.arcTo(47, 8, 47, 12, 4);
  ctx.lineTo(47, 54);
  for (const [px, py] of [[42, 50.5], [37, 54], [32, 50.5], [27, 54], [22, 50.5], [17, 54]]) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(24, 31);
  ctx.lineTo(30, 37);
  ctx.lineTo(41, 25);
  ctx.strokeStyle = C.paper;
  ctx.lineWidth = 5.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function drawCheckDisc(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
  ctx.fillStyle = C.goodSoft;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = C.good;
  ctx.fill();
  const k = r / 22;
  ctx.beginPath();
  ctx.moveTo(cx - 9.5 * k, cy + 0.5 * k);
  ctx.lineTo(cx - 3 * k, cy + 7 * k);
  ctx.lineTo(cx + 9.5 * k, cy - 6 * k);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4 * k;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function pill(ctx: Ctx, text: string, x: number, y: number, h: number, font: string, colors: { bg: string; fg: string; border?: string }, padX = 16, align: "left" | "right" = "left") {
  ctx.font = font;
  setSpacing(ctx, 0.5);
  const w = ctx.measureText(text).width + padX * 2;
  const left = align === "right" ? x - w : x;
  roundRect(ctx, left, y, w, h, h / 2);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  if (colors.border) {
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = colors.fg;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + padX, y + h / 2 + 1);
  ctx.textBaseline = "alphabetic";
  setSpacing(ctx, 0);
  return w;
}

/** The QR code's modules, snapped to whole pixels so edges stay sharp. Returns false if it doesn't fit. */
function drawQr(ctx: Ctx, url: string, x: number, y: number, size: number): boolean {
  const m = qrMatrix(url, RECEIPT_QR_ECC);
  if (!m) return false;
  const total = m.size + 2 * QR_QUIET_ZONE;
  const cell = size / total;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = C.qr;
  const at = (i: number) => Math.round((i + QR_QUIET_ZONE) * cell);
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.isDark(r, c)) { c++; continue; }
      const start = c;
      while (c < m.size && m.isDark(r, c)) c++;
      ctx.fillRect(x + at(start), y + at(r), at(c) - at(start), at(r + 1) - at(r));
    }
  }
  return true;
}

/** Draws the whole card onto a 1200×630 context. */
export function drawShareCard(ctx: Ctx, d: ShareCardData) {
  // Background with a soft green glow behind the verdict.
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = ctx.createRadialGradient(260, 170, 10, 260, 170, 560);
  glow.addColorStop(0, "rgba(23, 102, 63, 0.16)");
  glow.addColorStop(1, "rgba(23, 102, 63, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow2 = ctx.createRadialGradient(1060, 560, 10, 1060, 560, 520);
  glow2.addColorStop(0, "rgba(59, 47, 201, 0.13)");
  glow2.addColorStop(1, "rgba(59, 47, 201, 0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // The paper slip, with a soft shadow.
  ctx.save();
  ctx.shadowColor = "rgba(22, 22, 29, 0.14)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  drawSlip(ctx);
  ctx.fillStyle = C.paper;
  ctx.fill();
  ctx.restore();

  // Perforation between the details and the QR panel, notched at the top edge.
  ctx.save();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(SPLIT, SLIP.y + 34);
  ctx.lineTo(SPLIT, SLIP.y + SLIP.h - 24);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(SPLIT, SLIP.y, 15, 0, Math.PI);
  ctx.fillStyle = C.bg;
  ctx.fill();

  // Brand.
  const top = SLIP.y + 50;
  drawLogo(ctx, LEFT - 8, top - 6, 46);
  ctx.textBaseline = "middle";
  ctx.font = `800 30px ${SANS}`;
  setSpacing(ctx, -0.4);
  ctx.fillStyle = C.ink;
  ctx.fillText(BRAND.lead, LEFT + 44, top + 17);
  const leadW = ctx.measureText(BRAND.lead).width;
  ctx.fillStyle = C.accent;
  ctx.fillText(BRAND.tail, LEFT + 44 + leadW, top + 17);
  setSpacing(ctx, 0);
  ctx.textBaseline = "alphabetic";
  pill(ctx, netText(d.network), SPLIT - 40, top - 1, 36, `600 17px ${SANS}`, { bg: C.chip, fg: C.muted, border: C.line }, 15, "right");

  // Verdict.
  const vy = top + 112;
  drawCheckDisc(ctx, LEFT + 22, vy, 22);
  ctx.fillStyle = C.good;
  fitFont(ctx, "Payment confirmed on Miden", 750, 36, 26, LEFT_MAX - 64);
  setSpacing(ctx, -0.4);
  ctx.textBaseline = "middle";
  ctx.fillText("Payment confirmed on Miden", LEFT + 64, vy + 1);
  ctx.textBaseline = "alphabetic";
  setSpacing(ctx, 0);

  // Amount.
  const ay = vy + 76;
  ctx.font = `600 15px ${MONO}`;
  setSpacing(ctx, 1.8);
  ctx.fillStyle = C.muted;
  ctx.fillText("AMOUNT", LEFT, ay);
  setSpacing(ctx, 0);
  const base = ay + 104;
  if (!d.amount || d.hideAmount) {
    const text = d.amount ? "Amount hidden" : "No fungible assets";
    ctx.font = `700 26px ${SANS}`;
    const w = ctx.measureText(text).width + 112;
    roundRect(ctx, LEFT, base - 72, w, 76, 18);
    ctx.fillStyle = C.chip;
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.stroke();
    ctx.restore();
    if (d.amount) {
      // Three blurred-looking bars stand in for the digits.
      ctx.fillStyle = "#d4d4de";
      for (let i = 0; i < 3; i++) { roundRect(ctx, LEFT + 24 + i * 22, base - 44, 14, 20, 4); ctx.fill(); }
    }
    ctx.fillStyle = C.muted;
    ctx.textBaseline = "middle";
    ctx.fillText(text, LEFT + (d.amount ? 92 : 28), base - 33);
    ctx.textBaseline = "alphabetic";
  } else {
    const { value, unit, more } = d.amount;
    const unitFont = `700 24px ${SANS}`;
    ctx.font = unitFont;
    const unitW = ctx.measureText(unit).width + 36;
    const moreW = more ? 110 : 0;
    const size = fitFont(ctx, value, 800, 116, 48, LEFT_MAX - unitW - moreW - 22);
    setSpacing(ctx, -size * 0.03);
    ctx.fillStyle = C.ink;
    ctx.fillText(value, LEFT - 4, base);
    const vw = ctx.measureText(value).width;
    setSpacing(ctx, 0);
    const px = LEFT + vw + 18;
    pill(ctx, unit, px, base - 48, 48, unitFont, { bg: C.chip, fg: C.ink, border: C.line }, 18);
    if (more) {
      ctx.font = `600 20px ${SANS}`;
      ctx.fillStyle = C.muted;
      ctx.fillText("+ more", px + unitW + 16, base - 16);
    }
  }
  // Accent rule under the amount, as on the receipt page.
  const rule = ctx.createLinearGradient(LEFT, 0, LEFT + 88, 0);
  rule.addColorStop(0, C.accent);
  rule.addColorStop(1, "rgba(59, 47, 201, 0)");
  ctx.fillStyle = rule;
  ctx.fillRect(LEFT, base + 20, 88, 4);

  // Status.
  const sy = base + 76;
  ctx.font = `650 24px ${SANS}`;
  ctx.textBaseline = "middle";
  if (d.received) {
    ctx.beginPath();
    ctx.moveTo(LEFT + 1, sy);
    ctx.lineTo(LEFT + 8, sy + 7);
    ctx.lineTo(LEFT + 21, sy - 7);
    ctx.strokeStyle = C.good;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = C.good;
    ctx.fillText("Received by the recipient", LEFT + 34, sy + 1);
  } else {
    ctx.beginPath();
    ctx.arc(LEFT + 10, sy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = C.faint;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.fillText("Not claimed by the recipient yet", LEFT + 34, sy + 1);
  }

  // Footer facts.
  const fy = SLIP.y + SLIP.h - 44;
  ctx.fillStyle = C.line;
  ctx.fillRect(LEFT, fy - 30, LEFT_MAX, 1.5);
  const meta = `Note ${shortNoteId(d.noteId)}  ·  Checked ${d.checked}`;
  fitFont(ctx, meta, 500, 18, 13, LEFT_MAX, MONO);
  ctx.fillStyle = C.muted;
  ctx.fillText(meta, LEFT, fy);
  ctx.textBaseline = "alphabetic";

  // QR panel.
  const qrSize = 272;
  const qx = Math.round(PANEL_CX - qrSize / 2);
  const qy = SLIP.y + 56;
  ctx.textAlign = "center";
  if (drawQr(ctx, d.url, qx, qy, qrSize)) {
    roundRect(ctx, qx - 10, qy - 10, qrSize + 20, qrSize + 20, 20);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `750 26px ${SANS}`;
    ctx.fillStyle = C.ink;
    ctx.fillText("Scan to verify", PANEL_CX, qy + qrSize + 60);
    ctx.font = `500 17px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.fillText("Checks it again on the Miden network", PANEL_CX, qy + qrSize + 90);
  } else {
    ctx.font = `600 20px ${SANS}`;
    ctx.fillStyle = C.muted;
    ctx.fillText("Open the receipt link to verify", PANEL_CX, qy + qrSize / 2);
  }
  if (d.passwordRequired) {
    ctx.textAlign = "left";
    ctx.font = `600 16px ${SANS}`;
    const w = ctx.measureText("Password required").width + 32;
    pill(ctx, "Password required", PANEL_CX - w / 2, qy + qrSize + 112, 32, `600 16px ${SANS}`, { bg: "#eeecff", fg: C.accent }, 16);
  }
  ctx.textAlign = "left";
}

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`800 116px "Plus Jakarta Sans Variable"`, "0123456789.,"),
      document.fonts.load(`600 24px "Plus Jakarta Sans Variable"`, "NoteCheck"),
    ]);
    await document.fonts.ready;
  } catch { /* fall back to system fonts */ }
}

/** Draws the card on a fresh canvas and encodes it as PNG. */
export async function renderShareCard(d: ShareCardData): Promise<{ blob: Blob; dataUrl: string }> {
  await fontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw images.");
  drawShareCard(ctx, d);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image couldn't be encoded."))), "image/png"));
  return { blob, dataUrl: canvas.toDataURL("image/png") };
}

/** The PNG as a file for the share sheet. */
export const shareFile = (blob: Blob) => new File([blob], SHARE_FILE_NAME, { type: "image/png" });

export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === "function" && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/** Saves the PNG through a download link (a navigation, not an image load, so the CSP allows it). */
export function downloadBlob(blob: Blob, name = SHARE_FILE_NAME) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
