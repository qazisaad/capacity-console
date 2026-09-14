import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Authenticated encryption for stored secrets. Format: v1.<keyId>.<iv>.<ciphertext>.<tag> (base64url).
 * `associated` binds the value to its owner (organization/connection ids) so a row cannot be replayed elsewhere.
 */
export function encryptSecret(plaintext: string, associated: string, keys: Keys = keysFromEnv()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.current.key, iv);
  cipher.setAAD(Buffer.from(associated, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", keys.current.id, b64(iv), b64(body), b64(cipher.getAuthTag())].join(".");
}

export function decryptSecret(value: string, associated: string, keys: Keys = keysFromEnv()): string {
  const [version, keyId, iv, body, tag] = value.split(".");
  if (version !== "v1" || !keyId || !iv || !body || !tag) throw new Error("Unrecognized encrypted value.");
  const key = [keys.current, ...(keys.previous ? [keys.previous] : [])].find(candidate => candidate.id === keyId);
  if (!key) throw new Error(`No decryption key with id ${keyId}.`);
  const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(associated, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

export type Keys = { current: { id: string; key: Buffer }; previous?: { id: string; key: Buffer } };
export function keysFromEnv(): Keys {
  const e = env();
  return {
    current: { id: e.CREDENTIAL_ENCRYPTION_KEY_ID, key: Buffer.from(e.CREDENTIAL_ENCRYPTION_KEY, "base64") },
    ...(e.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS && e.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID
      ? { previous: { id: e.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID, key: Buffer.from(e.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS, "base64") } } : {}),
  };
}

/** Digest for long-lived secrets we must verify but never need to read back. */
export function digest(secret: string): string { return createHash("sha256").update(secret, "utf8").digest("hex"); }
export function digestMatches(secret: string, storedHex: string): boolean {
  const a = Buffer.from(digest(secret), "hex"); const b = Buffer.from(storedHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function randomToken(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }
export function randomId(): string { return randomBytes(16).toString("hex"); }
function b64(buffer: Buffer): string { return buffer.toString("base64url"); }
