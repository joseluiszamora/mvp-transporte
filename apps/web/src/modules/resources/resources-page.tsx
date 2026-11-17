import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Chip, FormControl, InputLabel, LinearProgress, MenuItem,
  Paper, Select, Stack, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tabs, TextField, Typography,
} from "@mui/material";
import DescriptionRounded from "@mui/icons-material/DescriptionRounded";
import BuildRounded from "@mui/icons-material/BuildRounded";
import LocalGasStationRounded from "@mui/icons-material/LocalGasStationRounded";
import { useSession } from "../../session.tsx";
import { EmptyState } from "../../components/empty-state.tsx";
import { formatDate, formatNumber } from "../../utils/format.ts";
import type {
  BranchOption, DocumentOwnerType, EmployeeOption, FuelRecordItem, FuelSummaryItem, FuelType,
  FuelUnit, MaintenancePlanItem, MaintenanceRecordItem, MaintenanceUpcomingItem, PageResponse, ResourceDocumentItem,
  VehicleFuelTankItem, VehicleItem,
} from "@mvp-transporte/shared-contracts";

type ResourceTab = "documents" | "maintenance" | "fuel";
type ApiList<T> = { items: T[] };
type DocumentValidityFilter = "ALL" | "VALID" | "EXPIRING_SOON" | "EXPIRED" | "NO_EXPIRY" | "SUPERSEDED";
const fuelUnitLabels: Record<FuelUnit, string> = { LITER: "L", CUBIC_METER: "m³", KILOGRAM: "kg" };
const maintenanceStatusLabels: Record<MaintenanceRecordItem["status"], string> = {
  SCHEDULED: "Programado", IN_PROGRESS: "En curso", COMPLETED: "Completado", CANCELLED: "Cancelado",
};

function documentValidity(document: ResourceDocumentItem): { key: Exclude<DocumentValidityFilter, "ALL">; label: string; color: "default" | "success" | "warning" | "error" } {
  if (document.status === "SUPERSEDED") return { key: "SUPERSEDED", label: "Renovado", color: "default" };
  if (!document.expiresAt) return { key: "NO_EXPIRY", label: "Sin vencimiento", color: "default" };
  const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const now = new Date(); const upcoming = new Date(now); upcoming.setDate(upcoming.getDate() + 30);
  const today = dateKey(now); const soon = dateKey(upcoming);
  if (document.expiresAt < today) return { key: "EXPIRED", label: "Vencido", color: "error" };
  if (document.expiresAt <= soon) return { key: "EXPIRING_SOON", label: "Por vencer", color: "warning" };
  return { key: "VALID", label: "Vigente", color: "success" };
}

function localDateTimeValue(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function localDayStartIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

function localDayAfterStartIso(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function ResourcesPage({ companyId, branchId, branches, branchesError, onBranchChange, onNotice }: {
  companyId: string; branchId: string; branches: BranchOption[]; branchesError: string | undefined;
  onBranchChange: (branchId: string) => void; onNotice: (message: string) => void;
}) {
  const [tab, setTab] = useState<ResourceTab>("documents");
  const [vehicleId, setVehicleId] = useState("");
  const { apiRequest } = useSession();
  const vehicles = useInfiniteQuery({
    queryKey: ["resource-vehicles", companyId, branchId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => (await (await apiRequest(`/vehicles?companyId=${encodeURIComponent(companyId)}${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}&limit=100&offset=${pageParam}`)).json() as PageResponse<VehicleItem>),
    getNextPageParam: (lastPage) => lastPage.offset + lastPage.limit < lastPage.total ? lastPage.offset + lastPage.limit : undefined,
  });
  const vehicleItems = useMemo(() => vehicles.data?.pages.flatMap((page) => page.items) ?? [], [vehicles.data]);
  useEffect(() => {
    if (!vehicleId && vehicleItems[0]) setVehicleId(vehicleItems[0].id);
    if (vehicleId && !vehicleItems.some((vehicle) => vehicle.id === vehicleId)) setVehicleId(vehicleItems[0]?.id ?? "");
  }, [vehicleId, vehicleItems]);

  return <Box sx={{ p: { xs: 2, md: 3 } }}>
    <Box className="page-heading">
      <Box><Typography variant="h5">Documentos, mantenimiento y combustible</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Conserva el historial operativo y los archivos privados de cada recurso.</Typography></Box>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 190 } }}><InputLabel id="resource-branch-label">Sucursal</InputLabel><Select labelId="resource-branch-label" label="Sucursal" value={branchId} onChange={(event) => onBranchChange(event.target.value)}><MenuItem value="">Toda la empresa</MenuItem>{branches.map((branch) => <MenuItem key={branch.id} value={branch.id}>{branch.code} · {branch.name}</MenuItem>)}</Select></FormControl>
        {tab !== "documents" && <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 280 } }}>
          <InputLabel id="resource-vehicle-label">Vehículo</InputLabel>
          <Select labelId="resource-vehicle-label" label="Vehículo" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
            {vehicleItems.map((vehicle) => <MenuItem key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}</MenuItem>)}
          </Select>
        </FormControl>}
      </Stack>
    </Box>
    {(vehicles.isError || branchesError) && <Alert severity="error" sx={{ mb: 2 }}>No se pudieron cargar los recursos: {vehicles.error?.message ?? branchesError}</Alert>}
    {vehicles.isLoading && <LinearProgress sx={{ mb: 2 }} />}
    {tab !== "documents" && vehicles.hasNextPage && <Button size="small" sx={{ mb: 1 }} onClick={() => void vehicles.fetchNextPage()} disabled={vehicles.isFetchingNextPage}>{vehicles.isFetchingNextPage ? "Cargando vehículos…" : "Cargar más vehículos"}</Button>}
    <Tabs value={tab} onChange={(_, value: ResourceTab) => setTab(value)} sx={{ borderBottom: 1, borderColor: "divider", mb: 2.5 }} variant="scrollable">
      <Tab value="documents" icon={<DescriptionRounded />} iconPosition="start" label="Documentos" />
      <Tab value="maintenance" icon={<BuildRounded />} iconPosition="start" label="Mantenimiento" />
      <Tab value="fuel" icon={<LocalGasStationRounded />} iconPosition="start" label="Combustible" />
    </Tabs>
    {tab === "documents" && <DocumentsPanel companyId={companyId} vehicles={vehicleItems} onNotice={onNotice} />}
    {tab === "maintenance" && (vehicleId ? <MaintenancePanel key={`${companyId}:${branchId}:${vehicleId}`} companyId={companyId} branchId={branchId} vehicleId={vehicleId} onNotice={onNotice} /> : <EmptyState title="Selecciona un vehículo" detail="Registra vehículos para administrar su mantenimiento." />)}
    {tab === "fuel" && (vehicleId ? <FuelPanel key={`${companyId}:${branchId}:${vehicleId}`} companyId={companyId} branchId={branchId} vehicleId={vehicleId} onNotice={onNotice} /> : <EmptyState title="Selecciona un vehículo" detail="Registra vehículos para configurar tanques y cargas." />)}
  </Box>;
}

function DocumentsPanel({ companyId, vehicles: vehicleItems, onNotice }: { companyId: string; vehicles: VehicleItem[]; onNotice: (message: string) => void }) {
  const { apiRequest } = useSession();
  const client = useQueryClient();
  const [ownerType, setOwnerType] = useState<DocumentOwnerType>("VEHICLE");
  const [ownerId, setOwnerId] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [documentTypeFilter, setDocumentTypeFilter] = useState("");
  const [validityFilter, setValidityFilter] = useState<DocumentValidityFilter>("ALL");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [supersedesId, setSupersedesId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const employees = useInfiniteQuery({
    queryKey: ["resource-employees", companyId], initialPageParam: 0, enabled: ownerType === "EMPLOYEE",
    queryFn: async ({ pageParam }) => (await (await apiRequest(`/operational-staff/employees?companyId=${encodeURIComponent(companyId)}&limit=100&offset=${pageParam}`)).json() as PageResponse<EmployeeOption>),
    getNextPageParam: (lastPage) => lastPage.offset + lastPage.limit < lastPage.total ? lastPage.offset + lastPage.limit : undefined,
  });
  const employeeItems = useMemo(() => employees.data?.pages.flatMap((page) => page.items) ?? [], [employees.data]);
  const owners = ownerType === "VEHICLE" ? vehicleItems : employeeItems;
  useEffect(() => { if (!owners.some((owner) => owner.id === ownerId)) setOwnerId(owners[0]?.id ?? ""); }, [ownerId, owners]);
  const documents = useQuery({
    queryKey: ["resource-documents", companyId, ownerType, ownerId], enabled: Boolean(ownerId),
    queryFn: async () => (await (await apiRequest(`/documents/${ownerType}/${ownerId}?companyId=${encodeURIComponent(companyId)}`)).json() as ApiList<ResourceDocumentItem>).items,
  });
  const filteredDocuments = useMemo(() => (documents.data ?? []).filter((item) => {
    const matchesType = item.documentType.toLocaleLowerCase("es-BO").includes(documentTypeFilter.trim().toLocaleLowerCase("es-BO"));
    const matchesValidity = validityFilter === "ALL" || documentValidity(item).key === validityFilter;
    return matchesType && matchesValidity;
  }), [documents.data, documentTypeFilter, validityFilter]);
  const renewalTargets = (documents.data ?? []).filter((item) => item.status === "CURRENT" && documentType.trim() &&
    item.documentType.trim().toLocaleLowerCase("es-BO") === documentType.trim().toLocaleLowerCase("es-BO"));
  const upload = useMutation({
    mutationFn: async () => {
      if (!ownerId || !file || !documentType.trim()) throw new Error("Completa el tipo y selecciona un archivo.");
      const params = new URLSearchParams({ companyId, documentType: documentType.trim() });
      if (issuedAt) params.set("issuedAt", issuedAt);
      if (expiresAt) params.set("expiresAt", expiresAt);
      if (supersedesId) params.set("supersedesId", supersedesId);
      const form = new FormData(); form.append("file", file);
      const response = await apiRequest(`/documents/${ownerType}/${ownerId}/upload?${params.toString()}`, { method: "POST", body: form });
      return response.json();
    },
    onSuccess: () => { setFile(null); setSupersedesId(""); void client.invalidateQueries({ queryKey: ["resource-documents", companyId, ownerType, ownerId] }); },
    onError: (error: Error) => onNotice(error.message),
  });
  const download = async (document: ResourceDocumentItem) => {
    try {
      const response = await apiRequest(`/documents/${document.id}/content`);
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = window.document.createElement("a");
      anchor.href = url; anchor.download = document.originalName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { onNotice(error instanceof Error ? error.message : "No se pudo descargar el archivo."); }
  };

  return <Stack spacing={2.5}>
    <Paper variant="outlined" sx={{ p: 2, bgcolor: "#f8faf9" }}><Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <FormControl size="small" sx={{ minWidth: 170 }}><InputLabel id="document-owner-type">Recurso</InputLabel><Select labelId="document-owner-type" label="Recurso" value={ownerType} onChange={(event) => { setOwnerType(event.target.value as DocumentOwnerType); setOwnerId(""); }}><MenuItem value="VEHICLE">Vehículo</MenuItem><MenuItem value="EMPLOYEE">Empleado</MenuItem></Select></FormControl>
        <FormControl size="small" sx={{ flex: 1, minWidth: 240 }}><InputLabel id="document-owner">{ownerType === "VEHICLE" ? "Vehículo" : "Empleado"}</InputLabel><Select labelId="document-owner" label={ownerType === "VEHICLE" ? "Vehículo" : "Empleado"} value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
          {owners.map((owner) => <MenuItem key={owner.id} value={owner.id}>{ownerType === "VEHICLE" ? `${(owner as VehicleItem).plate} · ${(owner as VehicleItem).make} ${(owner as VehicleItem).model}` : `${(owner as EmployeeOption).internalCode} · ${(owner as EmployeeOption).firstNames} ${(owner as EmployeeOption).lastNames}`}</MenuItem>)}
        </Select></FormControl>
      </Stack>
      <Typography sx={{ fontWeight: 700 }}>Agregar documento privado</Typography>
      <Box className="vehicle-form-grid">
        <TextField size="small" label="Tipo de documento" value={documentType} onChange={(event) => { setDocumentType(event.target.value); setSupersedesId(""); }} slotProps={{ htmlInput: { maxLength: 60 } }} />
        <TextField size="small" label="Fecha de emisión" type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField size="small" label="Fecha de vencimiento" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <FormControl size="small"><InputLabel id="renew-document">Renueva documento</InputLabel><Select labelId="renew-document" label="Renueva documento" value={supersedesId} onChange={(event) => setSupersedesId(event.target.value)}><MenuItem value="">Documento nuevo</MenuItem>{renewalTargets.map((item) => <MenuItem key={item.id} value={item.id}>{item.documentType} · {item.originalName}</MenuItem>)}</Select></FormControl>
        <Button variant="outlined" component="label" sx={{ justifyContent: "flex-start", textTransform: "none" }}>{file?.name ?? "Elegir PDF o imagen"}<input hidden type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Button>
        <Button variant="contained" disabled={!ownerId || !file || !documentType.trim() || upload.isPending} onClick={() => upload.mutate()}>{upload.isPending ? "Cargando…" : "Guardar documento"}</Button>
      </Box>
      {employees.isError && <Alert severity="error">No se pudo cargar el personal de mvp-base: {employees.error.message}</Alert>}
      {ownerType === "EMPLOYEE" && employees.isLoading && <LinearProgress />}
      {ownerType === "EMPLOYEE" && employees.hasNextPage && <Button size="small" onClick={() => void employees.fetchNextPage()} disabled={employees.isFetchingNextPage}>{employees.isFetchingNextPage ? "Cargando personal…" : "Cargar más empleados"}</Button>}
      <Typography variant="caption" color="text.secondary">PDF, JPG, PNG o WEBP · máximo 10 MB. Los archivos se guardan en el servicio privado de mvp-base.</Typography>
    </Stack></Paper>
    {documents.isError && <Alert severity="error">No se pudieron cargar los documentos: {documents.error.message}</Alert>}
    <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1.5}><Typography sx={{ fontWeight: 700 }}>Filtrar documentos</Typography><Box className="vehicle-form-grid"><TextField size="small" label="Tipo de documento" value={documentTypeFilter} onChange={(event) => setDocumentTypeFilter(event.target.value)} /><FormControl size="small"><InputLabel id="document-validity-filter">Vigencia</InputLabel><Select labelId="document-validity-filter" label="Vigencia" value={validityFilter} onChange={(event) => setValidityFilter(event.target.value as DocumentValidityFilter)}><MenuItem value="ALL">Todos</MenuItem><MenuItem value="VALID">Vigentes</MenuItem><MenuItem value="EXPIRING_SOON">Por vencer (30 días)</MenuItem><MenuItem value="EXPIRED">Vencidos</MenuItem><MenuItem value="NO_EXPIRY">Sin vencimiento</MenuItem><MenuItem value="SUPERSEDED">Renovados</MenuItem></Select></FormControl><Button size="small" disabled={!documentTypeFilter && validityFilter === "ALL"} onClick={() => { setDocumentTypeFilter(""); setValidityFilter("ALL"); }}>Limpiar filtros</Button></Box></Stack></Paper>
    <TableContainer component={Paper} variant="outlined" className="table-wrap">{documents.isLoading ? <LinearProgress /> : <Table><TableHead><TableRow><TableCell>Documento</TableCell><TableCell>Vencimiento</TableCell><TableCell>Estado</TableCell><TableCell>Archivo</TableCell><TableCell align="right">Acción</TableCell></TableRow></TableHead><TableBody>
      {filteredDocuments.map((item) => { const validity = documentValidity(item); return <TableRow key={item.id} hover><TableCell><Typography sx={{ fontWeight: 650 }}>{item.documentType}</Typography><Typography variant="caption" color="text.secondary">{item.issuedAt ? `Emitido ${formatDate(item.issuedAt)}` : "Sin fecha de emisión"}</Typography></TableCell><TableCell>{item.expiresAt ? formatDate(item.expiresAt) : "Sin vencimiento"}</TableCell><TableCell><Chip size="small" color={validity.color} label={validity.label} /></TableCell><TableCell>{item.originalName}</TableCell><TableCell align="right"><Button size="small" disabled={!item.canDownload} onClick={() => void download(item)}>Descargar</Button></TableCell></TableRow>; })}
      {!documents.isLoading && !documents.isError && !filteredDocuments.length && <TableRow><TableCell colSpan={5}><EmptyState title={documents.data?.length ? "Sin coincidencias" : "Sin documentos"} detail={documents.data?.length ? "Cambia los filtros para ver otros documentos." : "Carga un documento para este recurso. Las renovaciones conservan el archivo anterior."} /></TableCell></TableRow>}
    </TableBody></Table>}</TableContainer>
  </Stack>;
}

function MaintenancePanel({ companyId, branchId, vehicleId, onNotice }: { companyId: string; branchId: string; vehicleId: string; onNotice: (message: string) => void }) {
  const { apiRequest } = useSession(); const client = useQueryClient();
  const [name, setName] = useState(""); const [intervalKm, setIntervalKm] = useState(""); const [intervalDays, setIntervalDays] = useState("");
  const [description, setDescription] = useState(""); const [planId, setPlanId] = useState(""); const [scheduledAt, setScheduledAt] = useState(""); const [recordType, setRecordType] = useState("PREVENTIVE"); const [provider, setProvider] = useState(""); const [recordCost, setRecordCost] = useState(""); const [recordOdometer, setRecordOdometer] = useState(""); const [serviceOdometer, setServiceOdometer] = useState("");
  const params = `companyId=${encodeURIComponent(companyId)}${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}&vehicleId=${encodeURIComponent(vehicleId)}`;
  const plans = useQuery({ queryKey: ["maintenance-plans", companyId, branchId, vehicleId], queryFn: async () => (await (await apiRequest(`/maintenance/plans?${params}`)).json() as ApiList<MaintenancePlanItem>).items });
  const upcoming = useQuery({ queryKey: ["maintenance-upcoming", companyId, branchId, vehicleId], queryFn: async () => (await (await apiRequest(`/maintenance/upcoming?${params}`)).json() as ApiList<MaintenanceUpcomingItem>).items });
  const records = useQuery({ queryKey: ["maintenance-records", companyId, branchId, vehicleId], queryFn: async () => (await (await apiRequest(`/maintenance/records?${params}`)).json() as ApiList<MaintenanceRecordItem>).items });
  const refresh = () => { void client.invalidateQueries({ queryKey: ["maintenance-plans", companyId, branchId, vehicleId] }); void client.invalidateQueries({ queryKey: ["maintenance-upcoming", companyId, branchId, vehicleId] }); void client.invalidateQueries({ queryKey: ["maintenance-records", companyId, branchId, vehicleId] }); void client.invalidateQueries({ queryKey: ["vehicles"] }); };
  const addPlan = useMutation({ mutationFn: async () => { const body = { companyId, vehicleId, name: name.trim(), intervalKm: intervalKm ? Number(intervalKm) : null, intervalDays: intervalDays ? Number(intervalDays) : null, windowDays: 15 }; const response = await apiRequest("/maintenance/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return response.json(); }, onSuccess: () => { setName(""); setIntervalKm(""); setIntervalDays(""); refresh(); }, onError: (error: Error) => onNotice(error.message) });
  const addRecord = useMutation({ mutationFn: async () => { const response = await apiRequest("/maintenance/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, vehicleId, planId: planId || null, type: recordType, description: description.trim(), provider: provider.trim() || null, scheduledAt: scheduledAt || null, status: "SCHEDULED", outOfService: false, odometerKm: recordOdometer ? Number(recordOdometer) : null, costAmount: recordCost ? Number(recordCost) : null }) }); return response.json(); }, onSuccess: () => { setDescription(""); setScheduledAt(""); setProvider(""); setRecordCost(""); setRecordOdometer(""); refresh(); }, onError: (error: Error) => onNotice(error.message) });
  const changeRecord = useMutation({ mutationFn: async ({ item, status, outOfService }: { item: MaintenanceRecordItem; status: MaintenanceRecordItem["status"]; outOfService?: boolean }) => { const response = await apiRequest(`/maintenance/records/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...(outOfService === undefined ? {} : { outOfService }), ...(status === "COMPLETED" ? { odometerKm: serviceOdometer ? Number(serviceOdometer) : item.odometerKm } : {}) }) }); return response.json(); }, onSuccess: refresh, onError: (error: Error) => onNotice(error.message) });
  const changePlan = useMutation({ mutationFn: async (item: MaintenancePlanItem) => { const response = await apiRequest(`/maintenance/plans/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }) }); return response.json(); }, onSuccess: refresh, onError: (error: Error) => onNotice(error.message) });

  return <Stack spacing={2.5}>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1.5}><Typography sx={{ fontWeight: 700 }}>Plan preventivo</Typography><TextField size="small" label="Nombre del plan" value={name} onChange={(event) => setName(event.target.value)} /><Box className="vehicle-form-grid"><TextField size="small" label="Intervalo km" type="number" value={intervalKm} onChange={(event) => setIntervalKm(event.target.value)} /><TextField size="small" label="Intervalo días" type="number" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} /></Box><Typography variant="caption" color="text.secondary">Define al menos un intervalo. Añade días para calcular también la fecha y su ventana de ±15 días.</Typography><Button variant="contained" disabled={!name.trim() || (!intervalKm && !intervalDays) || addPlan.isPending} onClick={() => addPlan.mutate()}>Crear plan</Button></Stack></Paper>
      <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1.5}><Typography sx={{ fontWeight: 700 }}>Registrar mantenimiento</Typography><TextField size="small" label="Descripción" value={description} onChange={(event) => setDescription(event.target.value)} /><Box className="vehicle-form-grid"><FormControl size="small"><InputLabel id="maintenance-type">Tipo</InputLabel><Select labelId="maintenance-type" label="Tipo" value={recordType} onChange={(event) => setRecordType(event.target.value)}><MenuItem value="PREVENTIVE">Preventivo</MenuItem><MenuItem value="CORRECTIVE">Correctivo</MenuItem></Select></FormControl><FormControl size="small"><InputLabel id="maintenance-plan">Plan (opcional)</InputLabel><Select labelId="maintenance-plan" label="Plan (opcional)" value={planId} onChange={(event) => setPlanId(event.target.value)}><MenuItem value="">Sin plan</MenuItem>{(plans.data ?? []).filter((item) => item.status === "ACTIVE").map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</Select></FormControl><TextField size="small" label="Proveedor" value={provider} onChange={(event) => setProvider(event.target.value)} /><TextField size="small" label="Costo (BOB)" type="number" value={recordCost} onChange={(event) => setRecordCost(event.target.value)} /><TextField size="small" label="Kilometraje (km)" type="number" value={recordOdometer} onChange={(event) => setRecordOdometer(event.target.value)} /></Box><TextField size="small" label="Fecha programada" type="date" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><Button variant="contained" disabled={!description.trim() || addRecord.isPending} onClick={() => addRecord.mutate()}>Programar mantenimiento</Button></Stack></Paper>
    </Box>
    {(plans.isError || upcoming.isError || records.isError) && <Alert severity="error">No se pudo cargar el mantenimiento: {plans.error?.message ?? upcoming.error?.message ?? records.error?.message}</Alert>}
    <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6" sx={{ mb: 1 }}>Planes</Typography>{plans.isLoading ? <LinearProgress /> : <Stack spacing={1}>{(plans.data ?? []).map((plan) => <Stack key={plan.id} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, borderBottom: "1px solid #edf0ee", py: 1 }}><Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 650 }}>{plan.name}</Typography><Typography variant="body2" color="text.secondary">{plan.intervalKm ? `Cada ${formatNumber(plan.intervalKm)} km · próximo ${plan.nextDueKm ? `${formatNumber(plan.nextDueKm)} km` : "—"}` : ""}{plan.intervalKm && plan.intervalDays ? " · " : ""}{plan.intervalDays ? `Cada ${plan.intervalDays} días · ${plan.nextDueAt ? formatDate(plan.nextDueAt) : "fecha pendiente"}${plan.windowStartAt && plan.windowEndAt ? ` · ventana ${formatDate(plan.windowStartAt)}–${formatDate(plan.windowEndAt)}` : ""}` : ""}</Typography></Box><Button size="small" onClick={() => changePlan.mutate(plan)}>{plan.status === "ACTIVE" ? "Desactivar" : "Reactivar"}</Button></Stack>)}{!plans.data?.length && <Typography color="text.secondary">Aún no hay planes definidos.</Typography>}</Stack>}</Paper>
    <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6" sx={{ mb: 1 }}>Mantenimiento próximo y vencido</Typography>{upcoming.isLoading ? <LinearProgress /> : <Stack spacing={1}>{(upcoming.data ?? []).map((item) => <Stack key={item.planId} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, borderBottom: "1px solid #edf0ee", py: 1 }}><Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 650 }}>{item.planName} · {item.vehiclePlate}</Typography><Typography variant="body2" color="text.secondary">{item.reasons.includes("DATE") && item.nextDueAt ? `Fecha objetivo ${formatDate(item.nextDueAt)}` : ""}{item.reasons.includes("DATE") && item.reasons.includes("MILEAGE") ? " · " : ""}{item.reasons.includes("MILEAGE") ? `${formatNumber(item.currentOdometerKm ?? 0)} km de ${formatNumber(item.nextDueKm ?? 0)} km` : ""}</Typography></Box><Chip size="small" color={item.urgency === "OVERDUE" ? "error" : "warning"} label={item.urgency === "OVERDUE" ? "Vencido" : "Próximo"} /></Stack>)}{!upcoming.data?.length && <Typography color="text.secondary">No hay planes dentro de su ventana ni con el kilometraje objetivo alcanzado.</Typography>}</Stack>}</Paper>
    <TextField size="small" label="Kilometraje al completar mantenimiento (km)" type="number" value={serviceOdometer} onChange={(event) => setServiceOdometer(event.target.value)} sx={{ maxWidth: 360 }} />
    <TableContainer component={Paper} variant="outlined" className="table-wrap">{records.isLoading ? <LinearProgress /> : <Table><TableHead><TableRow><TableCell>Actividad</TableCell><TableCell>Fecha</TableCell><TableCell>Estado</TableCell><TableCell>Vehículo</TableCell><TableCell align="right">Acciones</TableCell></TableRow></TableHead><TableBody>
      {(records.data ?? []).map((item) => <TableRow key={item.id} hover><TableCell><Typography sx={{ fontWeight: 650 }}>{item.description}</Typography><Typography variant="caption" color="text.secondary">{item.type === "PREVENTIVE" ? "Preventivo" : "Correctivo"}{item.provider ? ` · ${item.provider}` : ""}{item.costAmount !== null ? ` · BOB ${formatNumber(item.costAmount)}` : ""}{item.planId ? " · Plan" : ""}</Typography></TableCell><TableCell>{item.scheduledAt ? formatDate(item.scheduledAt) : "Sin fecha"}</TableCell><TableCell><Chip size="small" color={item.outOfService ? "error" : item.status === "COMPLETED" ? "success" : "default"} label={item.outOfService ? "Fuera de servicio" : maintenanceStatusLabels[item.status]} /></TableCell><TableCell>{item.odometerKm ? `${formatNumber(item.odometerKm)} km` : "—"}</TableCell><TableCell align="right">{item.status === "SCHEDULED" && <><Button size="small" onClick={() => changeRecord.mutate({ item, status: "IN_PROGRESS", outOfService: false })}>Iniciar</Button><Button size="small" color="warning" onClick={() => changeRecord.mutate({ item, status: "IN_PROGRESS", outOfService: true })}>Detener vehículo</Button></>}{item.status === "IN_PROGRESS" && <><Button size="small" onClick={() => changeRecord.mutate({ item, status: "COMPLETED", outOfService: false })}>Completar</Button>{item.outOfService && <Button size="small" onClick={() => changeRecord.mutate({ item, status: "IN_PROGRESS", outOfService: false })}>Habilitar</Button>}</>}</TableCell></TableRow>)}
      {!records.data?.length && <TableRow><TableCell colSpan={5}><EmptyState title="Sin mantenimientos" detail="Programa una tarea y conserva su estado e historial." /></TableCell></TableRow>}
    </TableBody></Table>}</TableContainer>
  </Stack>;
}

function FuelPanel({ companyId, branchId, vehicleId, onNotice }: { companyId: string; branchId: string; vehicleId: string; onNotice: (message: string) => void }) {
  const { apiRequest } = useSession(); const client = useQueryClient();
  const [tankName, setTankName] = useState(""); const [fuelType, setFuelType] = useState<FuelType>("GASOLINE"); const [unit, setUnit] = useState<FuelUnit>("LITER"); const [capacity, setCapacity] = useState("");
  const [tankId, setTankId] = useState(""); const [quantity, setQuantity] = useState(""); const [costAmount, setCostAmount] = useState(""); const [odometerKm, setOdometerKm] = useState(""); const [provider, setProvider] = useState(""); const [occurredAt, setOccurredAt] = useState(localDateTimeValue);
  const [filterFuelType, setFilterFuelType] = useState<FuelType | "ALL">("ALL"); const [fromDate, setFromDate] = useState(""); const [toDate, setToDate] = useState("");
  const params = `companyId=${encodeURIComponent(companyId)}${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}&vehicleId=${encodeURIComponent(vehicleId)}`;
  const filterQuery = new URLSearchParams({ ...(filterFuelType === "ALL" ? {} : { fuelType: filterFuelType }), ...(fromDate ? { from: localDayStartIso(fromDate) } : {}), ...(toDate ? { to: localDayAfterStartIso(toDate) } : {}) }).toString();
  const filteredParams = `${params}${filterQuery ? `&${filterQuery}` : ""}`;
  const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate);
  const tanks = useQuery({ queryKey: ["fuel-tanks", companyId, branchId, vehicleId], queryFn: async () => (await (await apiRequest(`/fuel/tanks?${params}`)).json() as ApiList<VehicleFuelTankItem>).items });
  const records = useQuery({ queryKey: ["fuel-records", companyId, branchId, vehicleId, filterFuelType, fromDate, toDate], enabled: !invalidDateRange, queryFn: async () => (await (await apiRequest(`/fuel/records?${filteredParams}`)).json() as ApiList<FuelRecordItem>).items });
  const summary = useQuery({ queryKey: ["fuel-summary", companyId, branchId, vehicleId, filterFuelType, fromDate, toDate], enabled: !invalidDateRange, queryFn: async () => (await (await apiRequest(`/fuel/summary?${filteredParams}`)).json() as ApiList<FuelSummaryItem>).items });
  useEffect(() => { if (!tankId && tanks.data?.find((tank) => tank.status === "ACTIVE")) setTankId(tanks.data.find((tank) => tank.status === "ACTIVE")?.id ?? ""); }, [tankId, tanks.data]);
  const refresh = () => { void client.invalidateQueries({ queryKey: ["fuel-tanks", companyId, branchId, vehicleId] }); void client.invalidateQueries({ queryKey: ["fuel-records", companyId, branchId, vehicleId] }); void client.invalidateQueries({ queryKey: ["fuel-summary", companyId, branchId, vehicleId] }); };
  const addTank = useMutation({ mutationFn: async () => { const response = await apiRequest("/fuel/tanks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, vehicleId, name: tankName.trim(), fuelType, unit, capacity: Number(capacity) }) }); return response.json(); }, onSuccess: () => { setTankName(""); setCapacity(""); refresh(); }, onError: (error: Error) => onNotice(error.message) });
  const addRecord = useMutation({ mutationFn: async () => { const response = await apiRequest("/fuel/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, vehicleId, tankId, quantity: Number(quantity), costAmount: Number(costAmount), odometerKm: Number(odometerKm), occurredAt: new Date(occurredAt).toISOString(), provider: provider.trim() || null }) }); return response.json(); }, onSuccess: () => { setQuantity(""); setCostAmount(""); setProvider(""); setOccurredAt(localDateTimeValue()); refresh(); }, onError: (error: Error) => onNotice(error.message) });
  const changeTank = useMutation({ mutationFn: async (tank: VehicleFuelTankItem) => { const response = await apiRequest(`/fuel/tanks/${tank.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: tank.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }) }); return response.json(); }, onSuccess: refresh, onError: (error: Error) => onNotice(error.message) });
  const units: FuelUnit[] = fuelType === "GASOLINE" ? ["LITER"] : ["CUBIC_METER", "KILOGRAM"];
  return <Stack spacing={2.5}>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1.5}><Typography sx={{ fontWeight: 700 }}>Configurar tanque</Typography><TextField size="small" label="Nombre" value={tankName} onChange={(event) => setTankName(event.target.value)} /><Box className="vehicle-form-grid"><FormControl size="small"><InputLabel id="fuel-type">Combustible</InputLabel><Select labelId="fuel-type" label="Combustible" value={fuelType} onChange={(event) => { const value = event.target.value as FuelType; setFuelType(value); setUnit(value === "GASOLINE" ? "LITER" : "CUBIC_METER"); }}><MenuItem value="GASOLINE">Gasolina</MenuItem><MenuItem value="GNV">GNV</MenuItem></Select></FormControl><FormControl size="small"><InputLabel id="fuel-unit">Unidad</InputLabel><Select labelId="fuel-unit" label="Unidad" value={unit} onChange={(event) => setUnit(event.target.value as FuelUnit)}>{units.map((value) => <MenuItem key={value} value={value}>{fuelUnitLabels[value]}</MenuItem>)}</Select></FormControl></Box><TextField size="small" label={`Capacidad (${fuelUnitLabels[unit]})`} type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} /><Button variant="contained" disabled={!tankName.trim() || Number(capacity) <= 0 || addTank.isPending} onClick={() => addTank.mutate()}>Agregar tanque</Button></Stack></Paper>
      <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1.5}><Typography sx={{ fontWeight: 700 }}>Registrar carga</Typography><FormControl size="small"><InputLabel id="fuel-tank">Tanque</InputLabel><Select labelId="fuel-tank" label="Tanque" value={tankId} onChange={(event) => setTankId(event.target.value)}>{(tanks.data ?? []).filter((tank) => tank.status === "ACTIVE").map((tank) => <MenuItem key={tank.id} value={tank.id}>{tank.name} · {tank.fuelType === "GNV" ? "GNV" : "Gasolina"} ({fuelUnitLabels[tank.unit]})</MenuItem>)}</Select></FormControl><Box className="vehicle-form-grid"><TextField size="small" label="Cantidad" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><TextField size="small" label="Costo total (BOB)" type="number" value={costAmount} onChange={(event) => setCostAmount(event.target.value)} /><TextField size="small" label="Kilometraje" type="number" value={odometerKm} onChange={(event) => setOdometerKm(event.target.value)} /><TextField size="small" label="Proveedor" value={provider} onChange={(event) => setProvider(event.target.value)} /><TextField size="small" label="Fecha y hora" type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Box><Button variant="contained" disabled={!tankId || Number(quantity) <= 0 || Number(costAmount) < 0 || !odometerKm || !occurredAt || addRecord.isPending} onClick={() => addRecord.mutate()}>Guardar carga</Button></Stack></Paper>
    </Box>
    {(tanks.isError || records.isError || summary.isError) && <Alert severity="error">No se pudo cargar el combustible: {tanks.error?.message ?? records.error?.message ?? summary.error?.message}</Alert>}
    <Paper variant="outlined" sx={{ p: 2 }}><Stack spacing={1.5}><Typography sx={{ fontWeight: 700 }}>Filtrar cargas y resumen</Typography><Box className="vehicle-form-grid"><FormControl size="small"><InputLabel id="fuel-filter-type">Combustible</InputLabel><Select labelId="fuel-filter-type" label="Combustible" value={filterFuelType} onChange={(event) => setFilterFuelType(event.target.value as FuelType | "ALL")}><MenuItem value="ALL">Todos</MenuItem><MenuItem value="GASOLINE">Gasolina</MenuItem><MenuItem value="GNV">GNV</MenuItem></Select></FormControl><TextField size="small" label="Desde" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><TextField size="small" label="Hasta" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><Button size="small" disabled={filterFuelType === "ALL" && !fromDate && !toDate} onClick={() => { setFilterFuelType("ALL"); setFromDate(""); setToDate(""); }}>Limpiar filtros</Button></Box>{invalidDateRange && <Alert severity="warning">La fecha inicial no puede ser posterior a la fecha final.</Alert>}</Stack></Paper>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" }, gap: 1.5 }}>{(summary.data ?? []).map((item) => <Paper key={`${item.fuelType}:${item.unit}:${item.currencyCode}`} variant="outlined" sx={{ p: 2 }}><Typography variant="overline" color="primary.main">{item.fuelType === "GNV" ? "GNV" : "Gasolina"} · {fuelUnitLabels[item.unit]}</Typography><Typography variant="h6">{formatNumber(item.quantity)} {fuelUnitLabels[item.unit]}</Typography><Typography variant="body2" color="text.secondary">{item.currencyCode} {formatNumber(item.costAmount)} · {item.records} cargas</Typography></Paper>)}</Box>
    <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6" sx={{ mb: 1 }}>Tanques configurados</Typography>{tanks.isLoading ? <LinearProgress /> : <Stack spacing={1}>{(tanks.data ?? []).map((tank) => <Stack key={tank.id} direction="row" spacing={1} sx={{ alignItems: "center", borderBottom: "1px solid #edf0ee", py: 1 }}><Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 650 }}>{tank.name}</Typography><Typography variant="body2" color="text.secondary">{tank.fuelType === "GNV" ? "GNV" : "Gasolina"} · {formatNumber(tank.capacity)} {fuelUnitLabels[tank.unit]} de capacidad</Typography></Box><Chip size="small" label={tank.status === "ACTIVE" ? "Activo" : "Inactivo"} /><Button size="small" onClick={() => changeTank.mutate(tank)}>{tank.status === "ACTIVE" ? "Desactivar" : "Reactivar"}</Button></Stack>)}{!tanks.data?.length && <Typography color="text.secondary">Configura un tanque antes de registrar cargas.</Typography>}</Stack>}</Paper>
    <TableContainer component={Paper} variant="outlined" className="table-wrap">{records.isLoading ? <LinearProgress /> : <Table><TableHead><TableRow><TableCell>Fecha</TableCell><TableCell>Combustible</TableCell><TableCell>Cantidad</TableCell><TableCell>Precio/ud.</TableCell><TableCell>Costo</TableCell><TableCell>Kilometraje</TableCell><TableCell>Proveedor</TableCell></TableRow></TableHead><TableBody>
      {(records.data ?? []).map((item) => <TableRow key={item.id} hover><TableCell>{formatDate(item.occurredAt)}</TableCell><TableCell>{item.tankName} · {item.fuelType === "GNV" ? "GNV" : "Gasolina"}</TableCell><TableCell>{formatNumber(item.quantity)} {fuelUnitLabels[item.unit]}</TableCell><TableCell>{item.currencyCode} {formatNumber(item.unitPrice)} / {fuelUnitLabels[item.unit]}</TableCell><TableCell>{item.currencyCode} {formatNumber(item.costAmount)}</TableCell><TableCell>{formatNumber(item.odometerKm)} km</TableCell><TableCell>{item.provider ?? "—"}</TableCell></TableRow>)}
      {!invalidDateRange && !records.data?.length && <TableRow><TableCell colSpan={7}><EmptyState title="Sin cargas registradas" detail="Configura un tanque y registra cada carga con su unidad y kilometraje." /></TableCell></TableRow>}
    </TableBody></Table>}</TableContainer>
  </Stack>;
}
