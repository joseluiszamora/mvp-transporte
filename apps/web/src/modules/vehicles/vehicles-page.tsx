import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from "@mui/material";
import AddRounded from "@mui/icons-material/AddRounded";
import EditRounded from "@mui/icons-material/EditRounded";
import { useSession } from "../../session.tsx";
import { EmptyState } from "../../components/empty-state.tsx";
import { StatusChip } from "../../components/status-chip.tsx";
import { formatNumber } from "../../utils/format.ts";
import type { BranchOption, PageResponse, VehicleItem } from "@mvp-transporte/shared-contracts";

const vehiclesKey = ["vehicles"];

interface VehicleFormValue {
  plate: string;
  vehicleType: string;
  make: string;
  model: string;
  year: number | null;
  capacityKg: number;
  odometerKm: number | null;
}

export function VehiclesPage({
  companyId, branchId, branches, branchesError, onBranchChange, onNotice,
}: {
  companyId: string;
  branchId: string;
  branches: BranchOption[];
  branchesError: string | undefined;
  onBranchChange: (branchId: string) => void;
  onNotice: (message: string) => void;
}) {
  const { apiRequest } = useSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE" | "">("ACTIVE");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleItem | null>(null);
  const [formError, setFormError] = useState("");
  const vehicles = useQuery({
    queryKey: [...vehiclesKey, companyId, branchId, search, vehicleType, status],
    queryFn: async () => await (await apiRequest(`/vehicles?companyId=${encodeURIComponent(companyId)}${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}&limit=100&offset=0&search=${encodeURIComponent(search)}${vehicleType ? `&vehicleType=${encodeURIComponent(vehicleType)}` : ""}${status ? `&status=${status}` : ""}`)).json() as PageResponse<VehicleItem>,
  });
  const save = useMutation({
    mutationFn: async (input: VehicleFormValue) => {
      const path = editing ? `/vehicles/${editing.id}` : "/vehicles";
      const method = editing ? "PATCH" : "POST";
      const body = editing ? input : { ...input, companyId, ...(branchId ? { branchId } : {}) };
      const response = await apiRequest(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return response.json() as Promise<{ item: VehicleItem }>;
    },
    onSuccess: () => { setDialogOpen(false); setEditing(null); queryClient.invalidateQueries({ queryKey: vehiclesKey }); },
    onError: (error: Error) => setFormError(error.message),
  });
  const changeStatus = useMutation({
    mutationFn: async (vehicle: VehicleItem) => {
      const response = await apiRequest(`/vehicles/${vehicle.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: vehicle.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }) });
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vehiclesKey }),
    onError: (error: Error) => onNotice(error.message),
  });
  const openForm = (vehicle: VehicleItem | null) => { setEditing(vehicle); setFormError(""); setDialogOpen(true); };

  return <Box sx={{ p: { xs: 2, md: 3 } }}>
    <Box className="page-heading">
      <Box><Typography variant="h5">Vehículos</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Registro de flota con capacidad en kilogramos y kilometraje.</Typography></Box>
      <Button variant="contained" startIcon={<AddRounded />} onClick={() => openForm(null)}>Registrar vehículo</Button>
    </Box>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2.5 }}>
      <TextField size="small" label="Buscar por placa, marca o modelo" value={search} onChange={(event) => setSearch(event.target.value)} sx={{ flex: 1, maxWidth: 460 }} />
      <TextField size="small" label="Tipo" value={vehicleType} onChange={(event) => setVehicleType(event.target.value)} sx={{ width: { xs: "100%", sm: 160 } }} />
      <FormControl size="small" sx={{ minWidth: 150 }}><InputLabel id="vehicle-status-label">Estado</InputLabel><Select labelId="vehicle-status-label" label="Estado" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><MenuItem value="ACTIVE">Activos</MenuItem><MenuItem value="INACTIVE">Inactivos</MenuItem><MenuItem value="">Todos</MenuItem></Select></FormControl>
      <FormControl size="small" sx={{ minWidth: 190 }}><InputLabel id="vehicle-branch-label">Sucursal</InputLabel><Select labelId="vehicle-branch-label" label="Sucursal" value={branchId} onChange={(event) => onBranchChange(event.target.value)}><MenuItem value="">Toda la empresa</MenuItem>{branches.map((branch) => <MenuItem key={branch.id} value={branch.id}>{branch.code} · {branch.name}</MenuItem>)}</Select></FormControl>
      <Chip label={`${vehicles.data?.total ?? 0} registros`} variant="outlined" sx={{ alignSelf: { xs: "flex-start", sm: "center" } }} />
    </Stack>
    {branchesError && <Alert severity="info" sx={{ mb: 2 }}>No se pudieron listar sucursales: {branchesError}. Puedes consultar recursos de toda la empresa según tus permisos.</Alert>}
    <TableContainer component={Paper} variant="outlined" className="table-wrap">
      {vehicles.isLoading ? <LinearProgress /> : <Table size="medium"><TableHead><TableRow><TableCell>Vehículo</TableCell><TableCell>Tipo</TableCell><TableCell align="right">Capacidad</TableCell><TableCell align="right">Kilometraje</TableCell><TableCell>Estado</TableCell><TableCell align="right">Acciones</TableCell></TableRow></TableHead>
        <TableBody>{vehicles.data?.items.map((vehicle) => <TableRow key={vehicle.id} hover>
          <TableCell><Typography sx={{ fontWeight: 700 }}>{vehicle.plate}</Typography><Typography variant="body2" color="text.secondary">{vehicle.make} {vehicle.model}{vehicle.year ? ` · ${vehicle.year}` : ""}</Typography></TableCell>
          <TableCell>{vehicle.vehicleType}</TableCell><TableCell align="right">{formatNumber(vehicle.capacityKg)} kg</TableCell><TableCell align="right">{vehicle.odometerKm === null ? "—" : `${formatNumber(vehicle.odometerKm)} km`}</TableCell>
          <TableCell><Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}><StatusChip status={vehicle.status} />{vehicle.maintenanceBlocked && <Chip size="small" color="error" label="Fuera de servicio" />}</Stack></TableCell>
          <TableCell align="right"><Tooltip title="Editar"><IconButton aria-label={`Editar ${vehicle.plate}`} onClick={() => openForm(vehicle)}><EditRounded fontSize="small" /></IconButton></Tooltip><Button size="small" color={vehicle.status === "ACTIVE" ? "error" : "primary"} onClick={() => changeStatus.mutate(vehicle)}>{vehicle.status === "ACTIVE" ? "Desactivar" : "Activar"}</Button></TableCell>
        </TableRow>)}
        {!vehicles.isLoading && !vehicles.isError && vehicles.data?.items.length === 0 && <TableRow><TableCell colSpan={6}><EmptyState title="Sin vehículos" detail="Registra el primer vehículo de esta empresa para comenzar." /></TableCell></TableRow>}
        {vehicles.isError && <TableRow><TableCell colSpan={6}><Alert severity="error">{vehicles.error.message}</Alert></TableCell></TableRow>}</TableBody>
      </Table>}
    </TableContainer>
    {dialogOpen && <VehicleDialog vehicle={editing} pending={save.isPending} error={formError} onClose={() => { setDialogOpen(false); setEditing(null); }} onSave={(value) => save.mutate(value)} />}
  </Box>;
}

function VehicleDialog({ vehicle, pending, error, onClose, onSave }: { vehicle: VehicleItem | null; pending: boolean; error: string; onClose: () => void; onSave: (value: VehicleFormValue) => void }) {
  const [form, setForm] = useState<VehicleFormValue>(() => vehicle
    ? { plate: vehicle.plate, vehicleType: vehicle.vehicleType, make: vehicle.make, model: vehicle.model, year: vehicle.year, capacityKg: vehicle.capacityKg, odometerKm: vehicle.odometerKm }
    : { plate: "", vehicleType: "", make: "", model: "", year: null, capacityKg: 1, odometerKm: null });
  const field = (key: keyof VehicleFormValue, value: string) => {
    if (key === "year") setForm((current) => ({ ...current, year: value === "" ? null : Number(value) }));
    else if (key === "odometerKm") setForm((current) => ({ ...current, odometerKm: value === "" ? null : Number(value) }));
    else if (key === "capacityKg") setForm((current) => ({ ...current, capacityKg: value === "" ? 0 : Number(value) }));
    else if (key === "plate") setForm((current) => ({ ...current, plate: value }));
    else if (key === "vehicleType") setForm((current) => ({ ...current, vehicleType: value }));
    else if (key === "make") setForm((current) => ({ ...current, make: value }));
    else setForm((current) => ({ ...current, model: value }));
  };
  return <Dialog open onClose={onClose} fullWidth maxWidth="sm"><DialogTitle>{vehicle ? "Editar vehículo" : "Registrar vehículo"}</DialogTitle><DialogContent>
    <Box className="vehicle-form-grid" sx={{ pt: 1.5 }}>
      <TextField label="Placa" value={form.plate} onChange={(event) => field("plate", event.target.value)} required slotProps={{ htmlInput: { maxLength: 20 } }} />
      <TextField label="Tipo de vehículo" value={form.vehicleType} onChange={(event) => field("vehicleType", event.target.value)} required placeholder="Camión, furgón…" />
      <TextField label="Marca" value={form.make} onChange={(event) => field("make", event.target.value)} required />
      <TextField label="Modelo" value={form.model} onChange={(event) => field("model", event.target.value)} required />
      <TextField label="Año" type="number" value={form.year ?? ""} onChange={(event) => field("year", event.target.value)} slotProps={{ htmlInput: { min: 1886, max: 2200 } }} />
      <TextField label="Capacidad (kg)" type="number" value={form.capacityKg} onChange={(event) => field("capacityKg", event.target.value)} required slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }} />
      <TextField label="Kilometraje (km)" type="number" value={form.odometerKm ?? ""} onChange={(event) => field("odometerKm", event.target.value)} slotProps={{ htmlInput: { min: 0, step: 1 } }} />
    </Box>
    {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
  </DialogContent><DialogActions sx={{ px: 3, pb: 2.5 }}><Button onClick={onClose}>Cancelar</Button><Button variant="contained" disabled={pending} onClick={() => onSave(form)}>{pending ? "Guardando…" : "Guardar"}</Button></DialogActions></Dialog>;
}
