// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TESTNET_RECEIPT as R } from "./fixtures.js";
import { noteFileFromBase64 } from "../src/inspect.js";
import { decodeRequest } from "../src/request.js";
import { toBech32 } from "../src/account.js";
import { parseArgs, run, UsageError, type Io } from "../src/commands.js";

function io(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const x: Io = { out: (l) => out.push(l), err: (l) => err.push(l), env, color: false };
  return { io: x, out, err, text: () => out.join("\n") };
}

describe("parseArgs", () => {
  it("reads values, flags and positionals", () => {
    const p = parseArgs("verify", ["r1.x", "--password", "pw", "--json"]);
    expect(p.positionals).toEqual(["r1.x"]);
    expect(p.values).toEqual({ password: "pw" });
    expect([...p.flags]).toEqual(["json"]);
    expect(parseArgs("request", ["--to=a", "--amount", "1"]).values).toEqual({ to: "a", amount: "1" });
  });
  it("rejects unknown options, missing values and wrong argument counts", () => {
    expect(() => parseArgs("verify", ["x", "--nope"])).toThrow(UsageError);
    expect(() => parseArgs("verify", ["x", "--password"])).toThrow(/needs a value/);
    expect(() => parseArgs("verify", [])).toThrow(/takes 1 argument/);
    expect(() => parseArgs("request", ["extra"])).toThrow(/no arguments/);
    expect(() => parseArgs("verify", ["x", "--json=1"])).toThrow(/takes no value/);
  });
});

describe("run", () => {
  it("prints help, version and usage errors with exit codes", async () => {
    const h = io();
    expect(await run(["--help"], h.io)).toBe(0);
    expect(h.text()).toMatch(/notecheck verify <link-or-fragment>/);
    const v = io();
    expect(await run(["--version"], v.io)).toBe(0);
    expect(v.text()).toMatch(/^\d+\.\d+\.\d+$/);
    const bad = io();
    expect(await run(["frob"], bad.io)).toBe(2);
    expect(bad.err[0]).toMatch(/Unknown command "frob"/);
    expect(await run([], io().io)).toBe(2);
  });

  it("inspects a note file offline, from a path or base64", async () => {
    const dir = mkdtempSync(join(tmpdir(), "notecheck-"));
    const file = join(dir, "note.mno");
    writeFileSync(file, noteFileFromBase64(R.noteFileB64));
    for (const arg of [file, R.noteFileB64]) {
      const t = io();
      expect(await run(["inspect", arg], t.io)).toBe(0);
      expect(t.text()).toContain(R.noteId);
      expect(t.text()).toContain("P2ID, private");
      expect(t.text()).toContain("1000000 base units");
    }
    const j = io();
    expect(await run(["inspect", file, "--json"], j.io)).toBe(0);
    expect(JSON.parse(j.text())).toMatchObject({ noteId: R.noteId, recipient: { hex: R.recipient }, sender: { hex: R.sender } });
    const missing = io();
    expect(await run(["inspect", join(dir, "nope.mno")], missing.io)).toBe(2);
    expect(missing.err[0]).toMatch(/No such file/);
  });

  it("asks for the password of an encrypted link without echoing it", async () => {
    const t = io();
    expect(await run(["verify", "https://x/r#r1e.AAAA"], t.io)).toBe(2);
    expect(t.err[0]).toMatch(/password-protected.*NOTECHECK_PASSWORD/);
    const e = io({ NOTECHECK_PASSWORD: "secret-pass" });
    expect(await run(["verify", "r1e.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"], e.io)).toBe(2);
    expect(e.err.join("\n")).not.toContain("secret-pass");
    expect(e.err[0]).toMatch(/Wrong password/);
  });

  it("makes a request link, reading the token's decimals from the token list", async () => {
    const list = { tokens: [{ network: "testnet", faucetId: toBech32(R.faucetId, "testnet"), symbol: "USDCX", decimals: 6 }] };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(list)));
    try {
      const t = io();
      expect(await run([
        "request", "--to", R.recipient, "--amount", "1.5", "--usdcx", "--memo", "Invoice #7",
        "--base-url", "http://localhost:5199", "--json",
      ], t.io)).toBe(0);
      const out = JSON.parse(t.text());
      expect(out.url.startsWith("http://localhost:5199/?tool=pay#q1.")).toBe(true);
      expect(await decodeRequest(out.url)).toMatchObject({ amount: "1500000", memo: "Invoice #7", faucetId: R.faucetId });

      const h = io();
      expect(await run(["request", "--to", R.recipient, "--amount", "2", "--token", R.faucetId], h.io)).toBe(0);
      expect(h.out[0]).toBe(`Payment request: 2 USDCX to ${toBech32(R.recipient, "testnet")} on testnet`);
      expect(h.text()).toMatch(/unsigned/);
    } finally {
      vi.unstubAllGlobals();
    }
    const both = io();
    expect(await run(["request", "--to", R.recipient, "--amount", "1", "--usdcx", "--token", R.faucetId], both.io)).toBe(2);
    expect(both.err[0]).toMatch(/either --token or --usdcx/);
  });
});
