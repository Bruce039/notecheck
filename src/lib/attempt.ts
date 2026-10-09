/** Runs `fn` on non-empty input and returns its result or error message. */
export function attempt<T>(input: string, fn: (s: string) => T): { result?: T; error?: string } {
  if (!input.trim()) return {};
  try {
    return { result: fn(input) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
