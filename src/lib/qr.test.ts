import { createHash } from "node:crypto";
import { RECEIPT_QR_ECC, qrMatrix, qrSvgPath } from "./qr";

/** Rebuilds the module matrix from the path's "M x y h w v1 h -w z" runs. */
function pathToMatrix(size: number, path: string): boolean[][] {
  const m = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let c = Number(x); c < Number(x) + Number(w); c++) m[Number(y)][c] = true;
  }
  return m;
}

const link = (n: number) => "https://notecheck.example/r#r1e." + "AbC-_9".repeat(Math.ceil(n / 6)).slice(0, n - 32);

describe("qrSvgPath", () => {
  it("is deterministic and starts with the top-left finder pattern", () => {
    const a = qrSvgPath("HELLO", "M")!;
    expect(a).toEqual(qrSvgPath("HELLO", "M"));
    expect(a.size).toBe(21); // version 1
    // Row 0: a 7-module finder edge at both corners.
    expect(a.path.startsWith("M0 0h7v1h-7z")).toBe(true);
    expect(a.path).toContain("M14 0h7v1h-7z");
    expect(createHash("sha256").update(a.path).digest("hex").slice(0, 16)).toMatchInlineSnapshot(`"a2f43f5c5294eefe"`);
  });

  it("draws exactly the dark modules, with merged runs", () => {
    const text = link(700);
    const m = qrMatrix(text, RECEIPT_QR_ECC)!;
    const p = qrSvgPath(text, RECEIPT_QR_ECC)!;
    expect(p.size).toBe(m.size);
    const rebuilt = pathToMatrix(p.size, p.path);
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) expect(rebuilt[r][c]).toBe(m.isDark(r, c));
    // Runs are merged: no run is directly followed by another on the same row.
    for (const [, x, y, w] of p.path.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      expect(p.path).not.toContain(`M${Number(x) + Number(w)} ${y}h`);
    }
  });

  it("fits a 900-character receipt link at low error correction", () => {
    const p = qrSvgPath(link(900), "L")!;
    expect(p).not.toBeNull();
    expect(p.size).toBe(17 + 4 * 21); // version 21
    expect(qrSvgPath(link(900), "M")!.size).toBeGreaterThan(p.size);
  });

  it("returns null for text beyond QR capacity", () => {
    expect(qrSvgPath("a".repeat(2953), "L")!.size).toBe(177); // version 40-L holds 2,953 bytes
    expect(qrSvgPath("a".repeat(2954), "L")).toBeNull();
    expect(qrSvgPath("a".repeat(2400), "M")).toBeNull();
    expect(qrMatrix("x".repeat(10_000))).toBeNull();
  });

  it("encodes non-ASCII as a percent-encoded URL instead of losing bytes", () => {
    expect(qrSvgPath("https://example.com/ü")).toEqual(qrSvgPath("https://example.com/%C3%BC"));
    expect(qrSvgPath("\ud800")).toBeNull();
  });
});
