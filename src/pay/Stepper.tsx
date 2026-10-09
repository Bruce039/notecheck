import { useEffect, useState } from "react";
import { PAY_STEPS, SLOW_AFTER_MS, formatElapsed } from "./steps";

type Props = {
  /** Index of the step in progress (or the one that failed). */
  at: number;
  startedAt: number;
  status: "running" | "failed" | "done";
};

/** Elapsed time since `startedAt`, ticking once a second while `running`. */
function useElapsed(startedAt: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return now - startedAt;
}

function Check() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="ps-check">
      <path d="M5.5 10.5l3 3 6-6.5" pathLength={1} />
    </svg>
  );
}

function Cross() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="ps-cross">
      <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" />
    </svg>
  );
}

export function PayStepper({ at, startedAt, status }: Props) {
  const elapsed = useElapsed(startedAt, status === "running");
  const slow = status === "running" && elapsed >= SLOW_AFTER_MS;
  const stateOf = (i: number) => {
    if (status === "done" || i < at) return "done";
    if (i > at) return "todo";
    return status === "failed" ? "failed" : "active";
  };
  const current = PAY_STEPS[Math.min(at, PAY_STEPS.length - 1)];
  return (
    <div className={`ps ps-is-${status}`}>
      <ol className="ps-list" aria-label="Payment progress">
        {PAY_STEPS.map((label, i) => {
          const s = stateOf(i);
          return (
            <li key={label} className={`ps-step ps-${s}`} aria-current={s === "active" ? "step" : undefined} data-state={s}>
              <span className="ps-dot">
                {s === "done" && <Check />}
                {s === "failed" && <Cross />}
                {(s === "active" || s === "todo") && <span className="ps-num" aria-hidden="true">{i + 1}</span>}
              </span>
              <span className="ps-label">
                {label}
                {s === "failed" && <span className="sr-only"> (failed)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {status === "done" ? "Receipt ready." : status === "failed" ? `Stopped at: ${current}.` : `Step ${at + 1} of ${PAY_STEPS.length}: ${current}.`}
      </p>
      {status !== "done" && (
        <div className="ps-meta">
          <span className="ps-timer" role="timer" aria-label="Elapsed time">{formatElapsed(elapsed)}</span>
          {slow && <span className="ps-hint">Still going — the wallet can take a couple of minutes.</span>}
          {status === "running" && !slow && at >= 1 && at <= 2 && (
            <span className="ps-hint ps-hint-soft">This usually takes a minute or two. You can follow it in your wallet.</span>
          )}
        </div>
      )}
    </div>
  );
}
