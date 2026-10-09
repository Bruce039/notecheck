// @vitest-environment node
import { decodeAccount } from "./account";

// Real testnet accounts created during the spike.
const WALLET_HEX = "0x790a5c308e26618159a26f324f22f3";
const WALLET_MTST = "mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk";
const WALLET_MTST_IF = "mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk_qr7qqq9wr6w";
const FEE_FAUCET_HEX = "0x4cbdcaffe75f0a317482224dae6436";

describe("decodeAccount", () => {
  it("decodes a hex ID", () => {
    const a = decodeAccount(WALLET_HEX);
    expect(a.hex).toBe(WALLET_HEX);
    expect(a.prefix).toBe(0x790a5c308e266181n);
    expect(a.suffix).toBe(0x59a26f324f22f300n);
    expect(a.version).toBe(1);
    expect(a.visibility).toBe("private");
    expect(a.assetCallbacks).toBe(false);
    expect(a.input).toEqual({ kind: "hex" });
    expect(a.bech32.testnet).toBe(WALLET_MTST);
    expect(a.bech32Wallet.testnet).toBe(WALLET_MTST_IF);
    expect(a.bech32.mainnet.startsWith("mm1")).toBe(true);
    expect(a.bech32.devnet.startsWith("mdev1")).toBe(true);
  });

  it("decodes bech32 with and without the interface suffix", () => {
    for (const s of [WALLET_MTST, WALLET_MTST_IF, ` ${WALLET_HEX.toUpperCase().replace("0X", "0x")} `]) {
      expect(decodeAccount(s).hex).toBe(WALLET_HEX);
    }
    expect(decodeAccount(WALLET_MTST_IF).input).toEqual({
      kind: "bech32", hrp: "mtst", network: "testnet", hasInterface: true,
    });
  });

  it("reads the public bit", () => {
    expect(decodeAccount(FEE_FAUCET_HEX).visibility).toBe("public");
  });

  it("round-trips across networks", () => {
    const a = decodeAccount(WALLET_HEX);
    expect(decodeAccount(a.bech32.mainnet).input).toMatchObject({ network: "mainnet" });
    expect(decodeAccount(a.bech32.mainnet).hex).toBe(WALLET_HEX);
  });

  it("rejects bad input with readable errors", () => {
    expect(() => decodeAccount("")).toThrow();
    expect(() => decodeAccount("0x790a")).toThrow(/30 hex/);
    expect(() => decodeAccount(WALLET_MTST.slice(0, -1) + "q")).toThrow(/checksum/);
    expect(() => decodeAccount("hello")).toThrow();
  });
});
