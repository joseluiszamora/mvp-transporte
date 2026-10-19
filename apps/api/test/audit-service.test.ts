import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeStoredAuditDiff } from "../src/modules/audit/audit-service.ts";

test("stored audit diffs retain safe values and remove sensitive fields recursively", () => {
  const result = sanitizeStoredAuditDiff({
    before: {
      status: "ACTIVE",
      email: "private@example.test",
      nit: "private-nit",
      nested: { safeCount: 2, accessToken: "private-token", filePath: "private-path" },
    },
    after: { status: "INACTIVE", documentNumber: "private-document" },
  });

  assert.deepEqual(result, {
    before: { status: "ACTIVE", nested: { safeCount: 2 } },
    after: { status: "INACTIVE" },
  });
});

test("stored audit diffs reject malformed roots and oversized values", () => {
  assert.equal(sanitizeStoredAuditDiff(null), null);
  assert.equal(sanitizeStoredAuditDiff(["not", "an", "object"]), null);
  assert.equal(sanitizeStoredAuditDiff({ after: "not an object" }), null);

  const oversized = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`field${index}`, "x".repeat(500)]));
  assert.equal(sanitizeStoredAuditDiff({ after: oversized }), null);
});