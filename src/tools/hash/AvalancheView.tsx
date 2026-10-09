import { useMemo, type CSSProperties } from "react";
import { diffBits, diffHex, percent, tweakFelts, tweakString } from "./avalanche";
import { encodeString, hashFelts } from "./hash";
import "./hash.css";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const TAIL = 24;
const u = (c: string) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
/** Visible form of a character inside a quoted preview. */
const show = (c: string) => (c === " " ? "␣" : c === "\n" ? "↵" : c === "\t" ? "⇥" : c);

function HexDiff({ hex, mask, changed }: { hex: string; mask: boolean[]; changed: boolean }) {
  const body = hex.slice(2);
  return (
    <code className="av-hex">
      {[0, 1, 2, 3].map((g) => (
        <span className="av-group" key={g}>
          {body.slice(g * 16, g * 16 + 16).split("").map((c, j) => {
            const i = g * 16 + j;
            return <span key={i} className={mask[i] ? (changed ? "av-d av-new" : "av-d") : undefined}>{c}</span>;
          })}
        </span>
      ))}
    </code>
  );
}

function FeltList({ values, mark }: { values: bigint[]; mark: number }) {
  const start = Math.max(0, values.length - 4);
  return (
    <code className="av-input">
      [{start > 0 && <span className="muted">…, </span>}
      {values.slice(start).map((v, j) => {
        const i = start + j;
        return <span key={i}>{j > 0 && ", "}<span className={i === mark ? "av-mark" : undefined}>{v.toString()}</span></span>;
      })}]
    </code>
  );
}

function Quoted({ text, mark }: { text: string; mark: number }) {
  const chars = Array.from(text);
  const start = Math.max(0, chars.length - TAIL);
  return (
    <code className="av-input">
      “{start > 0 && <span className="muted">…</span>}
      {chars.slice(start).map((c, j) => (
        <span key={start + j} className={start + j === mark ? "av-mark" : undefined}>{show(c)}</span>
      ))}”
    </code>
  );
}

export function AvalancheView({ mode, text, input, digest }: {
  mode: "felts" | "string"; text: string; input: bigint[]; digest: string;
}) {
  const view = useMemo(() => {
    try {
      if (mode === "felts") {
        const t = tweakFelts(input);
        return { felts: t, hex: hashFelts(t.values).poseidon2.hex };
      }
      const t = tweakString(text);
      return { str: t, hex: hashFelts(encodeString(t.text)).poseidon2.hex };
    } catch {
      return null;
    }
  }, [mode, text, input]);
  if (!view) return null;

  const hex = diffHex(digest, view.hex);
  const bits = diffBits(digest, view.hex);
  const label = `Bit grid: ${bits.changed} of 256 digest bits differ after the change (${percent(bits)}%).`;

  return (
    <section className="av" aria-label="Avalanche comparison">
      <div className="av-head">
        <h3>Avalanche</h3>
        <span className="muted small">Change one {mode === "felts" ? "felt" : "character"} and compare Poseidon2 digests</span>
      </div>

      <div className="av-change">
        {view.felts ? (
          <>
            <span className="av-what">{view.felts.summary}</span>
            {view.felts.before === null ? (
              <span><FeltList values={input} mark={-1} /> → <FeltList values={view.felts.values} mark={0} /></span>
            ) : (
              <span>
                felt {view.felts.index}: <code>{view.felts.before.toString()}</code> → <code className="av-mark">{view.felts.after.toString()}</code>
                <span className="av-arrow"> · </span><FeltList values={view.felts.values} mark={view.felts.index} />
              </span>
            )}
          </>
        ) : view.str && (
          <>
            <span className="av-what">{view.str.summary}</span>
            <span>
              <code>{show(view.str.before)}</code> <span className="muted">{u(view.str.before)}</span> →{" "}
              <code className="av-mark">{show(view.str.after)}</code> <span className="muted">{u(view.str.after)}</span>
              <span className="av-arrow"> · </span><Quoted text={view.str.text} mark={Array.from(view.str.text).length - 1} />
            </span>
          </>
        )}
      </div>

      <div className="av-body">
        <div className="av-digests">
          <div className="av-row">
            <span className="av-label">Original</span>
            <HexDiff hex={digest} mask={hex.mask} changed={false} />
          </div>
          <div className="av-row">
            <span className="av-label">Changed</span>
            <HexDiff hex={view.hex} mask={hex.mask} changed />
          </div>
          <div className="av-stats">
            <div className="av-stat">
              <strong>{hex.changed}</strong><span> of 64 hex digits changed</span> <em>~{percent(hex)}%</em>
              <span className="av-meter" aria-hidden="true"><span style={{ width: `${percent(hex)}%` }} /></span>
            </div>
            <div className="av-stat">
              <strong>{bits.changed}</strong><span> of 256 bits changed</span> <em>~{percent(bits)}%</em>
              <span className="av-meter" aria-hidden="true"><span style={{ width: `${percent(bits)}%` }} /></span>
            </div>
            <p className="muted small av-note">
              A good hash flips about half the bits (and ~94% of hex digits) for any input change.
            </p>
          </div>
        </div>

        <figure className="av-gridwrap">
          <div className="av-grid" role="img" aria-label={label} key={view.hex}>
            {bits.mask.map((d, i) => (
              <span key={i} className={d ? "av-cell on" : "av-cell"} style={{ "--i": i } as Vars} />
            ))}
          </div>
          <figcaption className="muted">256 digest bits, 16 × 16 · <span className="av-key" /> differs</figcaption>
        </figure>
      </div>
    </section>
  );
}
