import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const maximumPasswordBytes = 1_024;

export interface EncryptedSmtpPassword {
  version: 1;
  algorithm: typeof algorithm;
  iv: string;
  tag: string;
  ciphertext: string;
}

function readKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32 || key.toString("base64") !== base64Key) {
    throw new Error("SMTP_SETTINGS_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.");
  }
  return key;
}

export function encryptSmtpPassword(password: string, base64Key: string): EncryptedSmtpPassword {
  if (!password || Buffer.byteLength(password, "utf8") > maximumPasswordBytes || password.includes("\0")) {
    throw new Error("SMTP password is invalid.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, readKey(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return { version: 1, algorithm, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function decryptSmtpPassword(envelope: unknown, base64Key: string): string {
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) throw new Error("SMTP password envelope is invalid.");
  const value = envelope as Partial<EncryptedSmtpPassword>;
  if (value.version !== 1 || value.algorithm !== algorithm || typeof value.iv !== "string" || typeof value.tag !== "string" || typeof value.ciphertext !== "string") {
    throw new Error("SMTP password envelope is invalid.");
  }
  const iv = Buffer.from(value.iv, "base64");
  const tag = Buffer.from(value.tag, "base64");
  const ciphertext = Buffer.from(value.ciphertext, "base64");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > maximumPasswordBytes || iv.toString("base64") !== value.iv || tag.toString("base64") !== value.tag || ciphertext.toString("base64") !== value.ciphertext) {
    throw new Error("SMTP password envelope is invalid.");
  }
  const decipher = createDecipheriv(algorithm, readKey(base64Key), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (!plaintext.length || plaintext.length > maximumPasswordBytes || plaintext.includes(0)) throw new Error("SMTP password envelope is invalid.");
  return plaintext.toString("utf8");
}
