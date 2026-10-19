import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import type { AuditEventDetails, AuditEventSummary } from "@mvp-transporte/contracts";
import { getAuditEvent, listAuditEvents } from "../auth/auth-client";
import { useAuth } from "../auth/AuthContext";

const pageSize = 20;
const dateFormatter = new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", dateStyle: "medium", timeStyle: "short" });
interface Filters { fromDate: string; toDate: string; actorId: string; action: string; resourceType: string; resourceId: string; }
const emptyFilters: Filters = { fromDate: "", toDate: "", actorId: "", action: "", resourceType: "", resourceId: "" };
function localDateBoundary(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}-04:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Fecha no disponible" : dateFormatter.format(date); }
function actionLabel(action: string): string {
  const known: Record<string, string> = { AUTH_LOGIN: "Inicio de sesión", AUTH_REFRESH: "Renovación de sesión", AUTH_LOGOUT: "Cierre de sesión", USER_INVITED: "Invitación de usuario", USER_MEMBERSHIP_SUSPENDED: "Membresía suspendida", USER_MEMBERSHIP_REACTIVATED: "Membresía reactivada", COMPANY_CREATED: "Empresa creada", COMPANY_UPDATED: "Empresa actualizada", BRANCH_CREATED: "Sucursal creada", BRANCH_UPDATED: "Sucursal actualizada", EMPLOYEE_CREATED: "Empleado creado", EMPLOYEE_UPDATED: "Empleado actualizado", EMPLOYEE_DEACTIVATED: "Empleado desactivado", FILE_UPLOADED: "Archivo cargado", FILE_DELETE_REQUESTED: "Archivo quitado" };
  return known[action] ?? action.replaceAll("_", " ").toLocaleLowerCase("es-BO");
}
function actorLabel(event: Pick<AuditEventSummary, "actorId" | "actorType">): string { return event.actorType === "SYSTEM" ? "Sistema" : event.actorId ? `Usuario · ${event.actorId}` : "Usuario sin identificador"; }

function AuditDetailDialog({ eventId, onClose }: { eventId: string | null; onClose: () => void }): React.JSX.Element {
  const detail = useQuery({ queryKey: ["audit", "detail", eventId], queryFn: () => getAuditEvent(eventId as string), enabled: Boolean(eventId) });
  const item: AuditEventDetails | undefined = detail.data?.item;
  return <Dialog fullWidth maxWidth="md" onClose={onClose} open={Boolean(eventId)}>
    <DialogTitle>Detalle de auditoría</DialogTitle><DialogContent dividers>
      {detail.isLoading && <CircularProgress aria-label="Cargando detalle de auditoría" size={24} />}
      {detail.isError && <Alert action={<Button onClick={() => void detail.refetch()} size="small">Reintentar</Button>} severity="error">No se pudo consultar el detalle del evento.</Alert>}
      {item && <Stack spacing={2}>
        <Box><Typography color="text.secondary" variant="caption">Fecha</Typography><Typography>{formatDate(item.createdAt)}</Typography></Box>
        <Box><Typography color="text.secondary" variant="caption">Acción</Typography><Typography>{actionLabel(item.action)} · <code>{item.action}</code></Typography></Box>
        <Box><Typography color="text.secondary" variant="caption">Actor</Typography><Typography>{actorLabel(item)}</Typography></Box>
        <Box><Typography color="text.secondary" variant="caption">Recurso</Typography><Typography>{item.resourceType}{item.resourceId ? ` · ${item.resourceId}` : ""}</Typography></Box>
        <Box><Typography color="text.secondary" variant="caption">Alcance</Typography><Typography>{item.branchId ? `Sucursal ${item.branchId}` : item.companyId ? `Empresa ${item.companyId}` : "Organización"}</Typography></Box>
        <Box><Typography color="text.secondary" variant="caption">Solicitud</Typography><Typography>{item.requestId}</Typography></Box>
        <Box><Typography color="text.secondary" variant="caption">Cambios filtrados</Typography><Paper component="pre" variant="outlined" sx={{ mt: 0.5, p: 1.5, maxHeight: 340, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13 }}>{item.diff ? JSON.stringify(item.diff, null, 2) : "Este evento no contiene diferencias registradas."}</Paper></Box>
      </Stack>}
    </DialogContent><DialogActions><Button onClick={onClose}>Cerrar</Button></DialogActions>
  </Dialog>;
}

export function AuditPage(): React.JSX.Element {
  const { user } = useAuth();
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const audit = useQuery({ queryKey: ["audit", filters, offset], queryFn: () => listAuditEvents({ limit: pageSize, offset, from: localDateBoundary(filters.fromDate, false), to: localDateBoundary(filters.toDate, true), actorId: filters.actorId || undefined, action: filters.action || undefined, resourceType: filters.resourceType || undefined, resourceId: filters.resourceId || undefined }), enabled: Boolean(user?.permissions.includes("audit.read")) });
  if (!user?.permissions.includes("audit.read")) return <Alert severity="warning">Tu cuenta no tiene permiso para consultar la auditoría.</Alert>;
  const updateDraft = (key: keyof Filters, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const dateRangeInvalid = Boolean(draft.fromDate && draft.toDate && draft.fromDate > draft.toDate);
  const applyFilters = () => { if (dateRangeInvalid) return; setOffset(0); setFilters({ ...draft }); };
  const clearFilters = () => { setOffset(0); setDraft(emptyFilters); setFilters(emptyFilters); };
  const items = audit.data?.items ?? [];
  const hasNext = audit.data ? offset + audit.data.limit < audit.data.total : false;

  return <Stack spacing={2.5}>
    <Box><Typography color="text.secondary" variant="overline">ADM-07</Typography><Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">Auditoría</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Consulta los cambios y acciones registrados dentro de tu alcance.</Typography></Box>
    <Paper component="form" variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }} onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
      <Stack spacing={1.5}><Typography component="h2" sx={{ fontWeight: 650 }} variant="subtitle1">Filtros</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }, gap: 1.5 }}>
          <TextField label="Desde" type="date" size="small" value={draft.fromDate} onChange={(event) => updateDraft("fromDate", event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Hasta" type="date" size="small" value={draft.toDate} onChange={(event) => updateDraft("toDate", event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="ID del actor" size="small" value={draft.actorId} onChange={(event) => updateDraft("actorId", event.target.value)} />
          <TextField label="Acción" size="small" value={draft.action} onChange={(event) => updateDraft("action", event.target.value)} />
          <TextField label="Tipo de recurso" size="small" value={draft.resourceType} onChange={(event) => updateDraft("resourceType", event.target.value)} />
          <TextField label="ID del recurso" size="small" value={draft.resourceId} onChange={(event) => updateDraft("resourceId", event.target.value)} />
        </Box>
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", flexWrap: "wrap" }}><Button onClick={clearFilters} type="button">Limpiar</Button><Button variant="contained" type="submit">Aplicar filtros</Button></Stack>
      </Stack>
    </Paper>
    {dateRangeInvalid && <Alert severity="warning">La fecha inicial debe ser igual o anterior a la fecha final.</Alert>}
    {audit.isLoading && <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}><CircularProgress aria-label="Cargando eventos de auditoría" /></Box>}
    {audit.isError && <Alert action={<Button onClick={() => void audit.refetch()} size="small">Reintentar</Button>} severity="error">No se pudo consultar la auditoría. Revisa la conexión y vuelve a intentar.</Alert>}
    {audit.isSuccess && items.length === 0 && <Paper variant="outlined" sx={{ p: 3 }}><Typography sx={{ fontWeight: 650 }} variant="h6">No hay eventos para estos filtros</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Prueba otro periodo o quita algunos filtros.</Typography></Paper>}
    {audit.isSuccess && items.length > 0 && <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <TableContainer sx={{ maxHeight: 620 }}><Table size="small" stickyHeader><TableHead><TableRow><TableCell>Fecha</TableCell><TableCell>Acción</TableCell><TableCell>Recurso</TableCell><TableCell>Actor</TableCell><TableCell align="right">Detalle</TableCell></TableRow></TableHead>
        <TableBody>{items.map((event) => <TableRow hover key={event.id}><TableCell sx={{ minWidth: 150 }}>{formatDate(event.createdAt)}</TableCell><TableCell sx={{ minWidth: 180 }}><Typography sx={{ fontWeight: 600 }} variant="body2">{actionLabel(event.action)}</Typography><Typography color="text.secondary" variant="caption">{event.action}</Typography></TableCell><TableCell sx={{ minWidth: 180 }}><Typography variant="body2">{event.resourceType}</Typography><Typography color="text.secondary" variant="caption">{event.resourceId ?? "Sin ID"}</Typography></TableCell><TableCell sx={{ minWidth: 220 }}>{actorLabel(event)}</TableCell><TableCell align="right"><Button onClick={() => setSelectedId(event.id)} size="small">Ver detalle</Button></TableCell></TableRow>)}</TableBody>
      </Table></TableContainer>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", p: 1.5 }}><Typography color="text.secondary" variant="body2">{offset + 1}–{Math.min(offset + items.length, audit.data.total)} de {audit.data.total}</Typography><Stack direction="row" spacing={1}><Button disabled={offset === 0} onClick={() => setOffset((current) => Math.max(current - pageSize, 0))}>Anterior</Button><Button disabled={!hasNext} onClick={() => setOffset((current) => current + pageSize)}>Siguiente</Button></Stack></Stack>
    </Paper>}
    <AuditDetailDialog eventId={selectedId} onClose={() => setSelectedId(null)} />
  </Stack>;
}