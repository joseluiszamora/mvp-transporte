import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, FormControl, InputLabel, LinearProgress, MenuItem,
  Paper, Select, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Tabs, TextField, Typography,
} from "@mui/material";
import GroupsRounded from "@mui/icons-material/GroupsRounded";
import LocalShippingRounded from "@mui/icons-material/LocalShippingRounded";
import PersonAddAltRounded from "@mui/icons-material/PersonAddAltRounded";
import { useSession } from "../../session.tsx";
import { EmptyState } from "../../components/empty-state.tsx";
import { StatusChip } from "../../components/status-chip.tsx";
import { formatDate } from "../../utils/format.ts";
import type { EmployeeOption, OperationalProfileItem, PageResponse } from "@mvp-transporte/shared-contracts";

const driverKey = ["driver-profiles"];
const assistantKey = ["assistant-profiles"];

export function StaffPage({ companyId, onNotice }: { companyId: string; onNotice: (message: string) => void }) {
  const [tab, setTab] = useState<"drivers" | "assistants">("drivers");
  return <Box sx={{ p: { xs: 2, md: 3 } }}>
    <Box className="page-heading"><Box><Typography variant="h5">Personal operativo</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Los perfiles referencian empleados administrados por mvp-base.</Typography></Box></Box>
    <Tabs value={tab} onChange={(_, value: "drivers" | "assistants") => setTab(value)} sx={{ borderBottom: 1, borderColor: "divider", mb: 2.5 }}>
      <Tab value="drivers" icon={<LocalShippingRounded />} iconPosition="start" label="Conductores" />
      <Tab value="assistants" icon={<GroupsRounded />} iconPosition="start" label="Ayudantes" />
    </Tabs>
    {tab === "drivers" ? <ProfilesTable key={`${companyId}:driver`} kind="driver" companyId={companyId} onNotice={onNotice} /> : <ProfilesTable key={`${companyId}:assistant`} kind="assistant" companyId={companyId} onNotice={onNotice} />}
  </Box>;
}

function ProfilesTable({ kind, companyId, onNotice }: { kind: "driver" | "assistant"; companyId: string; onNotice: (message: string) => void }) {
  const { apiRequest } = useSession();
  const client = useQueryClient();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [profileOffset, setProfileOffset] = useState(0);
  const isDriver = kind === "driver";
  const key = isDriver ? driverKey : assistantKey;
  const path = isDriver ? "driver-profiles" : "assistant-profiles";
  const profiles = useQuery({ queryKey: [...key, companyId, profileOffset], queryFn: async () => await (await apiRequest(`/operational-staff/${path}?companyId=${companyId}&limit=20&offset=${profileOffset}`)).json() as PageResponse<OperationalProfileItem> });
  const employees = useInfiniteQuery({
    queryKey: ["employees", companyId, employeeSearch],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => await (await apiRequest(`/operational-staff/employees?companyId=${companyId}&limit=100&offset=${pageParam}${employeeSearch ? `&search=${encodeURIComponent(employeeSearch)}` : ""}`)).json() as { items: EmployeeOption[]; total: number; limit: number; offset: number },
    getNextPageParam: (lastPage) => lastPage.offset + lastPage.limit < lastPage.total ? lastPage.offset + lastPage.limit : undefined,
  });
  const availableEmployees = (employees.data?.pages.flatMap((page) => page.items) ?? []).filter((employee) => !profiles.data?.items.some((profile) => profile.employeeId === employee.id));
  const create = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(`/operational-staff/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, employeeId: selectedEmployeeId }) });
      return response.json();
    },
    onSuccess: () => { setSelectedEmployeeId(""); void client.invalidateQueries({ queryKey: key }); },
    onError: (error: Error) => onNotice(error.message),
  });
  const toggle = useMutation({
    mutationFn: async (profile: OperationalProfileItem) => {
      const response = await apiRequest(`/operational-staff/${path}/${profile.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: profile.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }) });
      return response.json();
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
    onError: (error: Error) => onNotice(error.message),
  });
  return <Stack spacing={2.5}>
    <Paper variant="outlined" sx={{ p: 2, bgcolor: "#f8faf9" }}><Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
      <PersonAddAltRounded color="primary" /><Box sx={{ flex: 1 }}><Typography sx={{ fontWeight: 700 }}>Agregar {isDriver ? "conductor" : "ayudante"}</Typography><Typography variant="body2" color="text.secondary">Selecciona un empleado activo de la empresa.</Typography></Box>
      <TextField size="small" label="Buscar empleado" value={employeeSearch} onChange={(event) => { setEmployeeSearch(event.target.value); setSelectedEmployeeId(""); }} sx={{ minWidth: { xs: "100%", sm: 190 } }} />
      <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 270 } }}><InputLabel id={`employee-${kind}`}>Empleado</InputLabel><Select labelId={`employee-${kind}`} label="Empleado" value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
        {availableEmployees.map((employee) => <MenuItem key={employee.id} value={employee.id}>{employee.internalCode} · {employee.firstNames} {employee.lastNames}</MenuItem>)}
      </Select></FormControl><Button variant="contained" disabled={!selectedEmployeeId || create.isPending || profiles.isLoading || employees.isLoading} onClick={() => create.mutate()}>Agregar</Button>
    </Stack></Paper>
    {employees.isError && <Alert severity="error">No se pudo consultar personal de mvp-base: {employees.error.message}</Alert>}
    {employees.hasNextPage && <Button size="small" onClick={() => void employees.fetchNextPage()} disabled={employees.isFetchingNextPage}>{employees.isFetchingNextPage ? "Cargando…" : "Cargar más empleados"}</Button>}
    <TableContainer component={Paper} variant="outlined" className="table-wrap">{profiles.isLoading ? <LinearProgress /> : <Table><TableHead><TableRow><TableCell>Empleado</TableCell><TableCell>Código</TableCell><TableCell>Estado</TableCell><TableCell>Alta</TableCell><TableCell align="right">Acciones</TableCell></TableRow></TableHead>
      <TableBody>{profiles.data?.items.map((profile) => <TableRow key={profile.id} hover><TableCell><Typography sx={{ fontWeight: 600 }}>{profile.employeeName}</Typography></TableCell><TableCell>{profile.employeeCode || "—"}</TableCell><TableCell><StatusChip status={profile.status} /></TableCell><TableCell>{formatDate(profile.createdAt)}</TableCell><TableCell align="right"><Button size="small" color={profile.status === "ACTIVE" ? "error" : "primary"} onClick={() => toggle.mutate(profile)}>{profile.status === "ACTIVE" ? "Desactivar" : "Reactivar"}</Button></TableCell></TableRow>)}
      {profiles.isError && <TableRow><TableCell colSpan={5}><Alert severity="error">{profiles.error.message}</Alert></TableCell></TableRow>}
      {!profiles.isLoading && !profiles.isError && profiles.data?.items.length === 0 && <TableRow><TableCell colSpan={5}><EmptyState title="Sin perfiles" detail={`Agrega un empleado como ${isDriver ? "conductor" : "ayudante"}.`} /></TableCell></TableRow>}
      </TableBody></Table>}</TableContainer>
    <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", alignItems: "center" }}>
      <Typography variant="body2" color="text.secondary">{profiles.data?.total ? `${profileOffset + 1}–${Math.min(profileOffset + (profiles.data?.items.length ?? 0), profiles.data.total)} de ${profiles.data.total}` : "0 registros"}</Typography>
      <Button size="small" disabled={profileOffset === 0 || profiles.isLoading} onClick={() => setProfileOffset((offset) => Math.max(0, offset - 20))}>Anterior</Button>
      <Button size="small" disabled={profileOffset + 20 >= (profiles.data?.total ?? 0) || profiles.isLoading} onClick={() => setProfileOffset((offset) => offset + 20)}>Siguiente</Button>
    </Stack>
    <Typography variant="caption" color="text.secondary">Un empleado puede tener perfil de conductor y de ayudante. Cada estado se administra por separado.</Typography>
  </Stack>;
}
