import { useId, useState, type ReactNode } from "react";

export function ToolCard({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <section className="tool">
      <header className="tool-head">
        <h2>{title}</h2>
        <p className="muted">{intro}</p>
      </header>
      {children}
    </section>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard blocked; nothing to do */ }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function Field({ label, value, hint, copy = true }: {
  label: string; value: string; hint?: ReactNode; copy?: boolean;
}) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">
        <code>{value}</code>
        {copy && <CopyButton value={value} />}
      </div>
      {hint && <div className="field-hint muted">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "info"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : undefined}>{children}</div>;
}

export function TextInput({ label, value, onChange, placeholder, example }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; example?: string;
}) {
  const id = useId();
  return (
    <div className="input">
      <span className="input-label">
        <label htmlFor={id}>{label}</label>
        {example && (
          <button type="button" className="link" onClick={() => onChange(example)}>example</button>
        )}
      </span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
      />
    </div>
  );
}
