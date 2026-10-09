import { QR_QUIET_ZONE, RECEIPT_QR_ECC, qrMatrix } from "@/lib/qr";
import { drawShareCard, shortNoteId, type ShareCardData } from "./shareCard";

/** A 2D context that records text and filled rectangles; everything else is a no-op. */
function fakeContext() {
  const texts: string[] = [];
  const rects: [number, number, number, number, unknown][] = [];
  const state: Record<string, unknown> = { font: "10px sans-serif", fillStyle: "#000" };
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "fillText") return (t: string) => { texts.push(t); };
      if (prop === "fillRect") return (x: number, y: number, w: number, h: number) => { rects.push([x, y, w, h, target.fillStyle]); };
      if (prop === "measureText") return (t: string) => ({ width: t.length * (parseFloat(/(\d+)px/.exec(String(target.font))![1]) * 0.55) });
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => gradient;
      return () => {};
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, rects };
}

const URL_ = "https://notecheck.example/r#r1." + "Ab9_-".repeat(140);
const data: ShareCardData = {
  amount: { value: "1,250.5", unit: "USDCX", more: false },
  hideAmount: false,
  received: true,
  network: "testnet",
  noteId: "0x13d80a89d128fd636d7ca2bd35c672ab7ba1ed6be9fdf053f94e78d3af52406c",
  checked: "9 Oct 2026, 14:03 UTC",
  url: URL_,
  passwordRequired: false,
};

describe("drawShareCard", () => {
  it("draws the confirmed facts, the amount and the QR code", () => {
    const { ctx, texts, rects } = fakeContext();
    drawShareCard(ctx, data);
    expect(texts).toEqual(expect.arrayContaining([
      "Note", "Check", "testnet · test money", "Payment confirmed on Miden", "1,250.5", "USDCX",
      "Received by the recipient", "Scan to verify",
    ]));
    expect(texts).toContain("Note 0x13d8…406c  ·  Checked 9 Oct 2026, 14:03 UTC");
    expect(texts).not.toContain("Password required");
    // One rect per merged dark run, in the QR colour.
    const m = qrMatrix(URL_, RECEIPT_QR_ECC)!;
    let runs = 0;
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.isDark(r, c) && (c === 0 || !m.isDark(r, c - 1))) runs++;
    const qrRects = rects.filter((r) => r[4] === "#111118");
    expect(qrRects).toHaveLength(runs);
    // Snapped to whole pixels and inside the quiet zone.
    expect(qrRects.every(([x, y, w, h]) => [x, y, w, h].every(Number.isInteger))).toBe(true);
    expect(QR_QUIET_ZONE).toBe(4);
  });

  it("leaves the amount out when hidden and says so", () => {
    const { ctx, texts } = fakeContext();
    drawShareCard(ctx, { ...data, hideAmount: true, received: false, passwordRequired: true });
    expect(texts).toContain("Amount hidden");
    expect(texts.join(" ")).not.toMatch(/1,250|USDCX/);
    expect(texts).toContain("Not claimed by the recipient yet");
    expect(texts).not.toContain("Received by the recipient");
    expect(texts).toContain("Password required");
  });

  it("falls back to a text line when the link is too long for a QR code", () => {
    const { ctx, texts, rects } = fakeContext();
    drawShareCard(ctx, { ...data, url: "x".repeat(4000) });
    expect(texts).toContain("Open the receipt link to verify");
    expect(texts).not.toContain("Scan to verify");
    expect(rects.filter((r) => r[4] === "#111118")).toHaveLength(0);
  });

  it("shortens the note ID", () => {
    expect(shortNoteId(data.noteId)).toBe("0x13d8…406c");
    expect(shortNoteId("0x1234")).toBe("0x1234");
  });
});
