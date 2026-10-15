import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

const passwordHashOptions = {
  type: argon2.argon2id as 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const accessTokenLifetimeSeconds = 15 * 60;
const accessTokenIssuer = "mvp-transporte-api";
const accessTokenAudience = "mvp-transporte-web";

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  selectedMembershipId: string | null;
}

export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(normalized)
  ) {
    throw new Error("INVALID_EMAIL");
  }
  return normalized;
}

export function validatePassword(value: string): void {
  if (Array.from(value).length < 12 || Buffer.byteLength(value, "utf8") > 1_024) {
    throw new Error("INVALID_PASSWORD");
  }
}

export async function hashPassword(value: string): Promise<string> {
  validatePassword(value);
  return argon2.hash(value, passwordHashOptions);
}

export async function verifyPassword(value: string, encodedHash: string): Promise<boolean> {
  try {
    return await argon2.verify(encodedHash, value);
  } catch {
    return false;
  }
}

export async function createDummyPasswordHash(): Promise<string> {
  return argon2.hash(randomBytes(32).toString("base64url"), passwordHashOptions);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function createRateLimitKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseAccessTokenSecret(value: string | undefined): Uint8Array {
  const normalized = value?.trim();
  if (!normalized || !/^[A-Za-z0-9+/]{43}=$/u.test(normalized)) {
    throw new Error("ACCESS_TOKEN_SECRET is not configured.");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.byteLength !== 32 || bytes.toString("base64") !== normalized) {
    throw new Error("ACCESS_TOKEN_SECRET is not configured.");
  }
  return new Uint8Array(bytes);
}

export async function createAccessToken(
  secret: Uint8Array,
  claims: AccessTokenClaims,
  sessionExpiresAt: Date,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(
    Math.min(sessionExpiresAt.getTime(), now.getTime() + accessTokenLifetimeSeconds * 1_000),
  );
  if (expiresAt.getTime() <= now.getTime()) {
    throw new Error("SESSION_EXPIRED");
  }
  const token = await new SignJWT({
    sid: claims.sessionId,
    mid: claims.selectedMembershipId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(accessTokenIssuer)
    .setAudience(accessTokenAudience)
    .setSubject(claims.userId)
    .setIssuedAt(Math.floor(now.getTime() / 1_000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
    .sign(secret);
  return { token, expiresAt };
}

export async function verifyAccessToken(
  token: string,
  secret: Uint8Array,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: accessTokenIssuer,
      audience: accessTokenAudience,
      algorithms: ["HS256"],
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      (payload.mid !== null && typeof payload.mid !== "string")
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      sessionId: payload.sid,
      selectedMembershipId: payload.mid,
    };
  } catch {
    return null;
  }
}
