export interface HealthResponse {
  status: "ok";
  service: "api";
  timestamp: string;
}

export interface ReadinessResponse {
  status: "ready" | "not_ready";
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export interface OrganizationMembershipOption {
  id: string;
  membershipId: string;
  name: string;
}

export interface AuthUserSummary {
  id: string;
  displayName: string;
  email: string;
  platformAdmin: boolean;
}

export interface AuthCredentialsResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  csrfToken: string;
  user: AuthUserSummary;
  organizations: OrganizationMembershipOption[];
  selectedOrganizationId: string | null;
}

export interface CurrentUserResponse extends Omit<AuthUserSummary, "displayName" | "platformAdmin"> {
  displayName: string;
  platformAdmin: boolean;
  selectedOrganizationId: string | null;
  permissions: string[];
  organizations: OrganizationMembershipOption[];
}

export interface SelectOrganizationResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  selectedOrganizationId: string;
}

export interface AccountTokenInspectionResponse {
  purpose: "PLATFORM_ACTIVATION" | "MEMBERSHIP_INVITATION" | "PASSWORD_RECOVERY";
  displayName: string;
  organizationName: string | null;
  requiresPassword: boolean;
}

export interface OrganizationUserItem {
  id: string;
  email: string;
  displayName: string;
  accountStatus: "PENDING_ACTIVATION" | "ACTIVE" | "BLOCKED";
  membershipId: string;
  membershipStatus: "INVITED" | "ACTIVE" | "SUSPENDED";
  createdAt: string;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type AuditActorType = "USER" | "SYSTEM";

export interface AuditEventSummary {
  id: string;
  companyId: string | null;
  branchId: string | null;
  actorId: string | null;
  actorType: AuditActorType;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string;
  createdAt: string;
}

export interface AuditEventDetails extends AuditEventSummary {
  diff: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null } | null;
}

export interface InstallationSmtpSettings {
  source: "DATABASE" | "ENVIRONMENT" | "UNCONFIGURED";
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  fromAddress: string;
  username: string;
  passwordConfigured: boolean;
  updatedAt: string | null;
}

export interface NotificationAccessResponse {
  canReadHistory: boolean;
}

export interface EmailTemplateSummary {
  code: string;
  subject: string;
  status: RecordStatus;
  updatedAt: string;
}

export interface EmailDeliverySummary {
  id: string;
  templateCode: string;
  attempt: number;
  outcome: "SENT" | "FAILED";
  errorCode: string | null;
  createdAt: string;
}

export type RoleStatus = "ACTIVE" | "INACTIVE";
export type RoleScopeType = "ORGANIZATION" | "COMPANY" | "BRANCH";

export interface PermissionCatalogItem {
  code: string;
  description: string;
}

export interface OrganizationRoleItem {
  id: string;
  code: string;
  name: string;
  status: RoleStatus;
  permissions: string[];
  assignmentCount: number;
  createdAt: string;
}

export interface OrganizationRoleMutationResult {
  id: string;
  code: string;
  name: string;
  status: RoleStatus;
  permissions: string[];
}

export interface RoleAssignmentItem {
  id: string;
  membershipId: string;
  userEmail: string;
  userDisplayName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleStatus: RoleStatus;
  scopeType: RoleScopeType;
  companyId: string | null;
  companyName: string | null;
  branchId: string | null;
  branchName: string | null;
  createdAt: string;
}

export interface RoleAssignmentOption {
  id: string;
  name: string;
  detail: string;
}

export interface RoleAssignmentCreated {
  id: string;
  membershipId: string;
  roleId: string;
  scopeType: RoleScopeType;
  companyId: string | null;
  branchId: string | null;
}

export interface CreatedOrganizationResponse {
  id: string;
  name: string;
  adminInvitationQueued: true;
}

export type OrganizationStatus = "ACTIVE" | "SUSPENDED";
export type RecordStatus = "ACTIVE" | "INACTIVE";
export type CatalogScope = "GLOBAL" | "ORGANIZATION" | "COMPANY";

export interface CatalogItem {
  id: string;
  catalogId: string;
  code: string;
  name: string;
  description: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Catalog {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scope: CatalogScope;
  organizationId: string | null;
  companyId: string | null;
  companyName: string | null;
  status: RecordStatus;
  protected: boolean;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogScopeOptions {
  organization: boolean;
  companies: Array<{ id: string; legalName: string }>;
  totalCompanies: number;
  limit: number;
  offset: number;
}

export interface PlatformOrganizationItem {
  id: string;
  name: string;
  status: OrganizationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyItem {
  id: string;
  legalName: string;
  tradeName: string | null;
  nit: string | null;
  contact: string | null;
  address: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BranchItem {
  id: string;
  companyId: string;
  companyName: string;
  code: string;
  name: string;
  address: string | null;
  contact: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export type SettingScopeType = "INSTALLATION" | "ORGANIZATION" | "COMPANY" | "BRANCH";
export type SettingKey = "locale" | "currency" | "timeZone" | "identity.name" | "identity.logoUrl" | "identity.brandColor";

export interface SettingItem {
  id: string;
  scopeType: SettingScopeType;
  organizationId: string | null;
  companyId: string | null;
  branchId: string | null;
  key: SettingKey;
  valueType: "STRING";
  value: string;
  updatedAt: string;
}

export interface EffectiveSettingItem {
  key: SettingKey;
  valueType: "STRING";
  value: string | null;
  sourceScopeType: SettingScopeType | null;
  sourceOrganizationId: string | null;
  sourceCompanyId: string | null;
  sourceBranchId: string | null;
  updatedAt: string | null;
}

export interface EffectiveSettingsResponse {
  target: { scopeType: Exclude<SettingScopeType, "INSTALLATION">; organizationId: string; companyId: string | null; branchId: string | null };
  items: EffectiveSettingItem[];
}

export interface SettingScopeOptions {
  organization: { canRead: boolean; canUpdate: boolean };
  companies: Array<{
    id: string;
    legalName: string;
    canRead: boolean;
    canUpdate: boolean;
    branches: Array<{ id: string; code: string; name: string; canRead: boolean; canUpdate: boolean }>;
  }>;
  totalCompanies: number;
  limit: number;
  offset: number;
}

export interface BusinessHourInterval {
  start: string;
  end: string;
}

export interface BusinessHourDay {
  weekday: number;
  intervals: BusinessHourInterval[];
  sourceScopeType?: "COMPANY" | "BRANCH" | null;
  updatedAt?: string | null;
}

export interface NumberSequence {
  id: string;
  scopeType: "ORGANIZATION" | "COMPANY" | "BRANCH";
  organizationId: string;
  companyId: string | null;
  branchId: string | null;
  documentType: string;
  period: string;
  prefix: string;
  padding: number;
  nextValue: string;
  updatedAt: string;
}

export type FileResourceType = "COMPANY_ATTACHMENT" | "BRANCH_ATTACHMENT" | "EMPLOYEE_PHOTO" | "EMPLOYEE_DOCUMENT";

export interface FileScopeOption {
  resourceType: FileResourceType;
  resourceId: string;
  companyId: string;
  branchId: string | null;
  label: string;
  canRead: boolean;
  canDownload: boolean;
  canUpload: boolean;
  canDelete: boolean;
}

export interface StoredFile {
  id: string;
  resourceType: FileResourceType;
  resourceId: string;
  originalName: string;
  detectedMime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  createdAt: string;
  downloadUrl: string;
}

export interface EmployeeListItem {
  id: string;
  companyId: string;
  internalCode: string;
  firstNames: string;
  lastNames: string;
  position: { id: string; code: string; name: string } | null;
  hireDate: string;
  status: RecordStatus;
  branches: Array<{ id: string; code: string; name: string }>;
}

export interface EmployeeDetails extends EmployeeListItem {
  canReadPersonalData: boolean;
  canReadLinkedUser: boolean;
  canManageUserLink: boolean;
  canUpdate: boolean;
  canUpdateSharedFields: boolean;
  canDeactivate: boolean;
  canManagePersonalData: boolean;
  canReadPhoto: boolean;
  canManagePhoto: boolean;
  canDeletePhoto: boolean;
  canReadDocuments: boolean;
  canDownloadDocuments: boolean;
  canManageDocuments: boolean;
  canDeleteDocuments: boolean;
  personalData?: {
    documentNumber: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  linkedUser?: { id: string; displayName: string; email: string; membershipStatus: "INVITED" | "ACTIVE" | "SUSPENDED" } | null;
  photoFileId?: string | null;
}

export interface EmployeePage extends PageResponse<EmployeeListItem> {}

export interface EmployeeScopeOptions {
  companies: Array<{
    id: string;
    legalName: string;
    canCreate: boolean;
    canUpdate: boolean;
    branches: Array<{ id: string; code: string; name: string; canCreate: boolean; canUpdate: boolean }>;
  }>;
  positions: Array<{ id: string; code: string; name: string }>;
  documentTypes: Array<{ id: string; code: string; name: string }>;
  users: Array<{ id: string; displayName: string; email: string; membershipStatus: "INVITED" | "ACTIVE" | "SUSPENDED" }>;
}

export interface EmployeeDocumentItem {
  id: string;
  fileId: string;
  type: { id: string; code: string; name: string };
  originalName: string;
  detectedMime: StoredFile["detectedMime"];
  bytes: number;
  issuedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface EmployeeDocumentsResponse {
  items: EmployeeDocumentItem[];
  canDownload: boolean;
}

export interface OrganizationMembershipStatusResponse {
  membershipId: string;
  membershipStatus: "ACTIVE" | "SUSPENDED";
}
