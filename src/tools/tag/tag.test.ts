// @vitest-environment node
import { accountTag } from "./tag";

const WALLET_HEX = "0x790a5c308e26618159a26f324f22f3"; // prefix 0x790a5c308e266181

describe("accountTag", () => {
  it("keeps the top 14 bits of the prefix by default", () => {
    const t = accountTag(WALLET_HEX);
    expect(t.hex).toBe("0x79080000");
    expect(t.bits.slice(0, 14)).toBe((0x790an >> 2n).toString(2).padStart(14, "0"));
    expect(t.bits.slice(14)).toBe("0".repeat(18));
  });
  it("supports custom lengths", () => {
    expect(accountTag(WALLET_HEX, 0).hex).toBe("0x00000000");
    expect(accountTag(WALLET_HEX, 8).hex).toBe("0x79000000");
    expect(accountTag(WALLET_HEX, 32).hex).toBe("0x790a5c30");
  });
  it("rejects lengths outside 0-32", () => {
    expect(() => accountTag(WALLET_HEX, 33)).toThrow();
    expect(() => accountTag(WALLET_HEX, -1)).toThrow();
  });
});
