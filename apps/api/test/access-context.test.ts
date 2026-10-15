import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPermission, type AccessContext } from "../src/modules/access/access-context.ts";

const context: AccessContext = {
  userId: "user-a",
  organizationId: "tenant-a",
  membershipId: "membership-a",
  grants: [
    {
      organizationId: "tenant-a",
      permissionCode: "companies.read",
      scopeType: "ORGANIZATION",
      companyId: null,
      branchId: null,
    },
    {
      organizationId: "tenant-a",
      permissionCode: "employees.read",
      scopeType: "COMPANY",
      companyId: "company-a",
      branchId: null,
    },
    {
      organizationId: "tenant-a",
      permissionCode: "employees.personal.read",
      scopeType: "BRANCH",
      companyId: "company-a",
      branchId: "branch-a",
    },
  ],
};

test("organization scope is limited to its selected tenant", () => {
  assert.equal(
    hasPermission(context, "companies.read", { organizationId: "tenant-a" }),
    true,
  );
  assert.equal(
    hasPermission(context, "companies.read", { organizationId: "tenant-b" }),
    false,
  );
});

test("company scope covers only that company's resources", () => {
  assert.equal(
    hasPermission(context, "employees.read", {
      organizationId: "tenant-a",
      companyId: "company-a",
      branchId: "branch-a",
    }),
    true,
  );
  assert.equal(
    hasPermission(context, "employees.read", {
      organizationId: "tenant-a",
      companyId: "company-b",
    }),
    false,
  );
});

test("branch scope does not grant personal data access to another branch", () => {
  assert.equal(
    hasPermission(context, "employees.personal.read", {
      organizationId: "tenant-a",
      companyId: "company-a",
      branchId: "branch-a",
    }),
    true,
  );
  assert.equal(
    hasPermission(context, "employees.personal.read", {
      organizationId: "tenant-a",
      companyId: "company-a",
      branchId: "branch-b",
    }),
    false,
  );
  assert.equal(
    hasPermission(context, "employees.personal.read", {
      organizationId: "tenant-a",
      companyId: "company-b",
      branchId: "branch-a",
    }),
    false,
  );
});

test("a branch target without a company fails closed", () => {
  assert.equal(
    hasPermission(context, "companies.read", {
      organizationId: "tenant-a",
      branchId: "branch-a",
    }),
    false,
  );
});
