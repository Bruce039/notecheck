// @vitest-environment node
import { endpoint, networkFromHrp, NETWORKS, HRP } from "./network";
import { rpcClient, withRpc } from "./rpc";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("withRpc", () => {
  it("runs calls on one network strictly one after another", async () => {
    const log: string[] = [];
    let running = 0;
    const job = (name: string, ms: number) => withRpc("testnet", async () => {
      running++;
      expect(running).toBe(1);
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
      running--;
      return name;
    });
    expect(await Promise.all([job("a", 20), job("b", 1), job("c", 5)])).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("keeps the queue going after a failure", async () => {
    const failed = withRpc("testnet", async () => { throw new Error("boom"); });
    const next = withRpc("testnet", async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });

  it("does not make one network wait for another", async () => {
    let release!: () => void;
    const slow = withRpc("testnet", () => new Promise<string>((r) => { release = () => r("testnet"); }));
    await tick();
    await expect(withRpc("devnet", async () => "devnet")).resolves.toBe("devnet");
    release();
    await expect(slow).resolves.toBe("testnet");
  });

  it("rejects (rather than throwing synchronously) for mainnet and keeps working afterwards", async () => {
    let p: Promise<unknown> | undefined;
    expect(() => { p = withRpc("mainnet", async () => "never"); }).not.toThrow();
    await expect(p).rejects.toThrow(/Mainnet RPC is not public/);
    expect(() => rpcClient("mainnet")).toThrow(/Mainnet/);
  });

  it("reuses one client per network", () => {
    expect(rpcClient("testnet")).toBe(rpcClient("testnet"));
    expect(rpcClient("devnet")).not.toBe(rpcClient("testnet"));
  });
});

describe("network", () => {
  it("maps HRPs both ways and rejects unknown ones", () => {
    for (const n of NETWORKS) expect(networkFromHrp(HRP[n])).toBe(n);
    expect(networkFromHrp("MTST")).toBe("testnet");
    expect(networkFromHrp("mcst")).toBeNull();
    expect(networkFromHrp("")).toBeNull();
  });
  it("has endpoints for testnet and devnet only", () => {
    expect(() => endpoint("testnet")).not.toThrow();
    expect(() => endpoint("devnet")).not.toThrow();
    expect(() => endpoint("mainnet")).toThrow();
  });
});
