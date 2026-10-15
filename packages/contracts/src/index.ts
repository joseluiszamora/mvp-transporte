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

export interface CreatedOrganizationResponse {
  id: string;
  name: string;
  adminInvitationQueued: true;
}
