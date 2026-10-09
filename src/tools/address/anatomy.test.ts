// @vitest-environment node
import { accountTag } from "@/tools/tag/tag";
import { decodeAccount } from "./account";
import { accountSegments, bitColumn, feltBits, inSegment, segmentAt, type Row } from "./anatomy";

const WALLET_HEX = "0x790a5c308e26618159a26f324f22f3"; // private, version 1, no callbacks
const FEE_FAUCET_HEX = "0x4cbdcaffe75f0a317482224dae6436"; // public

const segmentsFor = (hex: string) => {
  const a = decodeAccount(hex);
  return { a, segs: accountSegments({ ...a, tagHex: accountTag(hex).hex }) };
};

describe("feltBits", () => {
  it("renders 64 bits, most significant first", () => {
    expect(feltBits(1n)).toBe("0".repeat(63) + "1");
    expect(feltBits(0x8000000000000000n)).toBe("1" + "0".repeat(63));
    expect(() => feltBits(1n << 64n)).toThrow();
    expect(() => feltBits(-1n)).toThrow();
  });
});

describe("accountSegments", () => {
  it("tiles each row exactly once with the documented widths (tag is an overlay)", () => {
    const { segs } = segmentsFor(WALLET_HEX);
    const layout = segs.filter((s) => s.id !== "tag");
    for (const row of ["prefix", "suffix"] as Row[]) {
      for (let pos = 0; pos < 64; pos++) {
        const owners = layout.filter((s) => inSegment(s, row, pos));
        expect(owners.map((s) => s.id)).toEqual([segmentAt(row, pos)]);
      }
    }
    const bits = Object.fromEntries(segs.map((s) => [s.id, s.bits]));
    expect(bits).toEqual({ tag: 14, hash: 58 + 55, callbacks: 1, type: 1, version: 4, zero: 1, dropped: 8 });
    // 120 stored bits: everything but the dropped low byte of the suffix.
    expect(layout.filter((s) => s.id !== "dropped").reduce((n, s) => n + s.bits, 0)).toBe(120);
  });

  it("matches what decodeAccount reads from the same bits", () => {
    for (const hex of [WALLET_HEX, FEE_FAUCET_HEX]) {
      const { a, segs } = segmentsFor(hex);
      const b = feltBits(a.prefix);
      const by = Object.fromEntries(segs.map((s) => [s.id, s]));
      expect(parseInt(b.slice(60), 2)).toBe(a.version);
      expect(b[59] === "1").toBe(a.visibility === "public");
      expect(b[58] === "1").toBe(a.assetCallbacks);
      expect(by.type.value).toBe(a.visibility);
      expect(by.version.phrase).toBe(`version ${a.version}`);
      expect(by.callbacks.phrase).toBe(a.assetCallbacks ? "callbacks on" : "callbacks off");
    }
    const { segs } = segmentsFor(WALLET_HEX);
    expect(segs.find((s) => s.id === "type")!.value).toBe("private");
    expect(segs.find((s) => s.id === "version")!.value).toBe("1");
    expect(segs.find((s) => s.id === "callbacks")!.value).toBe("off");
  });

  it("brackets exactly the prefix bits the default note tag copies", () => {
    for (const hex of [WALLET_HEX, FEE_FAUCET_HEX]) {
      const { a, segs } = segmentsFor(hex);
      const tag = segs.find((s) => s.id === "tag")!;
      const [range] = tag.ranges;
      const t = accountTag(hex);
      expect(tag.value).toBe(t.hex);
      expect(range).toEqual({ row: "prefix", start: 0, end: t.length });
      expect(feltBits(a.prefix).slice(0, t.length)).toBe(t.bits.slice(0, t.length));
    }
  });

  it("keeps the suffix zero bits zero", () => {
    for (const hex of [WALLET_HEX, FEE_FAUCET_HEX]) {
      const s = feltBits(decodeAccount(hex).suffix);
      expect(s[0]).toBe("0");
      expect(s.slice(56)).toBe("00000000");
    }
  });
});

describe("bitColumn", () => {
  it("skips one spacer column per byte", () => {
    expect([0, 7, 8, 15, 16, 31].map(bitColumn)).toEqual([1, 8, 10, 17, 19, 35]);
  });
});
