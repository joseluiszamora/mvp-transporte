import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const maximumPayloadBytes = 16_384;

export interface EncryptedEmailPayload {
  version: 1;
  algorithm: typeof algorithm;
  iv: string;
  tag: string;
  ciphertext: string;
}

function readKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32 || key.toString("base64") !== base64Key) {
    throw new Error("EMAIL_PAYLOAD_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.");
  }
  return key;
}

export function encryptEmailPayload(payload: Readonly<Record<string, unknown>>, base64Key: string): EncryptedEmailPayload {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.byteLength > maximumPayloadBytes) {
    throw new Error("Email payload exceeds the maximum size.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, readKey(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptEmailPayload(encrypted: unknown, base64Key: string): Record<string, unknown> {
  if (
    typeof encrypted !== "object" ||
    encrypted === null ||
    Array.isArray(encrypted) ||
    !("version" in encrypted) ||
    encrypted.version !== 1 ||
    !("algorithm" in encrypted) ||
    encrypted.algorithm !== algorithm ||
    !("iv" in encrypted) ||
    typeof encrypted.iv !== "string" ||
    !("tag" in encrypted) ||
    typeof encrypted.tag !== "string" ||
    !("ciphertext" in encrypted) ||
    typeof encrypted.ciphertext !== "string"
  ) {
    throw new Error("Email payload envelope is invalid.");
  }
  const decipher = createDecipheriv(algorithm, readKey(base64Key), Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  if (plaintext.byteLength > maximumPayloadBytes) {
    throw new Error("Email payload exceeds the maximum size.");
  }
  const payload: unknown = JSON.parse(plaintext.toString("utf8"));
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Email payload must be a JSON object.");
  }
  return payload as Record<string, unknown>;
}
