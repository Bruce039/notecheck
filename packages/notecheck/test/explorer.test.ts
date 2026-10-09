// @vitest-environment node
import { explorerUrl } from "../src/explorer.js";

const TX = "0xbe24060c7ec9849e06ce6257660a9dbe5791aba6d004f8a7cb07d2ffd0d0c424";

describe("explorerUrl", () => {
  it("builds Midenscan links per kind and network", () => {
    expect(explorerUrl("testnet", "tx", TX)).toBe(`https://testnet.midenscan.com/tx/${TX}`);
    expect(explorerUrl("devnet", "block", 83790)).toBe("https://devnet.midenscan.com/block/83790");
    expect(explorerUrl("testnet", "account", "mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk"))
      .toBe("https://testnet.midenscan.com/account/mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk");
    expect(explorerUrl("testnet", "account", "0x790a5c308e26618159a26f324f22f3")).toMatch(/\/account\/0x790a/);
  });
  it("returns null for mainnet and malformed ids", () => {
    expect(explorerUrl("mainnet", "tx", TX)).toBeNull();
    expect(explorerUrl("testnet", "tx", "wallet-internal-id")).toBeNull();
    expect(explorerUrl("testnet", "note", "0x12")).toBeNull();
    expect(explorerUrl("testnet", "block", "1; drop")).toBeNull();
    expect(explorerUrl("testnet", "account", "javascript:alert(1)")).toBeNull();
  });
});
