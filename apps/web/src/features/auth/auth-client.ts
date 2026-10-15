import type {
  AccountTokenInspectionResponse,
  AuthCredentialsResponse,
  Catalog,
  CatalogItem,
  CatalogScope,
  CatalogScopeOptions,
  BranchItem,
  CompanyItem,
  CreatedOrganizationResponse,
  CurrentUserResponse,
  OrganizationMembershipStatusResponse,
  OrganizationStatus,
  OrganizationUserItem,
  PlatformOrganizationItem,
  OrganizationRoleItem,
  OrganizationRoleMutationResult,
  PermissionCatalogItem,
  PageResponse,
  RoleAssignmentCreated,
  RoleAssignmentItem,
  RoleAssignmentOption,
  RoleScopeType,
  RoleStatus,
  RecordStatus,
  SelectOrganizationResponse,
} from "@mvp-transporte/contracts";

const csrfCookieName = "mvp_csrf";
const authChannelName = "mvp-transporte-auth";
const authChannel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(authChannelName);

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let refreshPromise: Promise<boolean> | null = null;
const sessionListeners = new Set<() => void>();

export class AuthClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
  return configuredUrl.replace(/\/+$/u, "");
}

function notifySessionChange(): void {
  for (const listener of sessionListeners) {
    listener();
  }
}

function setAccessToken(token: string, expiresAt: string, broadcast = true): void {
  accessToken = token;
  const parsedExpiry = Date.parse(expiresAt);
  accessTokenExpiresAt = Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 60_000;
  if (broadcast) {
    authChannel?.postMessage({ type: "token", token, expiresAt });
  }
  notifySessionChange();
}

function clearAccessToken(broadcast = true): void {
  accessToken = null;
  accessTokenExpiresAt = 0;
  if (broadcast) {
    authChannel?.postMessage({ type: "logout" });
  }
  notifySessionChange();
}

authChannel?.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (typeof event.data !== "object" || event.data === null) {
    return;
  }
  const message = event.data as Record<string, unknown>;
  if (message.type === "token" && typeof message.token === "string" && typeof message.expiresAt === "string") {
    setAccessToken(message.token, message.expiresAt, false);
  } else if (message.type === "logout") {
    clearAccessToken(false);
  }
});

export function subscribeAuthChanges(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

async function readError(response: Response): Promise<AuthClientError> {
  let body: { error?: { code?: string; message?: string } } | null = null;
  try {
    body = (await response.json()) as { error?: { code?: string; message?: string } };
  } catch {
    body = null;
  }
  return new AuthClientError(
    response.status,
    body?.error?.code ?? "REQUEST_FAILED",
    body?.error?.message ?? "No fue posible completar la solicitud.",
  );
}

async function applyCredentials(response: Response): Promise<AuthCredentialsResponse> {
  const credentials = (await response.json()) as AuthCredentialsResponse;
  setAccessToken(credentials.accessToken, credentials.accessTokenExpiresAt);
  return credentials;
}

async function refreshOnce(failedToken?: string | null): Promise<boolean> {
  const currentToken = accessToken;
  if (failedToken && currentToken && currentToken !== failedToken && accessTokenExpiresAt > Date.now() + 30_000) {
    return true;
  }
  if (!failedToken && currentToken && accessTokenExpiresAt > Date.now() + 30_000) {
    return true;
  }
  const csrfToken = readCookie(csrfCookieName);
  if (!csrfToken) {
    clearAccessToken();
    return false;
  }
  const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearAccessToken();
    }
    return false;
  }
  await applyCredentials(response);
  return true;
}

export async function refreshSession(failedToken?: string | null): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise;
  }
  const operation = async (): Promise<boolean> => {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks) {
      return refreshOnce(failedToken);
    }
    return locks.request("mvp-transporte:auth-refresh", { mode: "exclusive" }, () => refreshOnce(failedToken));
  };
  refreshPromise = operation().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function initializeAuth(): Promise<CurrentUserResponse | null> {
  if (!(await refreshSession())) {
    return null;
  }
  try {
    return await apiRequest<CurrentUserResponse>("/auth/me");
  } catch {
    clearAccessToken();
    return null;
  }
}

export async function login(email: string, password: string): Promise<AuthCredentialsResponse> {
  const response = await fetch(`${getApiBaseUrl()}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw await readError(response);
  }
  const credentials = await applyCredentials(response);
  return credentials;
}

export async function logout(): Promise<void> {
  const csrfToken = readCookie(csrfCookieName);
  try {
    if (csrfToken) {
      await fetch(`${getApiBaseUrl()}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      });
    }
  } finally {
    clearAccessToken();
  }
}

async function authorizedFetch(path: string, init: RequestInit, allowRefresh: boolean): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const tokenBeforeRequest = accessToken;
  const response = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 401 && allowRefresh && tokenBeforeRequest) {
    if (await refreshSession(tokenBeforeRequest)) {
      const retryHeaders = new Headers(init.headers);
      if (accessToken) {
        retryHeaders.set("Authorization", `Bearer ${accessToken}`);
      }
      if (init.body && !retryHeaders.has("Content-Type")) {
        retryHeaders.set("Content-Type", "application/json");
      }
      return fetch(`${getApiBaseUrl()}${path}`, { ...init, headers: retryHeaders, credentials: "include" });
    }
  }
  return response;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken && !(await refreshSession())) {
    throw new AuthClientError(401, "UNAUTHENTICATED", "Inicia sesión para continuar.");
  }
  const response = await authorizedFetch(path, init, true);
  if (!response.ok) {
    throw await readError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function publicRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await readError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function loadCurrentUser(): Promise<CurrentUserResponse> {
  return apiRequest<CurrentUserResponse>("/auth/me");
}

export async function selectOrganization(organizationId: string): Promise<CurrentUserResponse> {
  const selected = await apiRequest<SelectOrganizationResponse>("/auth/select-organization", {
    method: "POST",
    body: JSON.stringify({ organizationId }),
  });
  setAccessToken(selected.accessToken, selected.accessTokenExpiresAt);
  return loadCurrentUser();
}

export async function inspectActivation(token: string): Promise<AccountTokenInspectionResponse> {
  return publicRequest<AccountTokenInspectionResponse>("/auth/activation/inspect", { token });
}

export async function completeActivation(token: string, password?: string): Promise<void> {
  await publicRequest<void>("/auth/activation/complete", { token, ...(password ? { password } : {}) });
}

export async function requestRecovery(email: string): Promise<void> {
  await publicRequest<void>("/auth/recovery", { email });
}

export async function completeRecovery(token: string, password: string): Promise<void> {
  await publicRequest<void>("/auth/recovery/complete", { token, password });
}

export async function listOrganizationUsers(limit = 20, offset = 0): Promise<PageResponse<OrganizationUserItem>> {
  return apiRequest<PageResponse<OrganizationUserItem>>(`/organizations/users?limit=${limit}&offset=${offset}`);
}

export async function inviteUser(email: string, displayName: string): Promise<void> {
  await apiRequest<void>("/organizations/users/invitations", {
    method: "POST",
    body: JSON.stringify({ email, displayName }),
  });
}

export async function updateMembershipStatus(membershipId: string, status: "ACTIVE" | "SUSPENDED"): Promise<OrganizationMembershipStatusResponse> {
  return apiRequest<OrganizationMembershipStatusResponse>(`/organizations/users/${encodeURIComponent(membershipId)}`, {
    method: "PATCH", body: JSON.stringify({ status }),
  });
}

export async function listPlatformOrganizations(input: { limit?: number; offset?: number; search?: string; status?: OrganizationStatus } = {}): Promise<PageResponse<PlatformOrganizationItem>> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 20), offset: String(input.offset ?? 0) });
  if (input.search) query.set("search", input.search);
  if (input.status) query.set("status", input.status);
  return apiRequest<PageResponse<PlatformOrganizationItem>>(`/platform/organizations?${query.toString()}`);
}

export async function updatePlatformOrganization(organizationId: string, input: { name?: string; status?: OrganizationStatus }): Promise<PlatformOrganizationItem> {
  return apiRequest<PlatformOrganizationItem>(`/platform/organizations/${encodeURIComponent(organizationId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function listTenantCompanies(input: { limit?: number; offset?: number; search?: string; status?: RecordStatus } = {}): Promise<PageResponse<CompanyItem>> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 20), offset: String(input.offset ?? 0) });
  if (input.search) query.set("search", input.search);
  if (input.status) query.set("status", input.status);
  return apiRequest<PageResponse<CompanyItem>>(`/organizations/companies?${query.toString()}`);
}

export async function createTenantCompany(input: { legalName: string; tradeName?: string | null; nit?: string | null; contact?: string | null; address?: string | null }): Promise<CompanyItem> {
  return apiRequest<CompanyItem>("/organizations/companies", { method: "POST", body: JSON.stringify(input) });
}

export async function updateTenantCompany(companyId: string, input: { legalName?: string; tradeName?: string | null; nit?: string | null; contact?: string | null; address?: string | null; status?: RecordStatus }): Promise<CompanyItem> {
  return apiRequest<CompanyItem>(`/organizations/companies/${encodeURIComponent(companyId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deactivateTenantCompany(companyId: string): Promise<void> {
  await apiRequest<void>(`/organizations/companies/${encodeURIComponent(companyId)}`, { method: "DELETE" });
}

export async function listTenantBranches(input: { companyId?: string; limit?: number; offset?: number; search?: string; status?: RecordStatus } = {}): Promise<PageResponse<BranchItem>> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 20), offset: String(input.offset ?? 0) });
  if (input.companyId) query.set("companyId", input.companyId);
  if (input.search) query.set("search", input.search);
  if (input.status) query.set("status", input.status);
  return apiRequest<PageResponse<BranchItem>>(`/organizations/branches?${query.toString()}`);
}

export async function createTenantBranch(companyId: string, input: { code: string; name: string; address?: string | null; contact?: string | null }): Promise<BranchItem> {
  return apiRequest<BranchItem>(`/organizations/companies/${encodeURIComponent(companyId)}/branches`, { method: "POST", body: JSON.stringify(input) });
}

export async function updateTenantBranch(branchId: string, input: { code?: string; name?: string; address?: string | null; contact?: string | null; status?: RecordStatus }): Promise<BranchItem> {
  return apiRequest<BranchItem>(`/organizations/branches/${encodeURIComponent(branchId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deactivateTenantBranch(branchId: string): Promise<void> {
  await apiRequest<void>(`/organizations/branches/${encodeURIComponent(branchId)}`, { method: "DELETE" });
}

export async function listCatalogs(input: { limit?: number; offset?: number; search?: string; status?: RecordStatus; scope?: CatalogScope } = {}): Promise<PageResponse<Catalog>> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 20), offset: String(input.offset ?? 0) });
  if (input.search) query.set("search", input.search);
  if (input.status) query.set("status", input.status);
  if (input.scope) query.set("scope", input.scope);
  return apiRequest<PageResponse<Catalog>>(`/catalogs?${query.toString()}`);
}

export async function listCatalogScopeOptions(limit = 100, offset = 0): Promise<CatalogScopeOptions> {
  return apiRequest<CatalogScopeOptions>(`/catalogs/scope-options?limit=${limit}&offset=${offset}`);
}

export async function createCatalog(input: { code: string; name: string; description?: string | null; scope: Exclude<CatalogScope, "GLOBAL">; companyId?: string }): Promise<Catalog> {
  return apiRequest<Catalog>("/catalogs", { method: "POST", body: JSON.stringify(input) });
}

export async function updateCatalog(catalogId: string, input: { name?: string; description?: string | null; status?: RecordStatus }): Promise<Catalog> {
  return apiRequest<Catalog>(`/catalogs/${encodeURIComponent(catalogId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deactivateCatalog(catalogId: string): Promise<void> {
  await apiRequest<void>(`/catalogs/${encodeURIComponent(catalogId)}`, { method: "DELETE" });
}

export async function listCatalogItems(catalogId: string, input: { limit?: number; offset?: number; search?: string; status?: RecordStatus } = {}): Promise<PageResponse<CatalogItem>> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 20), offset: String(input.offset ?? 0) });
  if (input.search) query.set("search", input.search);
  if (input.status) query.set("status", input.status);
  return apiRequest<PageResponse<CatalogItem>>(`/catalogs/${encodeURIComponent(catalogId)}/items?${query.toString()}`);
}

export async function createCatalogItem(catalogId: string, input: { code: string; name: string; description?: string | null }): Promise<CatalogItem> {
  return apiRequest<CatalogItem>(`/catalogs/${encodeURIComponent(catalogId)}/items`, { method: "POST", body: JSON.stringify(input) });
}

export async function updateCatalogItem(catalogId: string, itemId: string, input: { code?: string; name?: string; description?: string | null; status?: RecordStatus }): Promise<CatalogItem> {
  return apiRequest<CatalogItem>(`/catalogs/${encodeURIComponent(catalogId)}/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function deactivateCatalogItem(catalogId: string, itemId: string): Promise<void> {
  await apiRequest<void>(`/catalogs/${encodeURIComponent(catalogId)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}

export async function listRolePermissionCatalog(): Promise<PermissionCatalogItem[]> {
  return apiRequest<PermissionCatalogItem[]>("/organizations/roles/permissions");
}

export async function listOrganizationRoles(limit = 20, offset = 0): Promise<PageResponse<OrganizationRoleItem>> {
  return apiRequest<PageResponse<OrganizationRoleItem>>(`/organizations/roles?limit=${limit}&offset=${offset}`);
}

export async function createOrganizationRole(input: { name: string; permissionCodes: string[] }): Promise<OrganizationRoleMutationResult> {
  return apiRequest<OrganizationRoleMutationResult>("/organizations/roles", { method: "POST", body: JSON.stringify(input) });
}

export async function updateOrganizationRole(roleId: string, input: { name?: string; status?: RoleStatus; permissionCodes?: string[] }): Promise<OrganizationRoleMutationResult> {
  return apiRequest<OrganizationRoleMutationResult>(`/organizations/roles/${encodeURIComponent(roleId)}`, { method: "PATCH", body: JSON.stringify(input) });
}

export async function listRoleAssignments(limit = 20, offset = 0): Promise<PageResponse<RoleAssignmentItem>> {
  return apiRequest<PageResponse<RoleAssignmentItem>>(`/organizations/role-assignments?limit=${limit}&offset=${offset}`);
}

export async function listRoleAssignmentOptions(kind: "memberships" | "companies" | "branches", input: { limit?: number; offset?: number; companyId?: string } = {}): Promise<PageResponse<RoleAssignmentOption>> {
  const query = new URLSearchParams({ kind, limit: String(input.limit ?? 100), offset: String(input.offset ?? 0) });
  if (input.companyId) query.set("companyId", input.companyId);
  return apiRequest<PageResponse<RoleAssignmentOption>>(`/organizations/role-assignment-options?${query.toString()}`);
}

export async function createRoleAssignment(input: { membershipId: string; roleId: string; scopeType: RoleScopeType; companyId?: string; branchId?: string }): Promise<RoleAssignmentCreated> {
  return apiRequest<RoleAssignmentCreated>("/organizations/role-assignments", { method: "POST", body: JSON.stringify(input) });
}

export async function deleteRoleAssignment(assignmentId: string): Promise<void> {
  await apiRequest<void>(`/organizations/role-assignments/${encodeURIComponent(assignmentId)}`, { method: "DELETE" });
}

export async function createOrganization(input: {
  organizationName: string;
  adminEmail: string;
  adminDisplayName: string;
}): Promise<CreatedOrganizationResponse> {
  return apiRequest<CreatedOrganizationResponse>("/platform/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
