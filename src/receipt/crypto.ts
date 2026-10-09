// Optional receipt password: PBKDF2-SHA256 -> AES-256-GCM, WebCrypto only.
// Layout: salt (16) | iv (12) | ciphertext+tag.

export const PBKDF2_ITERATIONS = 600_000;
const SALT_LEN = 16;
const IV_LEN = 12;

export class WrongPasswordError extends Error {
  constructor() { super("Wrong password, or the link was altered."); }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(plain: Uint8Array, password: string, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  if (!password) throw new Error("Password is empty.");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  const out = new Uint8Array(SALT_LEN + IV_LEN + ct.length);
  out.set(salt, 0);
  out.set(iv, SALT_LEN);
  out.set(ct, SALT_LEN + IV_LEN);
  return out;
}

export async function decrypt(blob: Uint8Array, password: string, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  if (blob.length < SALT_LEN + IV_LEN + 16) throw new Error("Encrypted data is too short.");
  const key = await deriveKey(password, blob.subarray(0, SALT_LEN), iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: blob.subarray(SALT_LEN, SALT_LEN + IV_LEN) as BufferSource },
      key,
      blob.subarray(SALT_LEN + IV_LEN) as BufferSource,
    ));
  } catch {
    throw new WrongPasswordError();
  }
}
