import { useMemo, useState } from "react";
import { Badge, Field, Notice, TextInput, ToolCard } from "@/components/ui";
import { attempt } from "@/lib/attempt";
import { encodeString, hashFelts, parseFelts, type Digest } from "./hash";

type Mode = "felts" | "string";

function DigestFields({ name, d, hint }: { name: string; d: Digest; hint?: string }) {
  return (
    <>
      <h3>{name}</h3>
      <div className="grid">
        <Field label="Digest (word hex)" value={d.hex} hint={hint} />
        <Field label="Digest felts" value={`[${d.felts.join(", ")}]`} />
      </div>
    </>
  );
}

export function HashTool() {
  const [mode, setMode] = useState<Mode>("felts");
  const [text, setText] = useState("");

  const r = useMemo(() => {
    if (mode === "felts") return attempt(text, (s) => hashFelts(parseFelts(s)));
    // Whitespace is meaningful in a string, so only the truly empty input is skipped.
    if (text === "") return {};
    try {
      return { result: hashFelts(encodeString(text)) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [mode, text]);

  return (
    <ToolCard
      title="Hash"
      intro={<>Hashes field elements with Poseidon2, the protocol's native hash, and with RPO256 for comparison.</>}
    >
      <label className="input">
        <span className="input-label">Input</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="felts">Felts</option>
          <option value="string">UTF-8 string</option>
        </select>
      </label>

      {mode === "felts" ? (
        <TextInput label="Felts (decimal or 0x hex, comma or space separated)" value={text} onChange={setText}
          placeholder="[1, 2, 3]  or  [] for the empty list" example="[1, 2, 3]" />
      ) : (
        <>
          <TextInput label="Text" value={text} onChange={setText} placeholder="hello" example="hello" />
          <Notice tone="info">
            Encoding (this tool's convention, not a protocol standard): UTF-8 bytes in 4-byte chunks, each read as a
            little-endian u32 felt, last chunk zero-padded. No length prefix, so trailing NUL bytes do not change the
            digest.
          </Notice>
        </>
      )}

      {r.error && <Notice tone="bad">{r.error}</Notice>}
      {r.result && (
        <>
          <div className="badges">
            <Badge>{r.result.input.length} felt{r.result.input.length === 1 ? "" : "s"}</Badge>
            {r.result.input.length === 0 && <Badge tone="warn">empty input: zero word</Badge>}
          </div>
          {mode === "string" && (
            <div className="grid">
              <Field label="Encoded felts" value={`[${r.result.input.join(", ")}]`} />
            </div>
          )}
          <DigestFields name="Poseidon2" d={r.result.poseidon2}
            hint="The SDK's word encoding: each felt as 8 little-endian bytes, felt 0 first." />
          <DigestFields name="RPO256" d={r.result.rpo256} />
        </>
      )}
    </ToolCard>
  );
}
