import { useEffect, useState, type ReactElement } from "react";

type Theme = "system" | "light" | "dark";
const KEY = "theme";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* storage blocked: the choice lasts for this page only */ }
  // Keep the browser chrome in step with the page background.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const forDark = m.getAttribute("media")?.includes("dark");
    const color = t === "system" ? (forDark ? "#101014" : "#f7f7fa") : t === "dark" ? "#101014" : "#f7f7fa";
    m.setAttribute("content", color);
  });
}

const ICONS: Record<Theme, ReactElement> = {
  system: (
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="10" rx="2" /><path d="M7 16.5h6M10 13.5v3" /></svg>
  ),
  light: (
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.5" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" /></svg>
  ),
  dark: (
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5z" /></svg>
  ),
};

const LABELS: Record<Theme, string> = { system: "Match system", light: "Light", dark: "Dark" };

/** System / light / dark switch. The saved choice is applied before first paint by public/theme.js. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Color theme">
      {(Object.keys(ICONS) as Theme[]).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          aria-label={LABELS[t]}
          title={LABELS[t]}
          className={theme === t ? "on" : undefined}
          onClick={() => setTheme(t)}
        >
          {ICONS[t]}
        </button>
      ))}
    </div>
  );
}
