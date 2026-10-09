// @vitest-environment node
import { Endpoint, RpcClient, type AccountId } from "@miden-sdk/miden-sdk";
import { UnsupportedError, checkAccountAllowed, checkInvitationCode, type AllowlistRpc } from "./allowlist";

const BECH32 = "mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk_qr7qqq9wr6w";

function fake(answer: boolean | Error) {
  const seen: string[] = [];
  const rpc: Pick<AllowlistRpc, "isAccountAllowed"> = {
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

describe("checkInvitationCode", () => {
  const codeRpc = (answer: boolean | Error) => {
    const seen: string[] = [];
    return {
      seen,
      rpc: { isInvitationCodeValid: async (c: string) => { seen.push(c); if (answer instanceof Error) throw answer; return answer; } },
    };
  };
  it("asks the node with the trimmed code and returns its answer", async () => {
    const yes = codeRpc(true), no = codeRpc(false);
    expect(await checkInvitationCode(yes.rpc, "  ABC-123  ")).toBe(true);
    expect(await checkInvitationCode(no.rpc, "ABC-123")).toBe(false);
    expect(yes.seen).toEqual(["ABC-123"]);
  });
  it("rejects empty, spaced, control-character or overlong input without calling the node", async () => {
    const f = codeRpc(true);
    await expect(checkInvitationCode(f.rpc, "   ")).rejects.toThrow(/Enter/);
    await expect(checkInvitationCode(f.rpc, "two words")).rejects.toThrow(/invite code/);
    await expect(checkInvitationCode(f.rpc, "a\u0000b")).rejects.toThrow(/invite code/);
    await expect(checkInvitationCode(f.rpc, "x".repeat(129))).rejects.toThrow(/invite code/);
    expect(f.seen).toEqual([]);
  });
  it("propagates RPC errors", async () => {
    await expect(checkInvitationCode(codeRpc(new Error("down")).rpc, "ABC")).rejects.toThrow("down");
  });
  it("reports nodes without the endpoint as unsupported", async () => {
    const old = codeRpc(new Error("grpc request failed: the requested method is not implemented by this version of the Miden node"));
    await expect(checkInvitationCode(old.rpc, "ABC")).rejects.toBeInstanceOf(UnsupportedError);
  });
});

describe.runIf(import.meta.env.LIVE === "1")("checkAccountAllowed (live testnet)", () => {
  it("gets a boolean from the node", async () => {
    const r = await checkAccountAllowed(new RpcClient(Endpoint.testnet()), BECH32);
    expect(typeof r.allowed).toBe("boolean");
  }, 30_000);
  it("checks an invite code without consuming it", async () => {
    // Testnet nodes without the allowlist release answer "not implemented" (seen 2026-10-09).
    const rpc = new RpcClient(Endpoint.testnet());
    const answer = await checkInvitationCode(rpc, "notecheck-test-code").catch((e: unknown) => e);
    expect(typeof answer === "boolean" || answer instanceof UnsupportedError).toBe(true);
  }, 30_000);
});
