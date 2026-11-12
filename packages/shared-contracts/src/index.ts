export type RecordStatus = "ACTIVE" | "INACTIVE";
export type DocumentOwnerType = "VEHICLE" | "EMPLOYEE";
export type DocumentStatus = "CURRENT" | "SUPERSEDED";
export type MaintenanceType = "PREVENTIVE" | "CORRECTIVE";
export type MaintenanceRecordStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type FuelType = "GASOLINE" | "GNV";
export type FuelUnit = "LITER" | "CUBIC_METER" | "KILOGRAM";

export interface PageResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface VehicleItem {
  id: string;
  organizationId: string;
  companyId: string;
  branchId: string | null;
  plate: string;
  vehicleType: string;
  make: string;
  model: string;
  year: number | null;
  capacityKg: number;
  odometerKm: number | null;
  maintenanceBlocked: boolean;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleInput {
  companyId: string;
  branchId?: string | null;
  plate: string;
  vehicleType: string;
  make: string;
  model: string;
  year?: number | null;
  capacityKg: number;
  odometerKm?: number | null;
}

export interface OperationalProfileItem {
  id: string;
  organizationId: string;
  companyId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OperationalProfileInput {
  companyId: string;
  employeeId: string;
}

export interface ResourceDocumentItem {
  id: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  companyId: string;
  branchId: string | null;
  documentType: string;
  fileId: string;
  originalName: string;
  detectedMime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  issuedAt: string | null;
  expiresAt: string | null;
  status: DocumentStatus;
  supersedesId: string | null;
  renewedById: string | null;
  createdAt: string;
  canDownload: boolean;
}

export interface MaintenancePlanItem {
  id: string;
  vehicleId: string;
  name: string;
  intervalKm: number | null;
  intervalDays: number | null;
  windowDays: number;
  nextDueKm: number | null;
  nextDueAt: string | null;
  windowStartAt: string | null;
  windowEndAt: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRecordItem {
  id: string;
  vehicleId: string;
  planId: string | null;
  type: MaintenanceType;
  status: MaintenanceRecordStatus;
  description: string;
  provider: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  outOfService: boolean;
  odometerKm: number | null;
  costAmount: number | null;
  currencyCode: string;
  createdAt: string;
}

export interface VehicleFuelTankItem {
  id: string;
  vehicleId: string;
  name: string;
  fuelType: FuelType;
  unit: FuelUnit;
  capacity: number;
  status: RecordStatus;
  createdAt: string;
}

export interface FuelRecordItem {
  id: string;
  vehicleId: string;
  tankId: string;
  tankName: string;
  fuelType: FuelType;
  unit: FuelUnit;
  quantity: number;
  costAmount: number;
  currencyCode: string;
  odometerKm: number;
  occurredAt: string;
  provider: string | null;
}

export interface FuelSummaryItem {
  fuelType: FuelType;
  unit: FuelUnit;
  quantity: number;
  costAmount: number;
  currencyCode: string;
  records: number;
}

export interface IntegratedFileItem {
  id: string;
  integrationCode: string;
  resourceType: string;
  resourceId: string;
  originalName: string;
  detectedMime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  createdAt: string;
  canDownload: boolean;
}

export interface EmployeeOption {
  id: string;
  companyId: string;
  internalCode: string;
  firstNames: string;
  lastNames: string;
  status: RecordStatus;
}

export interface CompanyOption {
  id: string;
  legalName: string;
  tradeName: string | null;
  status: RecordStatus;
}

export interface BranchOption {
  id: string;
  companyId: string;
  code: string;
  name: string;
  status: RecordStatus;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
