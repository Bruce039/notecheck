import { useMemo, useState } from "react";
import { Badge, Field, Notice, TextInput, ToolCard } from "@/components/ui";
import { attempt } from "@/lib/attempt";
import { MODULUS, feltInfo, parseUint, parseWord } from "./felt";

export function FeltTool() {
  const [num, setNum] = useState("");
  const [word, setWord] = useState("");
  const f = useMemo(() => attempt(num, (s) => feltInfo(parseUint(s))), [num]);
  const w = useMemo(() => attempt(word, parseWord), [word]);

  return (
    <ToolCard
      title="Felt / Word"
      intro={<>Field elements live in the Goldilocks field, p = 2<sup>64</sup> − 2<sup>32</sup> + 1. A word is four felts.</>}
    >
      <h3>Felt</h3>
      <TextInput label="Integer (decimal or 0x hex)" value={num} onChange={setNum}
        placeholder="18446744069414584320" example={(MODULUS - 1n).toString()} />
      {f.error && <Notice tone="bad">{f.error}</Notice>}
      {f.result && (
        <>
          <div className="badges">
            {f.result.canonical
              ? <Badge tone="good">valid felt</Badge>
              : f.result.fitsU64
                ? <Badge tone="warn">≥ p: reduced mod p</Badge>
                : <Badge tone="bad">exceeds u64</Badge>}
          </div>
          {!f.result.canonical && (
            <Notice>
              {f.result.fitsU64
                ? "This fits in a u64 but not in a felt. Passing it to the SDK throws; inside the VM it wraps to the value below."
                : "Larger than 2^64 − 1. It cannot be a u64 or a felt."}
            </Notice>
          )}
          <div className="grid">
            <Field label="Decimal" value={f.result.value.toString()} />
            <Field label="Hex (u64, big-endian)" value={f.result.hex} />
            {!f.result.canonical && <Field label="mod p" value={f.result.reduced.toString()} />}
          </div>
        </>
      )}

      <h3>Word</h3>
      <TextInput label="Four felts, or 0x + 64 hex chars" value={word} onChange={setWord}
        placeholder="[1, 2, 3, 4]  or  0x0100…" example="[1, 2, 3, 4]" />
      {w.error && <Notice tone="bad">{w.error}</Notice>}
      {w.result && (
        <div className="grid">
          <Field label="Word hex" value={w.result.hex}
            hint="The SDK's encoding: each felt as 8 little-endian bytes, felt 0 first." />
          <Field label="Felts" value={`[${w.result.felts.join(", ")}]`} />
        </div>
      )}
    </ToolCard>
  );
}
