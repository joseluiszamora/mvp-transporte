import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import type { EmailDeliverySummary, InstallationSmtpSettings } from "@mvp-transporte/contracts";
import { getInstallationSmtpSettings, getNotificationAccess, listEmailDeliveries, listEmailTemplates, saveInstallationSmtpSettings, sendSmtpTest } from "../auth/auth-client";
import { useAuth } from "../auth/AuthContext";

const pageSize = 20;
const dateFormatter = new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", dateStyle: "medium", timeStyle: "short" });
interface SettingsForm { host: string; port: string; secure: boolean; requireTls: boolean; fromAddress: string; username: string; password: string; clearPassword: boolean; }
const emptySettings: SettingsForm = { host: "", port: "587", secure: false, requireTls: false, fromAddress: "", username: "", password: "", clearPassword: false };
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Fecha no disponible" : dateFormatter.format(date); }
function dateBoundary(value: string, end: boolean): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}-04:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function settingsForm(item: InstallationSmtpSettings): SettingsForm {
  return { host: item.host, port: String(item.port), secure: item.secure, requireTls: item.requireTls, fromAddress: item.fromAddress, username: item.username, password: "", clearPassword: false };
}

export function NotificationsPage(): React.JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isPlatformAdmin = Boolean(user?.platformAdmin);
  const access = useQuery({ queryKey: ["notifications", "access", user?.selectedOrganizationId], queryFn: getNotificationAccess, enabled: Boolean(user) });
  const canReadHistory = Boolean(access.data?.canReadHistory);
  const [form, setForm] = useState<SettingsForm>(emptySettings);
  const [recipient, setRecipient] = useState("");
  const [outcome, setOutcome] = useState("");
  const [templateCode, setTemplateCode] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filters, setFilters] = useState({ outcome: "", templateCode: "", fromDate: "", toDate: "" });
  const [offset, setOffset] = useState(0);
  const smtp = useQuery({ queryKey: ["notifications", "smtp"], queryFn: getInstallationSmtpSettings, enabled: isPlatformAdmin });
  const templates = useQuery({ queryKey: ["notifications", "templates"], queryFn: listEmailTemplates, enabled: canReadHistory });
  const deliveries = useQuery({
    queryKey: ["notifications", "deliveries", filters, offset],
    queryFn: () => listEmailDeliveries({ limit: pageSize, offset, outcome: filters.outcome === "SENT" || filters.outcome === "FAILED" ? filters.outcome : undefined, templateCode: filters.templateCode || undefined, from: dateBoundary(filters.fromDate, false), to: dateBoundary(filters.toDate, true) }),
    enabled: canReadHistory,
  });
  useEffect(() => { if (smtp.data) setForm(settingsForm(smtp.data)); }, [smtp.data]);

  const save = useMutation({
    mutationFn: () => saveInstallationSmtpSettings({
      host: form.host.trim(), port: Number(form.port), secure: form.secure, requireTls: form.requireTls,
      fromAddress: form.fromAddress.trim(), username: form.username.trim() || null,
      ...(form.password ? { password: form.password } : {}), ...(form.clearPassword ? { clearPassword: true } : {}),
    }),
    onSuccess: async (result) => { setForm(settingsForm(result)); await queryClient.invalidateQueries({ queryKey: ["notifications", "smtp"] }); },
  });
  const test = useMutation({ mutationFn: () => sendSmtpTest(recipient.trim()) });

  if (access.isLoading && !isPlatformAdmin) return <CircularProgress aria-label="Verificando acceso al módulo de correo" />;
  if (access.isError && !isPlatformAdmin) return <Alert action={<Button onClick={() => void access.refetch()} size="small">Reintentar</Button>} severity="error">No se pudo verificar el acceso al módulo de correo.</Alert>;
  if (!isPlatformAdmin && !canReadHistory) return <Alert severity="warning">El historial requiere `notifications.read` a nivel de organización. Un permiso limitado a empresa o sucursal no concede acceso a estos registros.</Alert>;
  const deliveryItems: EmailDeliverySummary[] = deliveries.data?.items ?? [];
  const hasNext = deliveries.data ? offset + deliveries.data.limit < deliveries.data.total : false;
  const preservedPassword = Boolean(smtp.data?.passwordConfigured && form.username.trim() === smtp.data.username);
  const passwordRequired = Boolean(form.username.trim()) && !preservedPassword && !form.password;

  return <Stack spacing={2.5}>
    <Box><Typography color="text.secondary" variant="overline">ADM-09</Typography><Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">Administración de correo</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Configura el SMTP de la instalación y consulta resultados de entrega dentro de tu organización.</Typography></Box>

    {isPlatformAdmin && <Paper component="form" variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }} onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <Stack spacing={2}><Box><Typography component="h2" sx={{ fontWeight: 650 }} variant="h6">Servidor SMTP de la instalación</Typography><Typography color="text.secondary" variant="body2">La contraseña se guarda cifrada y nunca vuelve al navegador. Déjala vacía para conservarla.</Typography></Box>
        {smtp.isLoading && <CircularProgress aria-label="Cargando configuración SMTP" size={24} />}
        {smtp.isError && <Alert action={<Button onClick={() => void smtp.refetch()} size="small">Reintentar</Button>} severity="error">No se pudo consultar la configuración SMTP.</Alert>}
        {smtp.data && <>
          <Alert severity={smtp.data.configured ? "info" : "warning"}>{smtp.data.source === "DATABASE" ? "Configuración guardada en la base de datos." : smtp.data.source === "ENVIRONMENT" ? "Se usa la configuración del entorno hasta que guardes una configuración de instalación." : "SMTP aún no está configurado."}{smtp.data.passwordConfigured ? " Hay una contraseña configurada." : ""}</Alert>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" }, gap: 1.5 }}>
            <TextField label="Host" required value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} />
            <TextField slotProps={{ htmlInput: { min: 1, max: 65535 } }} label="Puerto" required type="number" value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} />
            <TextField label="Dirección remitente" required value={form.fromAddress} onChange={(event) => setForm({ ...form, fromAddress: event.target.value })} />
            <TextField autoComplete="username" label="Usuario SMTP (opcional)" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value, requireTls: form.secure ? false : event.target.value.trim() ? true : form.requireTls })} />
            <TextField autoComplete="new-password" label="Contraseña SMTP" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
              <FormControlLabel control={<Checkbox checked={form.secure} onChange={(event) => setForm({ ...form, secure: event.target.checked, requireTls: event.target.checked ? false : form.requireTls })} />} label="TLS implícito" />
              <FormControlLabel control={<Checkbox checked={form.requireTls} disabled={form.secure} onChange={(event) => setForm({ ...form, requireTls: event.target.checked })} />} label="Exigir STARTTLS" />
            </Box>
          </Box>
          {smtp.data.passwordConfigured && <FormControlLabel control={<Checkbox checked={form.clearPassword} onChange={(event) => setForm({ ...form, clearPassword: event.target.checked, username: event.target.checked ? "" : form.username, password: "" })} />} label="Quitar usuario y contraseña SMTP" />}
          {passwordRequired && <Alert severity="info">Al configurar autenticación SMTP, ingresa la contraseña. Un campo vacío conserva una contraseña existente.</Alert>}
          {save.isError && <Alert severity="error">{save.error instanceof Error ? save.error.message : "No se pudo guardar la configuración."}</Alert>}
          {save.isSuccess && <Alert severity="success">Configuración SMTP guardada.</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
            <Button disabled={save.isPending || passwordRequired || !form.host.trim() || !form.fromAddress.trim() || !Number.isInteger(Number(form.port))} type="submit" variant="contained">{save.isPending ? "Guardando…" : "Guardar configuración"}</Button>
            <TextField autoComplete="email" label="Enviar prueba a" size="small" type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} />
            <Button disabled={!smtp.data.configured || !recipient.includes("@") || test.isPending} onClick={() => test.mutate()} variant="outlined">{test.isPending ? "Enviando…" : "Enviar correo de prueba"}</Button>
          </Stack>
          {test.isError && <Alert severity="error">{test.error instanceof Error ? test.error.message : "No se pudo enviar el correo de prueba."}</Alert>}
          {test.isSuccess && <Alert severity="success">Correo de prueba entregado al servidor SMTP.</Alert>}
          {smtp.data.source === "ENVIRONMENT" && <Typography color="text.secondary" variant="caption">Al guardar, la configuración pasa a almacenarse en la base de datos. La contraseña del entorno se conservará si mantienes el mismo usuario y el servidor tiene disponible SMTP_SETTINGS_ENCRYPTION_KEY.</Typography>}
        </>}
      </Stack>
    </Paper>}

    {canReadHistory && <>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}><Stack spacing={1.5}>
        <Box><Typography component="h2" sx={{ fontWeight: 650 }} variant="h6">Plantillas del sistema</Typography><Typography color="text.secondary" variant="body2">Activación, invitación, recuperación de contraseña y aviso de cambio. Las plantillas transaccionales se administran con el código de la aplicación.</Typography></Box>
        {templates.isLoading && <CircularProgress aria-label="Cargando plantillas" size={24} />}
        {templates.isError && <Alert action={<Button onClick={() => void templates.refetch()} size="small">Reintentar</Button>} severity="error">No se pudieron consultar las plantillas.</Alert>}
        {templates.data?.items.length === 0 && <Typography color="text.secondary">No hay plantillas disponibles.</Typography>}
        {templates.data?.items.map((item) => <Stack key={item.code} direction={{ xs: "column", sm: "row" }} sx={{ justifyContent: "space-between", borderBottom: 1, borderColor: "divider", py: 1 }}><Typography sx={{ fontWeight: 600 }}>{item.subject}</Typography><Typography color="text.secondary" variant="body2">{item.code} · {item.status === "ACTIVE" ? "Activa" : "Inactiva"}</Typography></Stack>)}
      </Stack></Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}><Stack spacing={1.5}>
        <Box><Typography component="h2" sx={{ fontWeight: 650 }} variant="h6">Historial de entrega</Typography><Typography color="text.secondary" variant="body2">Solo incluye correo de tu organización. No muestra destinatarios, contenido ni secretos SMTP.</Typography></Box>
        <Box component="form" onSubmit={(event) => { event.preventDefault(); setOffset(0); setFilters({ outcome, templateCode, fromDate, toDate }); }} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }, gap: 1.5 }}>
          <TextField label="Resultado" onChange={(event) => setOutcome(event.target.value)} select size="small" value={outcome}><MenuItem value="">Todos</MenuItem><MenuItem value="SENT">Enviado</MenuItem><MenuItem value="FAILED">Fallido</MenuItem></TextField>
          <TextField label="Plantilla" onChange={(event) => setTemplateCode(event.target.value)} select size="small" value={templateCode}><MenuItem value="">Todas</MenuItem>{(templates.data?.items ?? []).map((item) => <MenuItem key={item.code} value={item.code}>{item.subject}</MenuItem>)}</TextField>
          <TextField label="Desde" onChange={(event) => setFromDate(event.target.value)} size="small" type="date" value={fromDate} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Hasta" onChange={(event) => setToDate(event.target.value)} size="small" type="date" value={toDate} slotProps={{ inputLabel: { shrink: true } }} />
          <Button sx={{ gridColumn: { sm: "1 / -1" }, justifySelf: "end" }} type="submit" variant="outlined">Aplicar filtros</Button>
        </Box>
        {deliveries.isLoading && <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}><CircularProgress aria-label="Cargando historial de correo" /></Box>}
        {deliveries.isError && <Alert action={<Button onClick={() => void deliveries.refetch()} size="small">Reintentar</Button>} severity="error">No se pudo consultar el historial de entrega.</Alert>}
        {deliveries.isSuccess && deliveryItems.length === 0 && <Typography color="text.secondary" sx={{ py: 2 }}>No hay entregas para estos filtros.</Typography>}
        {deliveries.isSuccess && deliveryItems.length > 0 && <><TableContainer><Table size="small"><TableHead><TableRow><TableCell>Fecha</TableCell><TableCell>Plantilla</TableCell><TableCell>Intento</TableCell><TableCell>Resultado</TableCell><TableCell>Código de error</TableCell></TableRow></TableHead><TableBody>{deliveryItems.map((item) => <TableRow hover key={item.id}><TableCell>{formatDate(item.createdAt)}</TableCell><TableCell>{item.templateCode}</TableCell><TableCell>{item.attempt}</TableCell><TableCell>{item.outcome === "SENT" ? "Enviado" : "Fallido"}</TableCell><TableCell>{item.errorCode ?? "—"}</TableCell></TableRow>)}</TableBody></Table></TableContainer>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}><Typography color="text.secondary" variant="body2">{offset + 1}–{Math.min(offset + deliveryItems.length, deliveries.data.total)} de {deliveries.data.total}</Typography><Stack direction="row" spacing={1}><Button disabled={offset === 0} onClick={() => setOffset((current) => Math.max(0, current - pageSize))}>Anterior</Button><Button disabled={!hasNext} onClick={() => setOffset((current) => current + pageSize)}>Siguiente</Button></Stack></Stack></>}
      </Stack></Paper>
    </>}
  </Stack>;
}
