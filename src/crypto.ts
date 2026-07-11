const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SALT = encoder.encode("cdc-voucher-wallet:v1");

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function masterKey(raw: string): Promise<CryptoKey> {
  const bytes = decodeBase64(raw);
  if (bytes.length !== 32) throw new Error("MASTER_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", toArrayBuffer(bytes), "HKDF", false, ["deriveKey"]);
}

async function deriveKey(
  raw: string,
  purpose: string,
  algorithm: "AES-GCM" | "HMAC",
): Promise<CryptoKey> {
  const base = await masterKey(raw);
  if (algorithm === "AES-GCM") {
    return crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: encoder.encode(purpose) },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: encoder.encode(purpose) },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

async function hmac(raw: string, purpose: string, value: string): Promise<Uint8Array> {
  const key = await deriveKey(raw, purpose, "HMAC");
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function deriveUserKey(raw: string, telegramUserId: number): Promise<string> {
  const digest = await hmac(raw, "telegram-user", String(telegramUserId));
  return encodeBase64Url(digest.slice(0, 18));
}

export async function fingerprintGroup(raw: string, groupId: string): Promise<string> {
  const digest = await hmac(raw, "voucher-group", groupId);
  return encodeBase64Url(digest.slice(0, 24));
}

export async function seal(raw: string, plaintext: string, context: string): Promise<string> {
  const key = await deriveKey(raw, "voucher-encryption", "AES-GCM");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    key,
    encoder.encode(plaintext),
  );
  return `${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

export async function open(raw: string, sealed: string, context: string): Promise<string> {
  const [ivValue, ciphertextValue] = sealed.split(".");
  if (!ivValue || !ciphertextValue) throw new Error("Encrypted value is malformed");
  const key = await deriveKey(raw, "voucher-encryption", "AES-GCM");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(decodeBase64(ivValue)),
      additionalData: encoder.encode(context),
    },
    key,
    toArrayBuffer(decodeBase64(ciphertextValue)),
  );
  return decoder.decode(plaintext);
}

export async function signCallback(raw: string, userKey: string, payload: string): Promise<string> {
  const digest = await hmac(raw, "telegram-callback", `${userKey}:${payload}`);
  const signed = `${payload}.${encodeBase64Url(digest.slice(0, 8))}`;
  if (signed.length > 64) throw new Error("Telegram callback payload exceeds 64 bytes");
  return signed;
}

export async function verifyCallback(raw: string, userKey: string, signed: string): Promise<string | null> {
  const separator = signed.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = signed.slice(0, separator);
  const signature = signed.slice(separator + 1);
  const expected = await signCallback(raw, userKey, payload);
  const expectedSignature = expected.slice(expected.lastIndexOf(".") + 1);
  if (signature.length !== expectedSignature.length) return null;
  let mismatch = 0;
  for (let index = 0; index < signature.length; index += 1) {
    mismatch |= signature.charCodeAt(index) ^ expectedSignature.charCodeAt(index);
  }
  return mismatch === 0 ? payload : null;
}
