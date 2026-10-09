/** Standard base64 with padding, as used for the NoteFile inside the receipt JSON. */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Base64url without padding (RFC 4648 §5). */
export const toBase64Url = (bytes: Uint8Array) =>
  toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("Invalid base64url data.");
  if (s.length % 4 === 1) throw new Error("Invalid base64url data.");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new Error("Invalid base64url data.");
  }
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Data is larger than allowed.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export const gzip = (bytes: Uint8Array, limit = 1 << 20) => pipe(bytes, new CompressionStream("gzip"), limit);

/** Gunzips with an output cap so a crafted link can't expand into a huge buffer. */
export async function gunzip(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  try {
    return await pipe(bytes, new DecompressionStream("gzip"), limit);
  } catch (e) {
    if (e instanceof Error && e.message === "Data is larger than allowed.") throw e;
    throw new Error("Data is not valid gzip.");
  }
}
