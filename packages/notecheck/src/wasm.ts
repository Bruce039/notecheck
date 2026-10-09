/**
 * Frees WASM-backed SDK objects. The browser build needs it; the Node binding
 * used by the tests has no `free`, so it is optional.
 *
 * Never release an object after passing it by value: in the browser build,
 * arrays of SDK objects (`Felt[]`, `new NoteArray([note])`, `new NoteAssets([...])`)
 * and by-value params (e.g. `hashElements(feltArray)`) consume them. Read what
 * you need (ids, hex) before handing them over. The Node binding does not
 * reproduce this, so only the browser smoke test catches it.
 */
export function release(...objects: unknown[]): void {
  for (const o of objects) (o as { free?: () => void } | null | undefined)?.free?.();
}

/** SDK `serialize()` output as a Uint8Array: the Node binding returns plain arrays. */
export const bytesOf = (x: Uint8Array | number[]): Uint8Array => (x instanceof Uint8Array ? x : Uint8Array.from(x));
