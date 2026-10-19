import assert from "node:assert/strict";
import test from "node:test";
import { decryptSmtpPassword, encryptSmtpPassword } from "../src/modules/email/smtp-settings-crypto.ts";
import { validateSmtpConfiguration } from "../src/modules/email/smtp-transport.ts";

const encryptionKey = Buffer.alloc(32, 19).toString("base64");

test("SMTP password encryption uses a fresh authenticated envelope and round-trips", () => {
  const first = encryptSmtpPassword("smtp-local-password", encryptionKey);
  const second = encryptSmtpPassword("smtp-local-password", encryptionKey);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, "smtp-local-password");
  assert.equal(decryptSmtpPassword(first, encryptionKey), "smtp-local-password");
  assert.throws(() => decryptSmtpPassword(first, Buffer.alloc(32, 20).toString("base64")));
});

test("SMTP password encryption rejects malformed keys, empty passwords, and altered envelopes", () => {
  assert.throws(() => encryptSmtpPassword("secret", "not-base64"));
  assert.throws(() => encryptSmtpPassword("", encryptionKey));
  const envelope = encryptSmtpPassword("smtp-local-password", encryptionKey);
  assert.throws(() => decryptSmtpPassword({ ...envelope, tag: Buffer.alloc(16).toString("base64") }, encryptionKey));
});

test("SMTP configuration validates sender addresses and requires TLS for credentials", () => {
  const base = { host: "127.0.0.1", port: 1025, secure: false, requireTls: false, from: "Mailpit <no-reply@example.test>" };
  assert.equal(validateSmtpConfiguration(base).from, base.from);
  assert.throws(() => validateSmtpConfiguration({ ...base, from: "bad sender" }));
  assert.throws(() => validateSmtpConfiguration({ ...base, from: "Name <first@example.test> <second@example.test>" }));
  assert.throws(() => validateSmtpConfiguration({ ...base, user: "smtp-user", password: "smtp-password" }));
  assert.equal(validateSmtpConfiguration({ ...base, requireTls: true, user: "smtp-user", password: "smtp-password" }).user, "smtp-user");
});
