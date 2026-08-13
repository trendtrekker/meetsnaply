import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * Symmetric encryption for OAuth tokens at rest.
 *
 * A refresh token is a long-lived key to somebody's calendar. A database dump
 * or a stray backup should not hand it over in plaintext, so tokens are sealed
 * with AES-256-GCM before they touch a column.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, the GCM standard
const VERSION = "v1";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.ENCRYPTION_KEY ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "ENCRYPTION_KEY (or AUTH_SECRET as a fallback) must be set and at least 32 characters.",
    );
  }

  // The env value is an arbitrary passphrase; AES needs exactly 32 bytes.
  cachedKey = createHash("sha256").update(secret).digest();
  return cachedKey;
}

/** Returns `v1:<iv>:<authTag>:<ciphertext>`, all base64url. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/**
 * Reverses `encrypt`. Throws on tampering — GCM authenticates the ciphertext,
 * so a modified value fails rather than decrypting to garbage.
 */
export function decrypt(sealed: string): string {
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Malformed ciphertext");
  }

  const [, iv, authTag, ciphertext] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Decrypt without throwing — used where a bad token means "reconnect". */
export function tryDecrypt(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    return decrypt(sealed);
  } catch {
    return null;
  }
}
