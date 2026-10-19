import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { hasPermission, resolveAccessContext, type AccessContext, type AccessTarget } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";

type EmployeeStatus = "ACTIVE" | "INACTIVE";
type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED";

interface EmployeeRow extends QueryResultRow {
  id: string; organization_id: string; company_id: string; internal_code: string; first_names: string; last_names: string;
  personal_document_number: string | null; personal_phone: string | null; personal_email: string | null; personal_address: string | null;
  position_id: string | null; position_code: string | null; position_name: string | null; hire_date: string | Date; status: EmployeeStatus;
  user_id: string | null; photo_file_id: string | null; all_branch_ids: string[]; branches: Array<{ id: string; code: string; name: string }>;
  linked_display_name: string | null; linked_email: string | null; linked_membership_status: MembershipStatus | null;
  organization_status: string; company_status: string;
}

interface PageInput { limit: number; offset: number; search?: string; status?: EmployeeStatus; companyId?: string; branchId?: string; }

export interface EmployeeMutationInput {
  companyId?: string; internalCode?: string; firstNames?: string; lastNames?: string;
  personalDocumentNumber?: string | null; personalPhone?: string | null; personalEmail?: string | null; personalAddress?: string | null;
  positionId?: string | null; hireDate?: string; status?: EmployeeStatus; userId?: string | null; branchIds?: string[];
}

function requireOrganizationId(session: AuthenticatedSession): string {
  if (!session.organizationId || !session.selectedMembershipId) throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa para continuar.");
  return session.organizationId;
}

async function loadContext(database: Pick<Pool, "query"> | Pick<PoolClient, "query">, session: AuthenticatedSession): Promise<AccessContext> {
  const context = await resolveAccessContext(database as Pick<Pool, "query">, session.userId, requireOrganizationId(session));
  if (!context) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar personal.");
  return context;
}

async function transaction<T>(database: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

function permissionScope(context: AccessContext, permissionCode: string) {
  const grants = context.grants.filter((grant) => grant.permissionCode === permissionCode && grant.organizationId === context.organizationId);
  return {
    organization: grants.some((grant) => grant.scopeType === "ORGANIZATION"),
    companies: [...new Set(grants.filter((grant) => grant.scopeType === "COMPANY" && grant.companyId).map((grant) => grant.companyId as string))],
    branches: [...new Set(grants.filter((grant) => grant.scopeType === "BRANCH" && grant.branchId).map((grant) => grant.branchId as string))],
  };
}

function hasAnyScope(context: AccessContext, permissionCode: string): boolean {
  const scope = permissionScope(context, permissionCode);
  return scope.organization || scope.companies.length > 0 || scope.branches.length > 0;
}

function hasEmployeePermission(context: AccessContext, permissionCode: string, row: Pick<EmployeeRow, "organization_id" | "company_id" | "all_branch_ids">): boolean {
  const target: AccessTarget = { organizationId: row.organization_id, companyId: row.company_id };
  return hasPermission(context, permissionCode, target) || row.all_branch_ids.some((branchId) => hasPermission(context, permissionCode, { ...target, branchId }));
}

function employeeVisibility(context: AccessContext, permissionCode: string) {
  const scope = permissionScope(context, permissionCode);
  return {
    organization: scope.organization,
    companyIds: scope.companies,
    branchIds: scope.branches,
    sql: `($2::boolean OR employee.company_id = ANY($3::uuid[]) OR EXISTS (
      SELECT 1 FROM employee_branch_assignments AS visible_assignment
      WHERE visible_assignment.employee_id = employee.id AND visible_assignment.organization_id = employee.organization_id
        AND visible_assignment.company_id = employee.company_id AND visible_assignment.branch_id = ANY($4::uuid[])
    ))`,
  };
}

function normalizeText(value: string, label: string, maximum: number, uppercase = false): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  const result = uppercase ? normalized.toLocaleUpperCase("en-US") : normalized;
  if (!result || result.length > maximum || /[\r\n\0]/u.test(result)) throw new AuthServiceError(400, "INVALID_EMPLOYEE", `${label} no es válido.`);
  return result;
}

function normalizeOptional(value: string | null | undefined, label: string, maximum: number): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length > maximum || /[\r\n\0]/u.test(normalized)) throw new AuthServiceError(400, "INVALID_EMPLOYEE", `${label} no es válido.`);
  return normalized || null;
}

function normalizeDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "La fecha de ingreso no es válida.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "La fecha de ingreso no es válida.");
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function normalizeBranchIds(ids: string[] | undefined): string[] | undefined {
  if (ids === undefined) return undefined;
  if (ids.length > 100 || ids.some((id) => !isUuid(id))) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "Las sucursales no son válidas.");
  return [...new Set(ids)];
}

function employeeSelectSql(): string {
  return `SELECT employee.id, employee.organization_id, employee.company_id, employee.internal_code, employee.first_names, employee.last_names,
      employee.personal_document_number, employee.personal_phone, employee.personal_email, employee.personal_address,
      employee.position_id, position.code AS position_code, position.name AS position_name, employee.hire_date::text, employee.status,
      employee.user_id, employee.photo_file_id,
      COALESCE((SELECT array_agg(all_assignment.branch_id::text ORDER BY all_assignment.branch_id)
        FROM employee_branch_assignments AS all_assignment JOIN branches AS active_branch ON active_branch.id = all_assignment.branch_id AND active_branch.status = 'ACTIVE'
        WHERE all_assignment.employee_id = employee.id), ARRAY[]::text[]) AS all_branch_ids,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', branch.id, 'code', branch.code, 'name', branch.name) ORDER BY branch.code)
        FROM employee_branch_assignments AS visible_assignment JOIN branches AS branch ON branch.id = visible_assignment.branch_id
          AND branch.company_id = employee.company_id AND branch.organization_id = employee.organization_id
        WHERE visible_assignment.employee_id = employee.id
          AND branch.status = 'ACTIVE'
          AND ($2::boolean OR employee.company_id = ANY($3::uuid[]) OR branch.id = ANY($4::uuid[]))), '[]'::jsonb) AS branches,
      linked_user.display_name AS linked_display_name, linked_user.normalized_email AS linked_email,
      linked_membership.status AS linked_membership_status, organization.status AS organization_status, company.status AS company_status
    FROM employees AS employee JOIN organizations AS organization ON organization.id = employee.organization_id
    JOIN companies AS company ON company.id = employee.company_id AND company.organization_id = employee.organization_id
    LEFT JOIN catalog_items AS position ON position.id = employee.position_id
    LEFT JOIN organization_memberships AS linked_membership ON linked_membership.organization_id = employee.organization_id AND linked_membership.user_id = employee.user_id
    LEFT JOIN users AS linked_user ON linked_user.id = linked_membership.user_id`;
}

function mapListItem(row: EmployeeRow) {
  return { id: row.id, companyId: row.company_id, internalCode: row.internal_code, firstNames: row.first_names,
    lastNames: row.last_names, position: row.position_id && row.position_code && row.position_name ? { id: row.position_id, code: row.position_code, name: row.position_name } : null,
    hireDate: String(row.hire_date).slice(0, 10), status: row.status, branches: row.branches };
}

function mapDetails(row: EmployeeRow, context: AccessContext) {
  const canReadPersonalData = hasEmployeePermission(context, "employees.personal.read", row);
  const companyTarget = { organizationId: row.organization_id, companyId: row.company_id };
  const canUpdate = hasEmployeePermission(context, "employees.update", row);
  const canUpdateSharedFields = hasPermission(context, "employees.update", companyTarget);
  const canDeactivate = canUpdateSharedFields && hasPermission(context, "employees.deactivate", companyTarget);
  const canManagePersonalData = canUpdateSharedFields && canReadPersonalData;
  const canReadPhoto = canReadPersonalData && hasEmployeePermission(context, "files.download", row);
  const canManagePhoto = canManagePersonalData && hasEmployeePermission(context, "files.upload", row);
  const canDeletePhoto = canManagePersonalData && hasEmployeePermission(context, "files.delete", row);
  const canReadDocuments = hasEmployeePermission(context, "employee_documents.read", row) && hasEmployeePermission(context, "files.read", row);
  const canDownloadDocuments = canReadDocuments && hasEmployeePermission(context, "files.download", row);
  const canManageDocuments = hasEmployeePermission(context, "employee_documents.manage", row) && hasEmployeePermission(context, "files.upload", row)
    && hasEmployeePermission(context, "employees.update", row);
  const canDeleteDocuments = canManageDocuments && hasEmployeePermission(context, "files.delete", row);
  const canReadLinkedUser = canReadPersonalData && hasEmployeePermission(context, "users.read", row);
  const canManageUserLink = canManagePersonalData && hasEmployeePermission(context, "users.read", row);
  return { ...mapListItem(row), canReadPersonalData, canReadLinkedUser, canManageUserLink, canUpdate, canUpdateSharedFields, canDeactivate, canManagePersonalData, canReadPhoto, canManagePhoto, canDeletePhoto, canReadDocuments, canDownloadDocuments, canManageDocuments, canDeleteDocuments,
    ...(canReadPersonalData ? {
      personalData: { documentNumber: row.personal_document_number, phone: row.personal_phone, email: row.personal_email, address: row.personal_address },
      linkedUser: canReadLinkedUser && row.user_id && row.linked_display_name && row.linked_email && row.linked_membership_status
        ? { id: row.user_id, displayName: row.linked_display_name, email: row.linked_email, membershipStatus: row.linked_membership_status } : null,
      ...(canReadPhoto ? { photoFileId: row.photo_file_id } : {}),
    } : {}),
  };
}

async function loadEmployee(database: Pick<Pool, "query"> | Pick<PoolClient, "query">, context: AccessContext, employeeId: string): Promise<EmployeeRow> {
  const visibility = employeeVisibility(context, "employees.read");
  const result = await database.query<EmployeeRow>(
    `${employeeSelectSql()} WHERE employee.organization_id = $1::uuid AND employee.id = $5::uuid`,
    [context.organizationId, visibility.organization, visibility.companyIds, visibility.branchIds, employeeId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthServiceError(404, "EMPLOYEE_NOT_FOUND", "El empleado no está disponible.");
  return row;
}

function requireEmployeePermission(context: AccessContext, permissionCode: string, employee: EmployeeRow): void {
  if (!hasEmployeePermission(context, permissionCode, employee)) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para realizar esta operación con el empleado.");
}

export async function listEmployees(database: Pool, session: AuthenticatedSession, input: PageInput) {
  const context = await loadContext(database, session);
  if (!hasAnyScope(context, "employees.read")) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar personal.");
  const search = input.search?.trim() || null;
  if (search && (search.length > 120 || /[\0\r\n]/u.test(search))) throw new AuthServiceError(400, "INVALID_REQUEST", "La búsqueda no es válida.");
  const visibility = employeeVisibility(context, "employees.read");
  const params = [requireOrganizationId(session), visibility.organization, visibility.companyIds, visibility.branchIds, search, input.status ?? null, input.companyId ?? null, input.branchId ?? null];
  const where = `WHERE employee.organization_id = $1::uuid AND ${visibility.sql}
    AND ($5::text IS NULL OR strpos(lower(employee.internal_code || ' ' || employee.first_names || ' ' || employee.last_names), lower($5)) > 0)
    AND ($6::"RecordStatus" IS NULL OR employee.status = $6)
    AND ($7::uuid IS NULL OR employee.company_id = $7::uuid)
    AND ($8::uuid IS NULL OR EXISTS (SELECT 1 FROM employee_branch_assignments AS filter_assignment WHERE filter_assignment.employee_id = employee.id AND filter_assignment.branch_id = $8::uuid))`;
  const count = await database.query<{ total: string }>(`SELECT count(*)::text AS total FROM employees AS employee ${where}`, params);
  const rows = await database.query<EmployeeRow>(`${employeeSelectSql()} ${where}
    ORDER BY employee.last_names, employee.first_names, employee.internal_code, employee.id LIMIT $9 OFFSET $10`, [...params, input.limit, input.offset]);
  return { items: rows.rows.map(mapListItem), total: Number(count.rows[0]?.total ?? "0"), limit: input.limit, offset: input.offset };
}

export async function getEmployee(database: Pool, session: AuthenticatedSession, employeeId: string) {
  const context = await loadContext(database, session);
  if (!hasAnyScope(context, "employees.read")) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar personal.");
  const employee = await loadEmployee(database, context, employeeId);
  if (!hasEmployeePermission(context, "employees.read", employee)) throw new AuthServiceError(404, "EMPLOYEE_NOT_FOUND", "El empleado no está disponible.");
  return { item: mapDetails(employee, context) };
}

async function loadCompany(database: Pick<Pool, "query"> | Pick<PoolClient, "query">, organizationId: string, companyId: string, lock = false) {
  const result = await database.query<{ organization_status: string; company_status: string }>(
    `SELECT organization.status AS organization_status, company.status AS company_status FROM companies AS company
     JOIN organizations AS organization ON organization.id = company.organization_id
     WHERE company.id = $1::uuid AND company.organization_id = $2::uuid ${lock ? "FOR SHARE OF organization, company" : ""}`,
    [companyId, organizationId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthServiceError(404, "COMPANY_NOT_FOUND", "La empresa no está disponible.");
  return row;
}

async function validateBranches(database: Pick<Pool, "query"> | Pick<PoolClient, "query">, organizationId: string, companyId: string, branchIds: string[]) {
  if (branchIds.length === 0) return;
  const result = await database.query<{ id: string }>(`SELECT id FROM branches WHERE organization_id = $1::uuid AND company_id = $2::uuid AND status = 'ACTIVE' AND id = ANY($3::uuid[])`, [organizationId, companyId, branchIds]);
  if (result.rows.length !== branchIds.length) throw new AuthServiceError(400, "INVALID_EMPLOYEE_BRANCH", "Una sucursal no pertenece a la empresa o no está activa.");
}

async function validateUserLink(database: Pick<Pool, "query"> | Pick<PoolClient, "query">, organizationId: string, userId: string | null | undefined) {
  if (!userId) return;
  const result = await database.query("SELECT 1 FROM organization_memberships WHERE organization_id = $1::uuid AND user_id = $2::uuid", [organizationId, userId]);
  if (!result.rowCount) throw new AuthServiceError(400, "INVALID_EMPLOYEE_USER", "La cuenta debe pertenecer a la organización seleccionada.");
}

async function validateCatalogItem(database: Pick<Pool, "query"> | Pick<PoolClient, "query">, context: AccessContext, itemId: string | null | undefined, expectedCode: string, organizationId: string, companyId: string) {
  if (!itemId) return;
  const result = await database.query<{ available: boolean; scope: "GLOBAL" | "ORGANIZATION" | "COMPANY"; catalog_organization_id: string | null; catalog_company_id: string | null }>(
    `SELECT item.status = 'ACTIVE' AND catalog.status = 'ACTIVE' AND (catalog.scope = 'GLOBAL' OR
      (catalog.scope = 'ORGANIZATION' AND catalog.organization_id = $2::uuid) OR
      (catalog.scope = 'COMPANY' AND catalog.organization_id = $2::uuid AND catalog.company_id = $3::uuid)) AS available,
      catalog.scope, catalog.organization_id AS catalog_organization_id, catalog.company_id AS catalog_company_id
     FROM catalog_items AS item JOIN catalogs AS catalog ON catalog.id = item.catalog_id
     WHERE item.id = $1::uuid AND catalog.code = $4`, [itemId, organizationId, companyId, expectedCode]);
  const item = result.rows[0];
  if (!item?.available) throw new AuthServiceError(400, "INVALID_EMPLOYEE_CATALOG", "La opción seleccionada no está activa o disponible para la empresa.");
  const canReadCatalog = item.scope === "GLOBAL"
    ? hasAnyScope(context, "catalogs.read")
    : item.scope === "ORGANIZATION"
      ? item.catalog_organization_id === organizationId && hasPermission(context, "catalogs.read", { organizationId })
      : item.catalog_organization_id === organizationId && item.catalog_company_id === companyId
        && hasPermission(context, "catalogs.read", { organizationId, companyId });
  if (!canReadCatalog) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar el catálogo en este alcance.");
}

function normalizedPersonal(input: EmployeeMutationInput) {
  const email = input.personalEmail === undefined || input.personalEmail === null ? input.personalEmail : normalizeText(input.personalEmail, "El correo personal", 320).toLocaleLowerCase("en-US");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "El correo personal no es válido.");
  return {
    personalDocumentNumber: normalizeOptional(input.personalDocumentNumber, "El documento", 80),
    personalPhone: normalizeOptional(input.personalPhone, "El teléfono", 40),
    personalEmail: email,
    personalAddress: normalizeOptional(input.personalAddress, "El domicilio", 500),
  };
}

function requireActiveCompany(company: { organization_status: string; company_status: string }): void {
  if (company.organization_status !== "ACTIVE" || company.company_status !== "ACTIVE") throw new AuthServiceError(409, "EMPLOYEE_SCOPE_INACTIVE", "La empresa inactiva no admite cambios de personal.");
}

export async function createEmployee(database: Pool, session: AuthenticatedSession, input: EmployeeMutationInput, requestId: string) {
  const organizationId = requireOrganizationId(session);
  const companyId = input.companyId;
  if (!companyId || !isUuid(companyId)) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "La empresa no es válida.");
  const internalCode = normalizeText(input.internalCode ?? "", "El código interno", 60, true);
  const firstNames = normalizeText(input.firstNames ?? "", "Los nombres", 120);
  const lastNames = normalizeText(input.lastNames ?? "", "Los apellidos", 120);
  if (!input.hireDate) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "La fecha de ingreso es obligatoria.");
  const hireDate = normalizeDate(input.hireDate);
  const branchIds = normalizeBranchIds(input.branchIds) ?? [];
  const personal = normalizedPersonal(input);
  const employeeId = await transaction(database, async (client) => {
    const context = await loadContext(client, session);
    const company = await loadCompany(client, organizationId, companyId, true);
    const companyTarget = { organizationId, companyId };
    if (!hasPermission(context, "employees.create", companyTarget) && !branchIds.some((branchId) => hasPermission(context, "employees.create", { ...companyTarget, branchId }))) {
      throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para crear personal en esta empresa.");
    }
    if (branchIds.length === 0 && !hasPermission(context, "employees.create", companyTarget)) throw new AuthServiceError(403, "FORBIDDEN", "Selecciona una sucursal autorizada para crear este empleado.");
    requireActiveCompany(company);
    await validateBranches(client, organizationId, companyId, branchIds);
    for (const branchId of branchIds) if (!hasPermission(context, "employees.create", { ...companyTarget, branchId })) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para asignar personal a una de las sucursales seleccionadas.");
    if (Object.values(personal).some((value) => value !== undefined && value !== null) || input.userId) {
      if (!hasPermission(context, "employees.personal.read", companyTarget) && !branchIds.some((branchId) => hasPermission(context, "employees.personal.read", { ...companyTarget, branchId }))) {
        throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para guardar datos personales del empleado.");
      }
    }
    if (input.userId && !hasPermission(context, "users.read", companyTarget) && !branchIds.some((branchId) => hasPermission(context, "users.read", { ...companyTarget, branchId }))) {
      throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para vincular una cuenta de usuario en este alcance.");
    }
    await validateCatalogItem(client, context, input.positionId, "EMPLOYEE_POSITION", organizationId, companyId);
    await validateUserLink(client, organizationId, input.userId);
    const id = randomUUID();
    await client.query(`INSERT INTO employees (id, organization_id, company_id, internal_code, first_names, last_names,
      personal_document_number, personal_phone, personal_email, personal_address, position_id, hire_date, status, user_id, created_at, updated_at)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12::date,'ACTIVE',$13::uuid,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [id, organizationId, companyId, internalCode, firstNames, lastNames, personal.personalDocumentNumber ?? null, personal.personalPhone ?? null,
      personal.personalEmail ?? null, personal.personalAddress ?? null, input.positionId ?? null, hireDate, input.userId ?? null]);
    for (const branchId of branchIds) await client.query(`INSERT INTO employee_branch_assignments (employee_id, organization_id, company_id, branch_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, [id, organizationId, companyId, branchId]);
    await appendAuditEvent(client, { organizationId, companyId, branchId: null, actor: { type: "USER", userId: session.userId }, action: "EMPLOYEE_CREATED", resourceType: "Employee", resourceId: id, requestId,
      after: { status: "ACTIVE", fields: ["internalCode", "firstNames", "lastNames", "positionId", "hireDate", "branchAssignments", ...(input.userId ? ["userId"] : [])] } });
    return id;
  });
  return getEmployee(database, session, employeeId);
}

export async function updateEmployee(database: Pool, session: AuthenticatedSession, employeeId: string, input: EmployeeMutationInput, requestId: string) {
  const organizationId = requireOrganizationId(session);
  const branchIds = normalizeBranchIds(input.branchIds);
  const personal = normalizedPersonal(input);
  const personalWasProvided = [input.personalDocumentNumber, input.personalPhone, input.personalEmail, input.personalAddress].some((value) => value !== undefined);
  const updatedId = await transaction(database, async (client) => {
    const context = await loadContext(client, session);
    const currentResult = await client.query<EmployeeRow>(`${employeeSelectSql()} WHERE employee.organization_id = $1::uuid AND employee.id = $5::uuid FOR UPDATE OF employee`,
      [organizationId, false, [], [], employeeId]);
    const current = currentResult.rows[0];
    if (!current) throw new AuthServiceError(404, "EMPLOYEE_NOT_FOUND", "El empleado no está disponible.");
    if (!hasEmployeePermission(context, "employees.update", current)) throw new AuthServiceError(404, "EMPLOYEE_NOT_FOUND", "El empleado no está disponible.");
    const companyTarget = { organizationId, companyId: current.company_id };
    if (input.companyId !== undefined && input.companyId !== current.company_id) throw new AuthServiceError(400, "INVALID_EMPLOYEE", "No se puede trasladar el empleado a otra empresa.");
    const hasSharedFieldChanges = Object.entries(input).some(([key, value]) => key !== "branchIds" && value !== undefined);
    if (hasSharedFieldChanges && !hasPermission(context, "employees.update", companyTarget)) {
      throw new AuthServiceError(403, "FORBIDDEN", "El permiso de sucursal solo permite administrar asignaciones de esa sucursal; los datos laborales requieren alcance de empresa u organización.");
    }
    requireActiveCompany(await loadCompany(client, organizationId, current.company_id, true));
    if (input.status === "INACTIVE") requireEmployeePermission(context, "employees.deactivate", current);
    if ((personalWasProvided || input.userId !== undefined) && !hasEmployeePermission(context, "employees.personal.read", current)) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para actualizar datos personales del empleado.");
    if (input.positionId !== undefined) await validateCatalogItem(client, context, input.positionId, "EMPLOYEE_POSITION", organizationId, current.company_id);
    if (input.userId !== undefined && !hasEmployeePermission(context, "users.read", current)) {
      throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para vincular una cuenta de usuario en este alcance.");
    }
    if (input.userId !== undefined) await validateUserLink(client, organizationId, input.userId);

    const sets: string[] = []; const values: unknown[] = [employeeId, organizationId];
    const put = (column: string, value: unknown, cast = "") => { values.push(value); sets.push(`"${column}" = $${values.length}${cast}`); };
    if (input.internalCode !== undefined) put("internal_code", normalizeText(input.internalCode, "El código interno", 60, true));
    if (input.firstNames !== undefined) put("first_names", normalizeText(input.firstNames, "Los nombres", 120));
    if (input.lastNames !== undefined) put("last_names", normalizeText(input.lastNames, "Los apellidos", 120));
    if (input.personalDocumentNumber !== undefined) put("personal_document_number", personal.personalDocumentNumber ?? null);
    if (input.personalPhone !== undefined) put("personal_phone", personal.personalPhone ?? null);
    if (input.personalEmail !== undefined) put("personal_email", personal.personalEmail ?? null);
    if (input.personalAddress !== undefined) put("personal_address", personal.personalAddress ?? null);
    if (input.positionId !== undefined) put("position_id", input.positionId, "::uuid");
    if (input.hireDate !== undefined) put("hire_date", normalizeDate(input.hireDate), "::date");
    if (input.status !== undefined) {
      if (input.status !== "ACTIVE" && input.status !== "INACTIVE") throw new AuthServiceError(400, "INVALID_EMPLOYEE", "El estado no es válido.");
      put("status", input.status, "::\"RecordStatus\"");
    }
    if (input.userId !== undefined) put("user_id", input.userId, "::uuid");
    if (sets.length) { sets.push("\"updated_at\" = CURRENT_TIMESTAMP"); await client.query(`UPDATE employees SET ${sets.join(", ")} WHERE id = $1::uuid AND organization_id = $2::uuid`, values); }

    if (branchIds !== undefined) {
      await validateBranches(client, organizationId, current.company_id, branchIds);
      const old = await client.query<{ branch_id: string }>("SELECT branch_id FROM employee_branch_assignments WHERE employee_id = $1::uuid", [employeeId]);
      const oldIds = new Set(old.rows.map((row) => row.branch_id)); const newIds = new Set(branchIds);
      for (const branchId of branchIds) {
        if (!oldIds.has(branchId)) {
          if (!hasPermission(context, "employees.update", { ...companyTarget, branchId })) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para asignar personal a una de las sucursales seleccionadas.");
          await client.query("INSERT INTO employee_branch_assignments (employee_id, organization_id, company_id, branch_id) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid)", [employeeId, organizationId, current.company_id, branchId]);
        }
      }
      for (const branchId of oldIds) if (!newIds.has(branchId) && hasPermission(context, "employees.update", { ...companyTarget, branchId })) {
        await client.query("DELETE FROM employee_branch_assignments WHERE employee_id = $1::uuid AND branch_id = $2::uuid", [employeeId, branchId]);
      }
      if (!sets.length) await client.query("UPDATE employees SET updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid", [employeeId]);
    }
    const fields = [...sets.map((part) => part.match(/^"([^"]+)"/u)?.[1] ?? "field"), ...(branchIds !== undefined ? ["branchAssignments"] : [])];
    if (fields.length) await appendAuditEvent(client, { organizationId, companyId: current.company_id, branchId: null,
      actor: { type: "USER", userId: session.userId }, action: input.status === "INACTIVE" ? "EMPLOYEE_DEACTIVATED" : "EMPLOYEE_UPDATED",
      resourceType: "Employee", resourceId: employeeId, requestId,
      before: { status: current.status }, after: { status: input.status ?? current.status, fields } });
    return employeeId;
  });
  return getEmployee(database, session, updatedId);
}

export async function listEmployeeScopeOptions(database: Pool, session: AuthenticatedSession) {
  const organizationId = requireOrganizationId(session); const context = await loadContext(database, session);
  if (!hasAnyScope(context, "employees.read") && !hasAnyScope(context, "employees.create") && !hasAnyScope(context, "employees.update")) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar el alcance de personal.");
  const companies = await database.query<{ id: string; legal_name: string }>(`SELECT id, legal_name FROM companies WHERE organization_id = $1::uuid AND status = 'ACTIVE' ORDER BY legal_name,id`, [organizationId]);
  const branches = await database.query<{ id: string; company_id: string; code: string; name: string }>(`SELECT id, company_id, code, name FROM branches WHERE organization_id = $1::uuid AND status = 'ACTIVE' ORDER BY company_id,code,id`, [organizationId]);
  const employeePermissionCodes = ["employees.read", "employees.create", "employees.update"];
  const companyIds = companies.rows.flatMap((company) => {
    const target = { organizationId, companyId: company.id };
    const companyAllowed = employeePermissionCodes.some((permission) => hasPermission(context, permission, target));
    const branchAllowed = branches.rows.some((branch) => branch.company_id === company.id && employeePermissionCodes.some((permission) => hasPermission(context, permission, { ...target, branchId: branch.id })));
    return companyAllowed || branchAllowed ? [company.id] : [];
  });
  const canReadCatalogs = hasAnyScope(context, "catalogs.read");
  const catalogScope = permissionScope(context, "catalogs.read");
  const catalogCompanyIds = companyIds.filter((id) => catalogScope.organization || catalogScope.companies.includes(id));
  const positions = canReadCatalogs ? await database.query<{ id: string; code: string; name: string }>(
    `SELECT item.id, item.code, item.name FROM catalog_items AS item JOIN catalogs AS catalog ON catalog.id = item.catalog_id
     WHERE catalog.code = 'EMPLOYEE_POSITION' AND catalog.status = 'ACTIVE' AND item.status = 'ACTIVE'
       AND ((catalog.scope = 'GLOBAL' AND $2::boolean) OR (catalog.scope = 'ORGANIZATION' AND catalog.organization_id = $1::uuid AND $3::boolean)
         OR (catalog.scope = 'COMPANY' AND catalog.organization_id = $1::uuid AND catalog.company_id = ANY($4::uuid[])))
     ORDER BY item.name,item.code,item.id`, [organizationId, canReadCatalogs, catalogScope.organization, catalogCompanyIds]) : { rows: [] as Array<{ id: string; code: string; name: string }> };
  const documentTypes = canReadCatalogs ? await database.query<{ id: string; code: string; name: string }>(
    `SELECT item.id, item.code, item.name FROM catalog_items AS item JOIN catalogs AS catalog ON catalog.id = item.catalog_id
     WHERE catalog.code = 'EMPLOYEE_DOCUMENT_TYPE' AND catalog.status = 'ACTIVE' AND item.status = 'ACTIVE'
       AND ((catalog.scope = 'GLOBAL' AND $2::boolean) OR (catalog.scope = 'ORGANIZATION' AND catalog.organization_id = $1::uuid AND $3::boolean)
         OR (catalog.scope = 'COMPANY' AND catalog.organization_id = $1::uuid AND catalog.company_id = ANY($4::uuid[])))
     ORDER BY item.name,item.code,item.id`, [organizationId, canReadCatalogs, catalogScope.organization, catalogCompanyIds]) : { rows: [] as Array<{ id: string; code: string; name: string }> };
  const users = permissionScope(context, "users.read").organization ? await database.query<{ id: string; display_name: string; normalized_email: string; status: MembershipStatus }>(
    `SELECT app_user.id, app_user.display_name, app_user.normalized_email, membership.status FROM organization_memberships AS membership
     JOIN users AS app_user ON app_user.id = membership.user_id WHERE membership.organization_id = $1::uuid AND app_user.status = 'ACTIVE'
     ORDER BY app_user.display_name,app_user.normalized_email,app_user.id LIMIT 200`, [organizationId])
    : { rows: [] as Array<{ id: string; display_name: string; normalized_email: string; status: MembershipStatus }> };
  return {
    companies: companies.rows.flatMap((company) => {
      const target = { organizationId, companyId: company.id };
      const canCreate = hasPermission(context, "employees.create", target); const canUpdate = hasPermission(context, "employees.update", target);
      const companyBranches = branches.rows.filter((branch) => branch.company_id === company.id).flatMap((branch) => {
        const branchTarget = { ...target, branchId: branch.id };
        const branchCreate = canCreate || hasPermission(context, "employees.create", branchTarget);
        const branchUpdate = canUpdate || hasPermission(context, "employees.update", branchTarget);
        const branchRead = hasPermission(context, "employees.read", branchTarget);
        return branchRead || branchCreate || branchUpdate ? [{ id: branch.id, code: branch.code, name: branch.name, canCreate: branchCreate, canUpdate: branchUpdate }] : [];
      });
      return canCreate || canUpdate || companyBranches.length ? [{ id: company.id, legalName: company.legal_name, canCreate, canUpdate, branches: companyBranches }] : [];
    }),
    positions: positions.rows,
    documentTypes: documentTypes.rows,
    users: users.rows.map((row) => ({ id: row.id, displayName: row.display_name, email: row.normalized_email, membershipStatus: row.status })),
  };
}

export async function listEmployeeDocuments(database: Pool, session: AuthenticatedSession, employeeId: string) {
  const context = await loadContext(database, session);
  if (!hasAnyScope(context, "employees.read")) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para consultar personal.");
  const employee = await loadEmployee(database, context, employeeId);
  if (!hasEmployeePermission(context, "employees.read", employee)) throw new AuthServiceError(404, "EMPLOYEE_NOT_FOUND", "El empleado no está disponible.");
  requireEmployeePermission(context, "employee_documents.read", employee); requireEmployeePermission(context, "files.read", employee);
  const result = await database.query<{ id: string; file_id: string; type_id: string; type_code: string; type_name: string; original_name: string; detected_mime: string; bytes: string; issued_at: string | null; expires_at: string | null; created_at: Date }>(
    `SELECT document.id,file.id AS file_id,type.id AS type_id,type.code AS type_code,type.name AS type_name,
      file.original_name,file.detected_mime,file.bytes::text,document.issued_at::text,document.expires_at::text,document.created_at
     FROM employee_documents AS document JOIN files AS file ON file.id = document.file_id AND file.status = 'ACTIVE'
     JOIN catalog_items AS type ON type.id = document.type_id WHERE document.organization_id = $1::uuid AND document.employee_id = $2::uuid
     ORDER BY document.created_at DESC,document.id LIMIT 100`, [requireOrganizationId(session), employeeId]);
  return { canDownload: hasEmployeePermission(context, "files.download", employee), items: result.rows.map((row) => ({ id: row.id, fileId: row.file_id, type: { id: row.type_id, code: row.type_code, name: row.type_name },
    originalName: row.original_name, detectedMime: row.detected_mime, bytes: Number(row.bytes), issuedAt: row.issued_at, expiresAt: row.expires_at, createdAt: row.created_at.toISOString() })) };
}

export async function authorizeEmployeeFile(database: Pick<Pool, "query"> | Pick<PoolClient, "query">, session: AuthenticatedSession, employeeId: string, permissions: readonly string[]) {
  const context = await loadContext(database, session); const employee = await loadEmployee(database, context, employeeId);
  for (const permission of permissions) requireEmployeePermission(context, permission, employee);
  if (employee.status !== "ACTIVE" || employee.organization_status !== "ACTIVE" || employee.company_status !== "ACTIVE") throw new AuthServiceError(409, "EMPLOYEE_INACTIVE", "El empleado inactivo no admite cambios.");
  return { context, employee };
}
