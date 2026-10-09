// @vitest-environment node
import { Endpoint, RpcClient, type AccountId } from "@miden-sdk/miden-sdk";
import { checkAccountAllowed, type AllowlistRpc } from "./allowlist";

const BECH32 = "mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk_qr7qqq9wr6w";

function fake(answer: boolean | Error) {
  const seen: string[] = [];
  const rpc: AllowlistRpc = {
    isAccountAllowed: async (id: AccountId) => {
      seen.push(id.toString());
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { rpc, seen };
}

describe("checkAccountAllowed", () => {
  it("passes the parsed account ID to the node and returns its answer", async () => {
    const yes = fake(true);
    const r = await checkAccountAllowed(yes.rpc, BECH32);
    expect(r.allowed).toBe(true);
    expect(r.hex).toMatch(/^0x[0-9a-f]{30}$/);
    expect(yes.seen).toEqual([r.hex]);

    const no = fake(false);
    expect(await checkAccountAllowed(no.rpc, r.hex.toUpperCase().replace("0X", "0x"))).toEqual({ hex: r.hex, allowed: false });
  });
  it("rejects bad input without calling the node", async () => {
    const f = fake(true);
    await expect(checkAccountAllowed(f.rpc, "")).rejects.toThrow(/Enter/);
    await expect(checkAccountAllowed(f.rpc, "0x1234")).rejects.toThrow(/30 hex/);
    await expect(checkAccountAllowed(f.rpc, "nonsense")).rejects.toThrow();
    expect(f.seen).toEqual([]);
  });
  it("propagates RPC errors", async () => {
    const f = fake(new Error("unavailable"));
    await expect(checkAccountAllowed(f.rpc, BECH32)).rejects.toThrow("unavailable");
  });
});

describe.runIf(import.meta.env.LIVE === "1")("checkAccountAllowed (live testnet)", () => {
  it("gets a boolean from the node", async () => {
    const r = await checkAccountAllowed(new RpcClient(Endpoint.testnet()), BECH32);
    expect(typeof r.allowed).toBe("boolean");
  }, 30_000);
});
