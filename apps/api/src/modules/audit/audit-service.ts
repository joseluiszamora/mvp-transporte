import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

type Transaction = Pick<PoolClient, "query">;
type AuditScalar = string | number | boolean | null;
type AuditValue = AuditScalar | AuditValue[] | { [key: string]: AuditValue };

const sensitiveField = /(?:password|token|secret|(?:api|private)[_.-]?key|credential|authorization|cookie|smtp|document|file|content|path|rawbody|email|phone|address|contact|personal|(?:^|_)nit(?:_|$)|tax.?id)/iu;
const maximumDiffBytes = 16_384;
const maximumDepth = 4;
const maximumEntries = 50;
const maximumStringLength = 500;

export type AuditActor =
  | { type: "USER"; userId: string }
  | { type: "SYSTEM" };

export interface AppendAuditEventInput {
  organizationId?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  actor: AuditActor;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId: string;
  before?: Readonly<Record<string, unknown>> | null;
  after?: Readonly<Record<string, unknown>> | null;
}

function requiredText(value: string, name: string, maximumLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength || /[\r\n\0]/u.test(normalized)) {
    throw new Error(`Invalid ${name}.`);
  }
  return normalized;
}

function sanitizeValue(value: unknown, depth: number): AuditValue | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.slice(0, maximumStringLength);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  }
  if (depth >= maximumDepth) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, maximumEntries)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item): item is AuditValue => item !== undefined);
  }
  if (typeof value === "object") {
    const result: Record<string, AuditValue> = {};
    for (const [key, child] of Object.entries(value).slice(0, maximumEntries)) {
      if (sensitiveField.test(key)) {
        continue;
      }
      const safeKey = key.trim().slice(0, 80);
      if (!safeKey || /[\r\n\0]/u.test(safeKey)) {
        continue;
      }
      const sanitized = sanitizeValue(child, depth + 1);
      if (sanitized !== undefined) {
        result[safeKey] = sanitized;
      }
    }
    return result;
  }
  return undefined;
}

export function sanitizeStoredAuditDiff(value: unknown): AuditValue | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const sanitized: Record<string, AuditValue> = {};
  for (const key of ["before", "after"] as const) {
    if (!Object.hasOwn(source, key)) continue;
    const item = sanitizeValue(source[key], 0);
    if (item === null || (typeof item === "object" && !Array.isArray(item))) sanitized[key] = item;
  }
  if (Object.keys(sanitized).length === 0) return null;
  if (Buffer.byteLength(JSON.stringify(sanitized), "utf8") > maximumDiffBytes) return null;
  return sanitized;
}
function sanitizeDiff(input: AppendAuditEventInput): AuditValue | null {
  const diff: Record<string, AuditValue> = {};
  if (input.before !== undefined) {
    const before = sanitizeValue(input.before, 0);
    if (before !== undefined) {
      diff.before = before;
    }
  }
  if (input.after !== undefined) {
    const after = sanitizeValue(input.after, 0);
    if (after !== undefined) {
      diff.after = after;
    }
  }
  if (Object.keys(diff).length === 0) {
    return null;
  }
  const serialized = JSON.stringify(diff);
  if (Buffer.byteLength(serialized, "utf8") > maximumDiffBytes) {
    throw new Error("Audit diff exceeds the maximum size.");
  }
  return diff;
}

/** Inserts a sanitized audit event inside the caller's transaction. */
export async function appendAuditEvent(
  transaction: Transaction,
  input: AppendAuditEventInput,
): Promise<string> {
  const actorType = input.actor.type;
  const actorId = input.actor.type === "USER" ? requiredText(input.actor.userId, "actor user id", 36) : null;
  const action = requiredText(input.action, "action", 100);
  const resourceType = requiredText(input.resourceType, "resource type", 100);
  const requestId = requiredText(input.requestId, "request id", 100);
  const resourceId = input.resourceId == null ? null : requiredText(input.resourceId, "resource id", 100);
  const diff = sanitizeDiff(input);

  const result = await transaction.query<{ id: string }>(
    `INSERT INTO audit_events (
       id, organization_id, company_id, branch_id, actor_id, actor_type,
       action, resource_type, resource_id, diff, request_id
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::"AuditActorType",
       $7, $8, $9, $10::jsonb, $11)
     RETURNING id`,
    [
      randomUUID(),
      input.organizationId ?? null,
      input.companyId ?? null,
      input.branchId ?? null,
      actorId,
      actorType,
      action,
      resourceType,
      resourceId,
      diff === null ? null : JSON.stringify(diff),
      requestId,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("Audit event could not be created.");
  }
  return id;
}
