import { useEffect, useState, type ComponentType } from "react";
import { LogoMark, Wordmark } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

// The SDK's WASM (about 6 MB compressed) is loaded by the App module through a top-level
// await. Importing App dynamically lets this shell render first and report failures,
// instead of a blank page that never resolves when the WASM can't load.

type State =
  | { step: "unsupported"; missing: string[] }
  | { step: "loading" }
  | { step: "error"; message: string }
  | { step: "ready"; App: ComponentType };

function missingFeatures(): string[] {
  const missing: string[] = [];
  if (typeof WebAssembly !== "object") missing.push("WebAssembly");
  if (typeof BigInt !== "function") missing.push("BigInt");
  if (!("DecompressionStream" in window) || !("CompressionStream" in window)) missing.push("CompressionStream");
  if (!window.crypto?.subtle) missing.push("Web Crypto (needs HTTPS)");
  return missing;
}

const isReceipt = () => window.location.pathname.replace(/\/$/, "") === "/r";

export function Boot() {
  const [state, setState] = useState<State>(() => {
    const missing = missingFeatures();
    return missing.length ? { step: "unsupported", missing } : { step: "loading" };
  });
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (state.step !== "loading") return;
    let live = true;
    import("./App.tsx")
      .then((m) => { if (live) setState({ step: "ready", App: m.default }); })
      .catch((e: unknown) => { if (live) setState({ step: "error", message: e instanceof Error ? e.message : String(e) }); });
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => { live = false; clearInterval(timer); };
  }, [state.step]);

  if (state.step === "ready") return <state.App />;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <LogoMark size={32} />
          <div>
            <h1>{isReceipt() ? "Payment receipt" : <Wordmark />}</h1>
            <p className="muted small">Miden developer tools and private payment receipts. Runs entirely in your browser.</p>
          </div>
        </div>
        <div className="top-actions"><ThemeToggle /></div>
      </header>
      <main className="boot">
        {state.step === "loading" && (
          <div className="boot-card" role="status" aria-live="polite">
            <div className="boot-logo" aria-hidden="true"><LogoMark size={38} /></div>
            <p className="boot-title">{isReceipt() ? "Loading the receipt checker…" : "Loading the Miden SDK…"}</p>
            <div className="boot-bar" aria-hidden="true"><span /></div>
            <p className="muted small">
              {seconds < 12
                ? "About 6 MB on the first visit; it's cached after that."
                : "Still loading. On a slow connection the first visit can take half a minute; later visits are instant."}
            </p>
          </div>
        )}
        {state.step === "error" && (
          <div className="boot-card" role="alert">
            <p className="boot-title">Couldn't load the Miden SDK</p>
            <p className="muted small">Check your connection and try again. Some networks and browser extensions block large WebAssembly files.</p>
            <div><button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button></div>
            <details><summary>Details</summary><code className="small">{state.message}</code></details>
          </div>
        )}
        {state.step === "unsupported" && (
          <div className="boot-card" role="alert">
            <p className="boot-title">This browser can't run NoteCheck</p>
            <p className="muted small">
              Use a recent Chrome or Edge (96+), Firefox (113+) or Safari (16.4+). Missing: {state.missing.join(", ")}.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
