import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, Grid, InputLabel, LinearProgress, MenuItem, Paper, Select,
  Stack, TextField, Typography,
} from "@mui/material";
import AddRounded from "@mui/icons-material/AddRounded";
import AssignmentTurnedInRounded from "@mui/icons-material/AssignmentTurnedInRounded";
import CancelRounded from "@mui/icons-material/CancelRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BranchOption,
  CompanyOption,
  OperationalProfileItem,
  PageResponse,
  TripCreateInput,
  TripItem,
  TripStatus,
  TripType,
  VehicleItem,
} from "@mvp-transporte/shared-contracts";
import { useSession } from "../../session.tsx";
import { EmptyState } from "../../components/empty-state.tsx";

interface TripsPageProps {
  companyId: string;
  branchId: string;
  branches: BranchOption[];
  branchesError?: string | undefined;
  onBranchChange(branchId: string): void;
  onNotice(message: string): void;
}

interface ApiPage<T> extends PageResponse<T> {}
interface DriverSegment { id: string; employeeId: string; startsAt: string; endsAt: string }
interface AssistantSelection { id: string; source: "INTERNAL" | "CLIENT"; employeeId: string; externalName: string }
interface StopSelection { id: "first" | "second"; location: string }

const typeLabels: Record<TripType, string> = {
  DISTRIBUTION: "Distribución",
  SHORT_ROUTE: "Ruta corta",
  LONG_DISTANCE: "Viaje largo",
};
const statusLabels: Record<TripStatus, string> = {
  PLANNED: "Planificado",
  ASSIGNED: "Asignado",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
};

function localDateTime(offsetMinutes: number): string {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Completa las fechas previstas del viaje.");
  return date.toISOString();
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/La_Paz" }).format(new Date(value));
}

function statusColor(status: TripStatus): "default" | "info" | "warning" | "success" | "error" {
  if (status === "PLANNED") return "default";
  if (status === "ASSIGNED") return "info";
  if (status === "IN_PROGRESS") return "warning";
  if (status === "COMPLETED") return "success";
  return "error";
}

export function TripsPage({ companyId, branchId, branches, branchesError, onBranchChange, onNotice }: TripsPageProps) {
  const { apiRequest } = useSession();
  const queryClient = useQueryClient();
  const [type, setType] = useState<TripType>("DISTRIBUTION");
  const [vehicleId, setVehicleId] = useState("");
  const [plannedStartAt, setPlannedStartAt] = useState(() => localDateTime(60));
  const [plannedEndAt, setPlannedEndAt] = useState(() => localDateTime(180));
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [contractingCompanyId, setContractingCompanyId] = useState("");
  const [sealInput, setSealInput] = useState("");
  const [stops, setStops] = useState<StopSelection[]>([{ id: "first", location: "" }, { id: "second", location: "" }]);
  const [drivers, setDrivers] = useState<DriverSegment[]>(() => [{ id: crypto.randomUUID(), employeeId: "", startsAt: "", endsAt: "" }]);
  const [assistants, setAssistants] = useState<AssistantSelection[]>(() => [{ id: crypto.randomUUID(), source: "INTERNAL", employeeId: "", externalName: "" }]);
  const [cancelTarget, setCancelTarget] = useState<TripItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [historyTripId, setHistoryTripId] = useState("");

  const vehicles = useQuery({
    queryKey: ["trips-vehicles", companyId, branchId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const query = new URLSearchParams({ companyId, status: "ACTIVE", limit: "100" });
      if (branchId) query.set("branchId", branchId);
      return (await apiRequest(`/vehicles?${query}`)).json() as Promise<ApiPage<VehicleItem>>;
    },
  });
  const driversQuery = useQuery({
    queryKey: ["trips-driver-profiles", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => (await apiRequest(`/operational-staff/driver-profiles?companyId=${encodeURIComponent(companyId)}&status=ACTIVE&limit=100`)).json() as Promise<ApiPage<OperationalProfileItem>>,
  });
  const assistantsQuery = useQuery({
    queryKey: ["trips-assistant-profiles", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => (await apiRequest(`/operational-staff/assistant-profiles?companyId=${encodeURIComponent(companyId)}&status=ACTIVE&limit=100`)).json() as Promise<ApiPage<OperationalProfileItem>>,
  });
  const companies = useQuery({
    queryKey: ["trips-contracting-companies"],
    queryFn: async () => (await apiRequest("/companies")).json() as Promise<{ items: CompanyOption[] }>,
  });
  const trips = useQuery({
    queryKey: ["trips", companyId, branchId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const query = new URLSearchParams({ companyId, limit: "50", offset: "0" });
      if (branchId) query.set("branchId", branchId);
      return (await apiRequest(`/trips?${query}`)).json() as Promise<ApiPage<TripItem>>;
    },
  });
  const history = useQuery({
    queryKey: ["trip-history", historyTripId],
    enabled: Boolean(historyTripId),
    queryFn: async () => (await apiRequest(`/trips/${encodeURIComponent(historyTripId)}`)).json() as Promise<{ item: TripItem }>,
  });
  const vehicleItems = vehicles.data?.items ?? [];
  const driverItems = driversQuery.data?.items ?? [];
  const assistantItems = assistantsQuery.data?.items ?? [];
  const companyItems = useMemo(() => (companies.data?.items ?? []).filter((item) => item.status === "ACTIVE"), [companies.data]);

  useEffect(() => {
    if (!vehicleItems.some((vehicle) => vehicle.id === vehicleId)) setVehicleId(vehicleItems[0]?.id ?? "");
  }, [vehicleId, vehicleItems]);
  useEffect(() => {
    setDrivers((current) => current.map((driver, index) => ({
      ...driver,
      ...(index === 0 ? { startsAt: plannedStartAt } : {}),
      ...(index === current.length - 1 ? { endsAt: plannedEndAt } : {}),
    })));
  }, [plannedStartAt, plannedEndAt]);

  const refreshTrips = () => void queryClient.invalidateQueries({ queryKey: ["trips", companyId] });
  const create = useMutation({
    mutationFn: async (input: TripCreateInput) => (await apiRequest("/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json() as Promise<{ item: TripItem }>,
    onSuccess: () => { refreshTrips(); onNotice("El viaje quedó planificado."); },
    onError: (error: Error) => onNotice(error.message),
  });
  const transition = useMutation({
    mutationFn: async ({ trip, status, reason }: { trip: TripItem; status: Exclude<TripStatus, "PLANNED">; reason?: string }) =>
      (await apiRequest(`/trips/${encodeURIComponent(trip.id)}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(reason ? { cancellationReason: reason } : {}) }),
      })).json() as Promise<{ item: TripItem }>,
    onSuccess: (_result, input) => { refreshTrips(); setCancelTarget(null); setCancelReason(""); onNotice(`Viaje ${statusLabels[input.status].toLocaleLowerCase("es-BO")} correctamente.`); },
    onError: (error: Error) => onNotice(error.message),
  });

  const addDriver = () => setDrivers((current) => [...current, {
    id: crypto.randomUUID(),
    employeeId: "", startsAt: current.at(-1)?.endsAt || plannedStartAt, endsAt: plannedEndAt,
  }]);
  const addAssistant = () => setAssistants((current) => [...current, { id: crypto.randomUUID(), source: "INTERNAL", employeeId: "", externalName: "" }]);
  const updateDriver = (index: number, patch: Partial<DriverSegment>) => setDrivers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const updateAssistant = (index: number, patch: Partial<AssistantSelection>) => setAssistants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const start = toIso(plannedStartAt);
      const end = toIso(plannedEndAt);
      const crew = [
        ...drivers.filter((driver) => driver.employeeId).map((driver, index) => ({
          role: "DRIVER" as const,
          source: "INTERNAL" as const,
          employeeId: driver.employeeId,
          startsAt: toIso(drivers.length === 1 || index === 0 ? plannedStartAt : driver.startsAt),
          endsAt: toIso(drivers.length === 1 || index === drivers.length - 1 ? plannedEndAt : driver.endsAt),
        })),
        ...(type === "SHORT_ROUTE" ? [] : assistants.filter((person) => person.source === "CLIENT" || person.employeeId).map((person) => ({
          role: "ASSISTANT" as const,
          source: person.source,
          ...(person.source === "INTERNAL" ? { employeeId: person.employeeId } : {}),
          ...(person.source === "CLIENT" && person.externalName.trim() ? { externalName: person.externalName.trim() } : {}),
          startsAt: start,
          endsAt: end,
        }))),
      ];
      const input: TripCreateInput = {
        companyId,
        ...(branchId ? { branchId } : {}),
        type,
        vehicleId,
        origin,
        destination,
        plannedStartAt: start,
        plannedEndAt: end,
        ...(type === "LONG_DISTANCE" ? {
          contractingCompanyId,
          sealNumbers: sealInput.split(",").map((seal) => seal.trim()).filter(Boolean),
        } : {}),
        ...(type === "SHORT_ROUTE" ? { stops: stops.map((stop) => stop.location.trim()).filter(Boolean).map((location) => ({ location })) } : {}),
        crew,
      };
      create.mutate(input);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Completa los datos del viaje.");
    }
  };

  const onCancel = () => {
    if (cancelTarget && cancelReason.trim()) transition.mutate({ trip: cancelTarget, status: "CANCELLED", reason: cancelReason.trim() });
  };
  const tripRows = trips.data?.items ?? [];
  const loadError = vehicles.error?.message ?? driversQuery.error?.message ?? assistantsQuery.error?.message ?? companies.error?.message ?? trips.error?.message ?? branchesError;

  return <Box sx={{ p: { xs: 2, md: 3 } }}>
    <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ alignItems: { md: "center" }, justifyContent: "space-between", mb: 2.5 }}>
      <Box><Typography variant="h5" sx={{ fontWeight: 750 }}>Viajes y asignaciones</Typography><Typography color="text.secondary" variant="body2">Planifica servicios y confirma disponibilidad de vehículos y tripulación.</Typography></Box>
      <FormControl size="small" sx={{ minWidth: { xs: "100%", md: 240 } }}><InputLabel id="trip-branch-label">Sucursal</InputLabel><Select labelId="trip-branch-label" label="Sucursal" value={branchId} onChange={(event) => onBranchChange(event.target.value)}><MenuItem value="">Toda la empresa</MenuItem>{branches.map((branch) => <MenuItem key={branch.id} value={branch.id}>{branch.code} · {branch.name}</MenuItem>)}</Select></FormControl>
    </Stack>
    {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
    {(vehicles.isLoading || driversQuery.isLoading || assistantsQuery.isLoading || trips.isLoading) && <LinearProgress sx={{ mb: 2 }} />}

    <Paper component="form" variant="outlined" onSubmit={submit} sx={{ p: { xs: 2, md: 3 }, mb: 3, borderColor: "#e2e9e5" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2 }}><AddRounded color="primary" /><Box><Typography variant="h6" sx={{ fontWeight: 700 }}>Planificar un viaje</Typography><Typography variant="body2" color="text.secondary">La confirmación de asignación revisa solapamientos, mantenimiento y vencimientos cargados.</Typography></Box></Stack>
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><FormControl size="small" fullWidth><InputLabel id="trip-type-label">Tipo de viaje</InputLabel><Select labelId="trip-type-label" label="Tipo de viaje" value={type} onChange={(event) => setType(event.target.value as TripType)}>{Object.entries(typeLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</Select></FormControl></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><FormControl size="small" fullWidth><InputLabel id="trip-vehicle-label">Vehículo</InputLabel><Select labelId="trip-vehicle-label" label="Vehículo" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>{vehicleItems.map((vehicle) => <MenuItem key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.make} {vehicle.model}{vehicle.maintenanceBlocked ? " · Fuera de servicio" : ""}</MenuItem>)}</Select></FormControl></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField size="small" fullWidth type="datetime-local" label="Inicio previsto" value={plannedStartAt} onChange={(event) => setPlannedStartAt(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField size="small" fullWidth type="datetime-local" label="Fin previsto" value={plannedEndAt} onChange={(event) => setPlannedEndAt(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" fullWidth label="Origen" value={origin} onChange={(event) => setOrigin(event.target.value)} slotProps={{ htmlInput: { maxLength: 160 } }} /></Grid>
        <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" fullWidth label="Destino" value={destination} onChange={(event) => setDestination(event.target.value)} slotProps={{ htmlInput: { maxLength: 160 } }} /></Grid>
        {type === "LONG_DISTANCE" && <>
          <Grid size={{ xs: 12, sm: 6 }}><FormControl size="small" fullWidth><InputLabel id="contracting-company-label">Empresa contratante</InputLabel><Select labelId="contracting-company-label" label="Empresa contratante" value={contractingCompanyId} onChange={(event) => setContractingCompanyId(event.target.value)}>{companyItems.map((company) => <MenuItem key={company.id} value={company.id}>{company.tradeName || company.legalName}</MenuItem>)}</Select></FormControl></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField size="small" fullWidth label="Precintos" helperText="Separa varios números con coma" value={sealInput} onChange={(event) => setSealInput(event.target.value)} /></Grid>
        </>}
        {type === "SHORT_ROUTE" && stops.map((stop, index) => <Grid size={{ xs: 12, sm: 6 }} key={stop.id}><TextField size="small" fullWidth label={`Parada ${index + 1}${index === 0 ? "" : " · opcional"}`} value={stop.location} onChange={(event) => setStops((current) => current.map((item) => item.id === stop.id ? { ...item, location: event.target.value } : item))} slotProps={{ htmlInput: { maxLength: 160 } }} /></Grid>)}
      </Grid>

      <Divider sx={{ my: 2.5 }} />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", mb: 1.5 }}><Box><Typography sx={{ fontWeight: 700 }}>Conductores</Typography><Typography variant="caption" color="text.secondary">Los intervalos deben cubrir el viaje sin huecos ni superposiciones.</Typography></Box>{type === "LONG_DISTANCE" && <Button size="small" startIcon={<AddRounded />} onClick={addDriver}>Agregar relevo</Button>}</Stack>
      <Stack spacing={1.25}>
        {drivers.map((driver, index) => <Grid container spacing={1.25} key={driver.id}>
          <Grid size={{ xs: 12, sm: drivers.length > 1 && type === "LONG_DISTANCE" ? 4 : 12 }}><FormControl size="small" fullWidth><InputLabel id={`trip-driver-${index}`}>{drivers.length > 1 ? `Conductor ${index + 1}` : "Conductor"}</InputLabel><Select labelId={`trip-driver-${index}`} label={drivers.length > 1 ? `Conductor ${index + 1}` : "Conductor"} value={driver.employeeId} onChange={(event) => updateDriver(index, { employeeId: event.target.value })}>{driverItems.map((profile) => <MenuItem key={profile.employeeId} value={profile.employeeId}>{profile.employeeCode} · {profile.employeeName}</MenuItem>)}</Select></FormControl></Grid>
          {type === "LONG_DISTANCE" && drivers.length > 1 && <>
            <Grid size={{ xs: 12, sm: 3 }}><TextField size="small" fullWidth type="datetime-local" label="Desde" value={driver.startsAt} onChange={(event) => updateDriver(index, { startsAt: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12, sm: 3 }}><TextField size="small" fullWidth type="datetime-local" label="Hasta" value={driver.endsAt} onChange={(event) => updateDriver(index, { endsAt: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12, sm: 2 }}><Button color="error" size="small" disabled={index === 0 || index === drivers.length - 1} onClick={() => setDrivers((current) => current.filter((_item, itemIndex) => itemIndex !== index))}>Quitar</Button></Grid>
          </>}
        </Grid>)}
      </Stack>

      {type !== "SHORT_ROUTE" && <>
        <Divider sx={{ my: 2.5 }} />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", mb: 1.5 }}><Box><Typography sx={{ fontWeight: 700 }}>Ayudantes</Typography><Typography variant="caption" color="text.secondary">Distribución requiere uno o dos; en viaje largo son opcionales.</Typography></Box><Button size="small" startIcon={<AddRounded />} onClick={addAssistant}>Agregar ayudante</Button></Stack>
        <Stack spacing={1.25}>
          {assistants.map((assistant, index) => <Grid container spacing={1.25} key={assistant.id}>
            <Grid size={{ xs: 12, sm: 3 }}><FormControl size="small" fullWidth><InputLabel id={`trip-assistant-source-${index}`}>Origen</InputLabel><Select labelId={`trip-assistant-source-${index}`} label="Origen" value={assistant.source} onChange={(event) => updateAssistant(index, { source: event.target.value as "INTERNAL" | "CLIENT", employeeId: "" })}><MenuItem value="INTERNAL">Personal interno</MenuItem><MenuItem value="CLIENT">Aporta el cliente</MenuItem></Select></FormControl></Grid>
            <Grid size={{ xs: 12, sm: 7 }}>{assistant.source === "INTERNAL"
              ? <FormControl size="small" fullWidth><InputLabel id={`trip-assistant-${index}`}>Ayudante</InputLabel><Select labelId={`trip-assistant-${index}`} label="Ayudante" value={assistant.employeeId} onChange={(event) => updateAssistant(index, { employeeId: event.target.value })}>{assistantItems.map((profile) => <MenuItem key={profile.employeeId} value={profile.employeeId}>{profile.employeeCode} · {profile.employeeName}</MenuItem>)}</Select></FormControl>
              : <TextField size="small" fullWidth label="Nombre (opcional)" value={assistant.externalName} onChange={(event) => updateAssistant(index, { externalName: event.target.value })} slotProps={{ htmlInput: { maxLength: 120 } }} />}</Grid>
            <Grid size={{ xs: 12, sm: 2 }}><Button color="error" size="small" disabled={assistants.length === 1} onClick={() => setAssistants((current) => current.filter((_item, itemIndex) => itemIndex !== index))}>Quitar</Button></Grid>
          </Grid>)}
        </Stack>
      </>}
      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", mt: 2.5 }}><Button type="submit" variant="contained" disabled={!vehicleId || create.isPending}>{create.isPending ? <CircularProgress size={20} /> : "Guardar como planificado"}</Button></Stack>
    </Paper>

    <Stack spacing={1.5}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>Viajes recientes</Typography>
      {trips.isError && <Alert severity="error">No se pudieron consultar los viajes: {trips.error.message}</Alert>}
      {!trips.isLoading && tripRows.length === 0 && <EmptyState title="Sin viajes planificados" detail="Cuando registres un servicio, aparecerá aquí con su asignación e historial." />}
      {tripRows.map((trip) => <TripCard key={trip.id} trip={trip} driverProfiles={driverItems} assistantProfiles={assistantItems} pending={transition.isPending} onTransition={(status) => transition.mutate({ trip, status })} onCancel={() => { setCancelTarget(trip); setCancelReason(""); }} onHistory={() => setHistoryTripId(trip.id)} />)}
      {trips.data && trips.data.total > trips.data.items.length && <Typography variant="caption" color="text.secondary">Mostrando {trips.data.items.length} de {trips.data.total} viajes.</Typography>}
    </Stack>

    <Dialog open={Boolean(cancelTarget)} onClose={() => setCancelTarget(null)} fullWidth maxWidth="sm">
      <DialogTitle>Cancelar viaje</DialogTitle><DialogContent><Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>El historial de asignaciones se conservará.</Typography><TextField autoFocus fullWidth multiline minRows={2} label="Motivo de cancelación" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} slotProps={{ htmlInput: { maxLength: 300 } }} /></DialogContent>
      <DialogActions><Button onClick={() => setCancelTarget(null)}>Volver</Button><Button color="error" variant="contained" disabled={!cancelReason.trim() || transition.isPending} onClick={onCancel}>Cancelar viaje</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(historyTripId)} onClose={() => setHistoryTripId("")} fullWidth maxWidth="md">
      <DialogTitle>Historial del viaje</DialogTitle><DialogContent dividers>
        {history.isLoading && <LinearProgress />}{history.error && <Alert severity="error">{history.error.message}</Alert>}
        {(history.data?.item.events ?? []).map((event) => <Box key={event.id} sx={{ py: 1.25, borderBottom: 1, borderColor: "divider" }}><Typography sx={{ fontWeight: 650 }}>{eventLabel(event.type)}</Typography><Typography variant="body2" color="text.secondary">{eventDetails(event, driverItems, assistantItems)}</Typography><Typography variant="caption" color="text.secondary">{displayDate(event.createdAt)} · actor {event.actorId}</Typography></Box>)}
        {history.data && history.data.item.events.length === 0 && <Typography color="text.secondary">No hay eventos registrados.</Typography>}
      </DialogContent><DialogActions><Button onClick={() => setHistoryTripId("")}>Cerrar</Button></DialogActions>
    </Dialog>
  </Box>;
}

function TripCard({ trip, driverProfiles, assistantProfiles, pending, onTransition, onCancel, onHistory }: {
  trip: TripItem;
  driverProfiles: OperationalProfileItem[];
  assistantProfiles: OperationalProfileItem[];
  pending: boolean;
  onTransition(status: Exclude<TripStatus, "PLANNED">): void;
  onCancel(): void;
  onHistory(): void;
}) {
  const crew = trip.crew.filter((person) => person.isActive);
  const crewLabel = crew.map((person) => {
    if (person.source === "CLIENT") return `Ayudante cliente${person.externalName ? `: ${person.externalName}` : ""}`;
    const profile = (person.role === "DRIVER" ? driverProfiles : assistantProfiles).find((item) => item.employeeId === person.employeeId);
    const name = profile?.employeeName ?? "Personal no disponible";
    return person.role === "DRIVER" ? `Conductor: ${name}` : `Ayudante: ${name}`;
  });
  return <Card variant="outlined" sx={{ borderColor: "#e2e9e5" }}><CardContent>
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between" }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5, flexWrap: "wrap" }}><Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{typeLabels[trip.type]} · {trip.vehiclePlate}</Typography><Chip size="small" label={statusLabels[trip.status]} color={statusColor(trip.status)} /></Stack>
        <Typography variant="body2">{trip.origin} → {trip.destination}</Typography>
        <Typography variant="body2" color="text.secondary">{displayDate(trip.plannedStartAt)} – {displayDate(trip.plannedEndAt)}</Typography>
        {trip.type === "SHORT_ROUTE" && <Typography variant="body2" color="text.secondary">Paradas: {trip.stops.map((stop) => stop.location).join(" · ")}</Typography>}
        {trip.type === "LONG_DISTANCE" && <Typography variant="body2" color="text.secondary">Precintos: {trip.sealNumbers.join(", ")}</Typography>}
        {crewLabel.length > 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{crewLabel.join(" · ")}</Typography>}
      </Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        {trip.status === "PLANNED" && <Button size="small" startIcon={<AssignmentTurnedInRounded />} disabled={pending} onClick={() => onTransition("ASSIGNED")}>Asignar</Button>}
        {trip.status === "ASSIGNED" && <Button size="small" startIcon={<PlayArrowRounded />} disabled={pending} onClick={() => onTransition("IN_PROGRESS")}>Iniciar</Button>}
        {trip.status === "IN_PROGRESS" && <Button size="small" startIcon={<CheckCircleRounded />} disabled={pending} onClick={() => onTransition("COMPLETED")}>Completar</Button>}
        {trip.status !== "COMPLETED" && trip.status !== "CANCELLED" && <Button size="small" color="error" startIcon={<CancelRounded />} disabled={pending} onClick={onCancel}>Cancelar</Button>}
        <Button size="small" onClick={onHistory}>Historial</Button>
      </Stack>
    </Stack>
  </CardContent></Card>;
}

function eventLabel(type: TripItem["events"][number]["type"]): string {
  const labels = { CREATED: "Viaje planificado", ASSIGNMENT_CHANGED: "Asignación modificada", ASSIGNED: "Viaje asignado", STARTED: "Viaje iniciado", COMPLETED: "Viaje completado", CANCELLED: "Viaje cancelado" };
  return labels[type];
}

function eventDetails(event: TripItem["events"][number], drivers: OperationalProfileItem[], assistants: OperationalProfileItem[]): string {
  const payload = event.payload ?? {};
  if (event.type === "ASSIGNMENT_CHANGED") {
    const crew = Array.isArray(payload.crew) ? payload.crew as Array<Record<string, unknown>> : [];
    const people = crew.map((person) => {
      const employeeId = typeof person.employeeId === "string" ? person.employeeId : "";
      const role = person.role === "DRIVER" ? "Conductor" : "Ayudante";
      const profiles = person.role === "DRIVER" ? drivers : assistants;
      const label = person.source === "CLIENT"
        ? `Ayudante cliente${typeof person.externalName === "string" && person.externalName ? ` (${person.externalName})` : ""}`
        : profiles.find((profile) => profile.employeeId === employeeId)?.employeeName ?? employeeId;
      return `${role}: ${label}`;
    });
    return `Vehículo ${typeof payload.vehicleId === "string" ? payload.vehicleId : "actualizado"}. ${people.join(" · ")}`;
  }
  if (event.type === "CANCELLED") return typeof payload.cancellationReason === "string" ? `Motivo: ${payload.cancellationReason}` : "Viaje cancelado.";
  if (event.type === "STARTED" && typeof payload.actualStartAt === "string") return `Inicio real: ${displayDate(payload.actualStartAt)}`;
  if (event.type === "COMPLETED" && typeof payload.actualEndAt === "string") return `Fin real: ${displayDate(payload.actualEndAt)}`;
  if (event.type === "CREATED") {
    const from = typeof payload.plannedStartAt === "string" ? displayDate(payload.plannedStartAt) : "";
    const to = typeof payload.plannedEndAt === "string" ? displayDate(payload.plannedEndAt) : "";
    return from && to ? `Periodo previsto: ${from} – ${to}` : "Planificación creada.";
  }
  if (typeof payload.previousStatus === "string" && typeof payload.status === "string") return `Estado: ${statusLabels[payload.previousStatus as TripStatus]} → ${statusLabels[payload.status as TripStatus]}`;
  return "Estado actualizado.";
}
