import { useMemo, useState } from "react";
import { Field, Notice, TextInput, ToolCard } from "@/components/ui";
import { attempt } from "@/lib/attempt";
import { DEFAULT_TAG_LENGTH, MAX_TAG_LENGTH, accountTag } from "./tag";

const EXAMPLE = "mtst1apus5hps3cnxrq2e5fhnynez7v5sytsk";

export function TagTool() {
  const [input, setInput] = useState("");
  const [length, setLength] = useState(DEFAULT_TAG_LENGTH);
  const { result: t, error } = useMemo(() => attempt(input, (s) => accountTag(s, length)), [input, length]);

  return (
    <ToolCard
      title="Note tag"
      intro="The tag a note to this account carries. Clients sync notes by tag, so the length trades privacy for less noise."
    >
      <TextInput label="Target account (address or 0x ID)" value={input} onChange={setInput}
        placeholder="mtst1… or 0x…" example={EXAMPLE} />
      <label className="input">
        <span className="input-label">Tag length: {length} bits {length === DEFAULT_TAG_LENGTH && "(default)"}</span>
        <input type="range" min={0} max={MAX_TAG_LENGTH} value={length}
          onChange={(e) => setLength(Number(e.target.value))} />
      </label>
      {error && <Notice tone="bad">{error}</Notice>}
      {t && (
        <>
          <div className="grid">
            <Field label="Tag (hex)" value={t.hex} />
            <Field label="Tag (u32)" value={String(t.value)} />
            <Field label="Matches" value={t.anonymitySet} copy={false}
              hint="Share of accounts whose notes look the same to the node." />
          </div>
          <div className="bits" aria-label="Tag bits">
            {t.bits.split("").map((b, i) => (
              <span key={i} className={i < t.length ? "bit bit-on" : "bit"}>{b}</span>
            ))}
          </div>
          <p className="muted small">
            Highlighted bits are copied from the account ID prefix; the rest are zero.
          </p>
        </>
      )}
    </ToolCard>
  );
}
