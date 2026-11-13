import type { BranchOption, CompanyOption, EmployeeOption, IntegratedFileItem, PageResponse, RecordStatus } from "@mvp-transporte/shared-contracts";
import { ApiError } from "../../errors.ts";

const permissionDefinitions = [
  { code: "transport.vehicles.read", description: "Consultar vehículos" },
  { code: "transport.vehicles.create", description: "Registrar vehículos" },
  { code: "transport.vehicles.update", description: "Editar vehículos" },
  { code: "transport.vehicles.deactivate", description: "Desactivar vehículos" },
  { code: "transport.driver_profiles.read", description: "Consultar perfiles de conductor" },
  { code: "transport.driver_profiles.manage", description: "Administrar perfiles de conductor" },
  { code: "transport.assistant_profiles.read", description: "Consultar perfiles de ayudante" },
  { code: "transport.assistant_profiles.manage", description: "Administrar perfiles de ayudante" },
  { code: "transport.operational_staff.read", description: "Consultar empleados para perfiles operativos" },
  { code: "transport.documents.read", description: "Consultar documentos operativos" },
  { code: "transport.documents.manage", description: "Administrar documentos operativos" },
  { code: "transport.vehicle_files.read", description: "Consultar archivos privados de vehículos" },
  { code: "transport.vehicle_files.upload", description: "Cargar archivos privados de vehículos" },
  { code: "transport.vehicle_files.download", description: "Descargar archivos privados de vehículos" },
  { code: "transport.vehicle_files.delete", description: "Retirar archivos privados de vehículos" },
  { code: "transport.employee_files.read", description: "Consultar archivos privados de empleados" },
  { code: "transport.employee_files.upload", description: "Cargar archivos privados de empleados" },
  { code: "transport.employee_files.download", description: "Descargar archivos privados de empleados" },
  { code: "transport.employee_files.delete", description: "Retirar archivos privados de empleados" },
  { code: "transport.maintenance.read", description: "Consultar mantenimiento de vehículos" },
  { code: "transport.maintenance.manage", description: "Administrar mantenimiento de vehículos" },
  { code: "transport.fuel.read", description: "Consultar tanques y cargas de combustible" },
  { code: "transport.fuel.manage", description: "Administrar tanques y cargas de combustible" },
  { code: "transport.trips.read", description: "Consultar viajes y asignaciones" },
  { code: "transport.trips.create", description: "Planificar viajes" },
  { code: "transport.trips.assign", description: "Asignar y cambiar recursos de un viaje" },
  { code: "transport.trips.transition", description: "Cambiar el estado operativo de un viaje" },
  { code: "transport.driver_trips.read", description: "Consultar únicamente viajes propios como conductor" },
  { code: "transport.driver_trips.transition", description: "Iniciar y completar viajes propios como conductor" },
  { code: "transport.audit.write", description: "Registrar cambios de transporte en auditoría" },
];
const fileResources = [
  {
    resourceType: "VEHICLE",
    readPermissionCode: "transport.vehicle_files.read",
    uploadPermissionCode: "transport.vehicle_files.upload",
    downloadPermissionCode: "transport.vehicle_files.download",
    deletePermissionCode: "transport.vehicle_files.delete",
  },
  {
    resourceType: "EMPLOYEE",
    readPermissionCode: "transport.employee_files.read",
    uploadPermissionCode: "transport.employee_files.upload",
    downloadPermissionCode: "transport.employee_files.download",
    deletePermissionCode: "transport.employee_files.delete",
  },
];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AuthorizedTarget {
  authorized: true;
  actorId: string;
  organizationId: string;
  membershipId: string;
  companyId: string;
  branchId: string | null;
  permissionCode: string;
}

export interface EmployeeDetails {
  id: string;
  companyId: string;
  internalCode: string;
  firstNames: string;
  lastNames: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface CurrentEmployeeContext {
  employeeId: string;
  organizationId: string;
  companyId: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function statusValue(value: unknown): RecordStatus | undefined {
  return value === "ACTIVE" || value === "INACTIVE" ? value : undefined;
}

function mapEmployee(value: unknown, expectedCompanyId?: string): EmployeeOption {
  const item = asRecord(value);
  const status = statusValue(item?.status);
  if (!item || typeof item.id !== "string" || !uuidPattern.test(item.id) || typeof item.companyId !== "string" || !uuidPattern.test(item.companyId) ||
    (item.internalCode !== undefined && item.internalCode !== null && typeof item.internalCode !== "string") || typeof item.firstNames !== "string" ||
    typeof item.lastNames !== "string" || !status || (expectedCompanyId && item.companyId !== expectedCompanyId)) {
    throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió un empleado no válido.");
  }
  return { id: item.id, companyId: item.companyId, internalCode: typeof item.internalCode === "string" ? item.internalCode : "", firstNames: item.firstNames, lastNames: item.lastNames, status };
}

function mapCompany(value: unknown): CompanyOption {
  const item = asRecord(value);
  const status = statusValue(item?.status);
  if (!item || typeof item.id !== "string" || !uuidPattern.test(item.id) || typeof item.legalName !== "string" || !status ||
    (item.tradeName !== undefined && item.tradeName !== null && typeof item.tradeName !== "string")) {
    throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió una empresa no válida.");
  }
  return { id: item.id, legalName: item.legalName, tradeName: typeof item.tradeName === "string" ? item.tradeName : null, status };
}

function mapBranch(value: unknown, expectedCompanyId: string): BranchOption {
  const item = asRecord(value);
  const status = statusValue(item?.status);
  if (!item || typeof item.id !== "string" || !uuidPattern.test(item.id) || item.companyId !== expectedCompanyId ||
    typeof item.code !== "string" || typeof item.name !== "string" || !status) {
    throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió una sucursal no válida.");
  }
  return { id: item.id, companyId: item.companyId, code: item.code, name: item.name, status };
}

export class BaseIntegrationClient {
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(baseApiUrl: string, secret: string) {
    this.baseUrl = baseApiUrl.replace(/\/+$/u, "");
    this.secret = secret;
  }

  async register(): Promise<void> {
    await this.send("/integrations/transport/registration", {
      method: "PUT",
      body: {
        displayName: "Transporte",
        auditPermissionCode: "transport.audit.write",
        permissions: permissionDefinitions,
        fileResources,
      },
    });
  }

  async authorize(
    bearer: string,
    permissionCode: string,
    companyId: string,
    branchId?: string | null,
  ): Promise<AuthorizedTarget> {
    const result = await this.send<unknown>("/integrations/transport/authorize", {
      method: "POST",
      bearer,
      body: { permissionCode, companyId, ...(branchId ? { branchId } : {}) },
    });
    const item = asRecord(result);
    if (item?.authorized !== true || typeof item.actorId !== "string" || !uuidPattern.test(item.actorId) ||
      typeof item.organizationId !== "string" || !uuidPattern.test(item.organizationId) ||
      typeof item.membershipId !== "string" || !uuidPattern.test(item.membershipId) || item.companyId !== companyId ||
      item.branchId !== (branchId ?? null) || item.permissionCode !== permissionCode) {
      throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió un contexto de autorización no válido.");
    }
    return {
      authorized: true,
      actorId: item.actorId,
      organizationId: item.organizationId,
      membershipId: item.membershipId,
      companyId,
      branchId: branchId ?? null,
      permissionCode,
    };
  }

  async getCurrentEmployee(bearer: string): Promise<CurrentEmployeeContext> {
    const result = await this.send<unknown>("/employees/me", { bearer });
    const item = asRecord(asRecord(result)?.item);
    if (!item || typeof item.employeeId !== "string" || !uuidPattern.test(item.employeeId) ||
      typeof item.organizationId !== "string" || !uuidPattern.test(item.organizationId) ||
      typeof item.companyId !== "string" || !uuidPattern.test(item.companyId)) {
      throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió una identidad de empleado no válida.");
    }
    return { employeeId: item.employeeId, organizationId: item.organizationId, companyId: item.companyId };
  }

  async getEmployee(bearer: string, employeeId: string, expectedCompanyId?: string): Promise<EmployeeDetails> {
    const result = await this.send<unknown>(`/employees/${encodeURIComponent(employeeId)}`, { bearer });
    const employee = mapEmployee(asRecord(result)?.item, expectedCompanyId);
    if (employee.id !== employeeId) {
      throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió un empleado no válido.");
    }
    return employee;
  }

  async listEmployees(
    bearer: string,
    companyId: string,
    input: { limit: number; offset: number; search?: string; status?: RecordStatus },
  ): Promise<PageResponse<EmployeeOption>> {
    const query = new URLSearchParams({ companyId, limit: String(input.limit), offset: String(input.offset) });
    if (input.search) query.set("search", input.search);
    if (input.status) query.set("status", input.status);
    const result = await this.send<{ items: unknown[]; total: number }>(`/employees?${query.toString()}`, { bearer });
    if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0) {
      throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió una página de empleados no válida.");
    }
    return { items: result.items.map((item) => mapEmployee(item, companyId)), total: result.total, limit: input.limit, offset: input.offset };
  }

  async listCompanies(bearer: string): Promise<CompanyOption[]> {
    return this.listPages(bearer, (offset) => `/organizations/companies?limit=100&offset=${offset}`, "empresas", mapCompany);
  }

  async listBranches(bearer: string, companyId: string): Promise<BranchOption[]> {
    return this.listPages(bearer, (offset) => {
      const query = new URLSearchParams({ companyId, limit: "100", offset: String(offset) });
      return `/organizations/branches?${query.toString()}`;
    }, "sucursales", (item) => mapBranch(item, companyId));
  }

  async uploadExternalFile(
    bearer: string,
    resourceType: "VEHICLE" | "EMPLOYEE",
    resourceId: string,
    target: AuthorizedTarget,
    body: Buffer,
    contentType: string,
  ): Promise<IntegratedFileItem> {
    const query = new URLSearchParams({ companyId: target.companyId });
    if (target.branchId) query.set("branchId", target.branchId);
    const result = await this.send<unknown>(
      `/integrations/transport/files/${resourceType}/${encodeURIComponent(resourceId)}?${query.toString()}`,
      { method: "POST", bearer, rawBody: body, contentType },
    );
    return this.mapIntegratedFile(asRecord(result)?.item, resourceType, resourceId);
  }

  async listExternalFiles(
    bearer: string,
    resourceType: "VEHICLE" | "EMPLOYEE",
    resourceId: string,
    target: AuthorizedTarget,
  ): Promise<IntegratedFileItem[]> {
    const files: IntegratedFileItem[] = [];
    for (let offset = 0; offset < 10_000; offset += 100) {
      const query = new URLSearchParams({ companyId: target.companyId, limit: "100", offset: String(offset) });
      if (target.branchId) query.set("branchId", target.branchId);
      const result = await this.send<unknown>(
        `/integrations/transport/files/${resourceType}/${encodeURIComponent(resourceId)}?${query.toString()}`,
        { bearer },
      );
      const item = asRecord(result);
      if (!Array.isArray(item?.items) || !Number.isSafeInteger(item.total) || (item.total as number) < 0) {
        throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió una lista de archivos no válida.");
      }
      files.push(...item.items.map((file) => this.mapIntegratedFile(file, resourceType, resourceId)));
      if (files.length >= (item.total as number)) return files;
      if (item.items.length === 0) throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió una lista incompleta de archivos.");
    }
    throw new ApiError(502, "BASE_PAGE_LIMIT", "El historial de archivos supera el límite de consulta permitido.");
  }

  async downloadExternalFile(bearer: string, fileId: string): Promise<{ body: Buffer; mimeType: string; originalName: string }> {
    const metadataResult = await this.send<unknown>(`/integrations/transport/files/${encodeURIComponent(fileId)}`, { bearer });
    const metadata = this.mapIntegratedFile(asRecord(metadataResult)?.item);
    if (!metadata.canDownload) throw new ApiError(403, "FILE_DOWNLOAD_FORBIDDEN", "No tienes permiso para descargar este archivo.");
    const response = await this.request(`/integrations/transport/files/${encodeURIComponent(fileId)}/content`, { bearer });
    if (!response.ok) throw await this.baseError(response);
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? metadata.detectedMime;
    return { body: Buffer.from(await response.arrayBuffer()), mimeType, originalName: metadata.originalName };
  }

  async deleteExternalFile(bearer: string, fileId: string): Promise<void> {
    await this.send(`/integrations/transport/files/${encodeURIComponent(fileId)}`, { method: "DELETE", bearer });
  }

  private mapIntegratedFile(value: unknown, expectedResourceType?: "VEHICLE" | "EMPLOYEE", expectedResourceId?: string): IntegratedFileItem {
    const item = asRecord(value);
    const mimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    if (!item || typeof item.id !== "string" || !uuidPattern.test(item.id) || item.integrationCode !== "transport" ||
      typeof item.resourceType !== "string" || (expectedResourceType && item.resourceType !== expectedResourceType) ||
      typeof item.resourceId !== "string" || !uuidPattern.test(item.resourceId) || (expectedResourceId && item.resourceId !== expectedResourceId) ||
      typeof item.originalName !== "string" || item.originalName.length > 255 || typeof item.detectedMime !== "string" || !mimeTypes.has(item.detectedMime) ||
      !Number.isSafeInteger(item.bytes) || (item.bytes as number) < 1 || (item.bytes as number) > 10 * 1024 * 1024 ||
      typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) || typeof item.canDownload !== "boolean") {
      throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió los metadatos de un archivo no válidos.");
    }
    return {
      id: item.id,
      integrationCode: "transport",
      resourceType: item.resourceType,
      resourceId: item.resourceId,
      originalName: item.originalName,
      detectedMime: item.detectedMime as IntegratedFileItem["detectedMime"],
      bytes: item.bytes as number,
      createdAt: item.createdAt,
      canDownload: item.canDownload,
    };
  }

  private async listPages<T>(bearer: string, pathAtOffset: (offset: number) => string, label: string, mapItem: (item: unknown) => T): Promise<T[]> {
    const items: T[] = [];
    for (let offset = 0; offset < 10_000; offset += 100) {
      const result = await this.send<{ items: unknown[]; total?: number }>(pathAtOffset(offset), { bearer });
      if (!Array.isArray(result.items)) throw new ApiError(502, "BASE_INVALID_RESPONSE", `mvp-base devolvió una lista de ${label} no válida.`);
      items.push(...result.items.map(mapItem));
      if (result.items.length < 100 || (typeof result.total === "number" && items.length >= result.total)) return items;
    }
    throw new ApiError(502, "BASE_PAGE_LIMIT", `La lista de ${label} supera el límite de consulta permitido.`);
  }

  async audit(
    bearer: string,
    target: AuthorizedTarget,
    event: {
      action: string;
      resourceType: `transport.${string}`;
      resourceId: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.send("/integrations/transport/audit-events", {
      method: "POST",
      bearer,
      body: {
        companyId: target.companyId,
        ...(target.branchId ? { branchId: target.branchId } : {}),
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        ...(event.before ? { before: event.before } : {}),
        ...(event.after ? { after: event.after } : {}),
      },
    });
  }

  private async send<T = unknown>(
    path: string,
    options: { method?: string; bearer?: string; body?: unknown; rawBody?: Buffer; contentType?: string } = {},
  ): Promise<T> {
    const response = await this.request(path, options);
    if (!response.ok) {
      throw await this.baseError(response);
    }
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; } catch { throw new ApiError(502, "BASE_INVALID_RESPONSE", "mvp-base devolvió una respuesta no válida."); }
  }

  private async request(path: string, options: { method?: string; bearer?: string; body?: unknown; rawBody?: Buffer; contentType?: string } = {}): Promise<Response> {
    const headers = new Headers({ Accept: "application/json", "X-MVP-Integration-Key": this.secret });
    if (options.bearer) headers.set("Authorization", `Bearer ${options.bearer}`);
    if (options.rawBody && options.contentType) headers.set("Content-Type", options.contentType);
    else if (options.body !== undefined) headers.set("Content-Type", "application/json");
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.rawBody ? { body: options.rawBody as unknown as BodyInit } : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiError(503, "BASE_UNAVAILABLE", "mvp-base no está disponible temporalmente.");
    }
  }

  private async baseError(response: Response): Promise<ApiError> {
    let body: { error?: { code?: unknown; message?: unknown } } = {};
    try { body = await response.json() as typeof body; } catch { /* Use the safe fallback below. */ }
    const status = response.status === 401 ? 401 : response.status === 403 ? 403 : response.status === 404 ? 404 : response.status >= 500 ? 503 : response.status;
    const code = typeof body.error?.code === "string" ? body.error.code : "BASE_REQUEST_FAILED";
    const message = typeof body.error?.message === "string" ? body.error.message : "mvp-base rechazó la solicitud.";
    return new ApiError(status, code, message);
  }
}
