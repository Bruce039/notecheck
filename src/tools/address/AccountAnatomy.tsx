import { useId, useState, type CSSProperties } from "react";
import { DEFAULT_TAG_LENGTH } from "@/tools/tag/tag";
import {
  HALF_TEMPLATE, accountSegments, bitColumn, feltBits, inSegment, segmentAt,
  type AnatomyInput, type Row, type Segment, type SegmentId,
} from "./anatomy";
import "./address.css";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const ROWS: { row: Row; label: string; note: string }[] = [
  { row: "prefix", label: "Prefix felt", note: "64 bits" },
  { row: "suffix", label: "Suffix felt", note: "56 bits stored + 8 zero bits" },
];

/** Each 64-bit row is drawn as two 32-bit halves: side by side when wide, stacked when narrow. */
const HALVES = [[0, 32], [32, 64]] as const;

/** Labels under each row, by segment run. Narrow runs get no text. */
const BANDS: Record<Row, { id: SegmentId; start: number; end: number; text?: string; textAt?: number }[]> = {
  prefix: [
    { id: "hash", start: 0, end: 58, text: "hash · 58 bits", textAt: 0 },
    { id: "callbacks", start: 58, end: 59 },
    { id: "type", start: 59, end: 60 },
    { id: "version", start: 60, end: 64 },
  ],
  suffix: [
    { id: "zero", start: 0, end: 1 },
    { id: "hash", start: 1, end: 56, text: "hash · 55 bits", textAt: 0 },
    { id: "dropped", start: 56, end: 64, text: "not stored", textAt: 32 },
  ],
};

export function AccountAnatomy(props: AnatomyInput) {
  const { prefix, suffix } = props;
  const segments = accountSegments(props);
  const [active, setActive] = useState<SegmentId | null>(null);
  const infoId = useId();
  const bits: Record<Row, string> = { prefix: feltBits(prefix), suffix: feltBits(suffix) };
  const byId = Object.fromEntries(segments.map((s) => [s.id, s])) as Record<SegmentId, Segment>;
  const current = active ? byId[active] : null;
  const lowByte = bits.prefix.slice(56);

  const isLit = (row: Row, pos: number) => !current || inSegment(current, row, pos);
  const hover = (id: SegmentId | null) => () => setActive(id);

  const summary =
    `Account ID bits. Prefix: 58-bit hash, ${byId.callbacks.phrase}, ${props.visibility}, ${byId.version.phrase}; ` +
    `its top ${DEFAULT_TAG_LENGTH} bits form the default note tag. ` +
    "Suffix: a zero bit, a 55-bit hash and 8 zero bits that the 15-byte ID leaves out.";

  return (
    <section className={`anat${current ? " anat-focus" : ""}`} aria-label="Account ID anatomy"
      onMouseLeave={hover(null)}>
      <div className="anat-head">
        <h3>ID anatomy</h3>
        <span className="muted small">120 bits = 64-bit prefix + 56-bit suffix</span>
      </div>

      <div className="anat-legend" role="group" aria-label="Segments">
        {segments.map((s) => (
          <button key={s.id} type="button" className={`anat-chip seg-${s.id}${active === s.id ? " on" : ""}`}
            aria-describedby={active === s.id ? infoId : undefined}
            onMouseEnter={hover(s.id)} onFocus={hover(s.id)} onBlur={hover(null)}
            onClick={hover(s.id)}>
            <span className="anat-swatch" aria-hidden="true" />
            <span className="anat-chip-label">{s.label}</span>
            <span className="anat-chip-value">{s.value}</span>
          </button>
        ))}
      </div>

      <div className="anat-rows" role="img" aria-label={summary}>
        {ROWS.map(({ row, label, note }, ri) => (
          <div className="anat-row" key={row}>
            <div className="anat-row-head">
              <span className="anat-row-label">{label}</span>
              <span className="muted">{note}</span>
            </div>
            <div className="anat-halves">
              {HALVES.map(([h0, h1]) => (
                <div className="anat-grid" key={h0} style={{ gridTemplateColumns: HALF_TEMPLATE }}>
                  {row === "prefix" && h0 === 0 && (
                    <div className={`anat-bracket${isTagLit(current) ? "" : " dim"}`}
                      style={{ gridColumn: `1 / ${bitColumn(DEFAULT_TAG_LENGTH - 1) + 1}` }}
                      onMouseEnter={hover("tag")}>
                      <span>note tag · {DEFAULT_TAG_LENGTH} bits</span>
                    </div>
                  )}
                  {bits[row].slice(h0, h1).split("").map((b, j) => {
                    const pos = h0 + j;
                    const id = segmentAt(row, pos);
                    const style: Vars = { gridColumn: bitColumn(j), "--i": ri * 64 + pos };
                    return (
                      <span key={pos} style={style} onMouseEnter={hover(id)}
                        className={`anat-bit seg-${id}${b === "1" ? " one" : ""}${isLit(row, pos) ? "" : " dim"}`}>
                        <i>{b}</i>
                      </span>
                    );
                  })}
                  {BANDS[row].filter((band) => band.start < h1 && band.end > h0).map((band) => {
                    const a = Math.max(band.start, h0) - h0, z = Math.min(band.end, h1) - h0;
                    return (
                      <span key={band.start} onMouseEnter={hover(band.id)}
                        className={`anat-band seg-${band.id}${!current || current.id === band.id ? "" : " dim"}`}
                        style={{ gridColumn: `${bitColumn(a)} / ${bitColumn(z - 1) + 1}` }}>
                        {band.text && band.textAt === h0 && <em>{band.text}</em>}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="anat-zoom">
        <div className="anat-row-head">
          <span className="anat-row-label">Prefix low byte</span>
          <span className="muted">bits 7–0 · <code>0x{(prefix & 0xffn).toString(16).padStart(2, "0")}</code></span>
        </div>
        <div className="anat-zoom-cells">
          {lowByte.split("").map((b, i) => {
            const id = segmentAt("prefix", 56 + i);
            return (
              <span key={i} onMouseEnter={hover(id)} style={{ "--i": i } as Vars}
                className={`anat-zbit seg-${id}${b === "1" ? " one" : ""}${isLit("prefix", 56 + i) ? "" : " dim"}`}>
                {b}
              </span>
            );
          })}
          <span className="anat-zlab seg-hash" style={{ gridColumn: "1 / 3" }}>hash</span>
          <span className="anat-zlab seg-callbacks" style={{ gridColumn: "3" }}>
            <b>cb</b><small>{props.assetCallbacks ? "on" : "off"}</small>
          </span>
          <span className="anat-zlab seg-type" style={{ gridColumn: "4" }}>
            <b>type</b><small>{props.visibility}</small>
          </span>
          <span className="anat-zlab seg-version" style={{ gridColumn: "5 / 9" }}>
            <b>version</b><small>{props.version}</small>
          </span>
        </div>
      </div>

      <p className="anat-info" id={infoId} aria-live="polite">
        {current
          ? <>
              <strong>{current.label}</strong>{" "}
              <span className="anat-info-meta">{current.phrase} · {current.bits} bit{current.bits === 1 ? "" : "s"}</span>
              <span className="anat-info-detail">{current.detail}</span>
            </>
          : <span className="muted">Select a segment to see what it encodes.</span>}
      </p>
    </section>
  );
}

function isTagLit(current: Segment | null): boolean {
  return !current || current.id === "tag" || current.id === "hash";
}
