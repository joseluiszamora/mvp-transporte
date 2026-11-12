import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, AppBar, Avatar, Box, Button, Card, CardContent, CircularProgress,
  Container, Divider, FormControl, IconButton, InputLabel, LinearProgress,
  MenuItem, Paper, Select, Snackbar, Stack, TextField, Toolbar, Tooltip, Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import GroupsRounded from "@mui/icons-material/GroupsRounded";
import BuildRounded from "@mui/icons-material/BuildRounded";
import LocalShippingRounded from "@mui/icons-material/LocalShippingRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import { useSession, type OrganizationOption } from "./session.tsx";
import { VehiclesPage } from "./modules/vehicles/vehicles-page.tsx";
import { StaffPage } from "./modules/operational-staff/staff-page.tsx";
import { ResourcesPage } from "./modules/resources/resources-page.tsx";
import type { BranchOption, CompanyOption } from "@mvp-transporte/shared-contracts";

const companiesKey = ["companies"];

export function App() {
  const { accessToken, restoring, organizations, selectedOrganizationId, userName, selectOrganization, logout, apiRequest } = useSession();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [notice, setNotice] = useState("");
  const companies = useQuery({
    queryKey: companiesKey,
    enabled: Boolean(accessToken && selectedOrganizationId),
    queryFn: async () => (await (await apiRequest("/companies")).json() as { items: CompanyOption[] }).items,
  });
  const activeCompanies = useMemo(() => (companies.data ?? []).filter((company) => company.status === "ACTIVE"), [companies.data]);
  const branches = useQuery({
    queryKey: ["branches", companyId],
    enabled: Boolean(accessToken && companyId),
    queryFn: async () => (await (await apiRequest(`/branches?companyId=${encodeURIComponent(companyId)}`)).json() as { items: BranchOption[] }).items,
  });
  const activeBranches = (branches.data ?? []).filter((branch) => branch.status === "ACTIVE");

  useEffect(() => {
    if (!activeCompanies.length) {
      setCompanyId("");
      return;
    }
    if (!activeCompanies.some((company) => company.id === companyId)) {
      const firstCompany = activeCompanies[0];
      if (firstCompany) setCompanyId(firstCompany.id);
    }
  }, [activeCompanies, companyId]);

  useEffect(() => {
    if (!accessToken) {
      setCompanyId("");
      setBranchId("");
      queryClient.clear();
    }
  }, [accessToken, queryClient]);

  const changeOrganization = (organizationId: string) => {
    setCompanyId("");
    setBranchId("");
    queryClient.clear();
    void selectOrganization(organizationId).catch((error: Error) => setNotice(error.message));
  };

  if (restoring) return <FullPageProgress label="Restaurando sesión…" />;
  if (!accessToken) return <LoginPage />;
  if (!selectedOrganizationId && organizations.length > 0) return <OrganizationPicker organizations={organizations} onChoose={selectOrganization} />;

  return <Box className="page-shell">
    <AppBar position="sticky" color="inherit" elevation={0} className="app-bar">
      <Toolbar sx={{ gap: 2, minHeight: "72px !important" }}>
        <Box className="brand-mark">T</Box>
        <Box sx={{ minWidth: 130, display: { xs: "none", sm: "block" } }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 750, lineHeight: 1.1 }}>Transporte</Typography>
          <Typography variant="caption" color="text.secondary">Administración</Typography>
        </Box>
        <Divider orientation="vertical" flexItem sx={{ my: 1.5, display: { xs: "none", sm: "block" } }} />
        {organizations.length > 1 && <FormControl size="small" sx={{ minWidth: { xs: 110, sm: 200 }, ml: { xs: "auto", sm: 1 } }}>
          <InputLabel id="organization-select-label">Organización</InputLabel>
          <Select labelId="organization-select-label" value={selectedOrganizationId ?? ""} label="Organización" onChange={(event: SelectChangeEvent) => changeOrganization(event.target.value)}>
            {organizations.map((organization) => <MenuItem key={organization.id} value={organization.id}>{organization.name ?? organization.legalName ?? organization.id}</MenuItem>)}
          </Select>
        </FormControl>}
        <FormControl size="small" sx={{ minWidth: { xs: 145, sm: 250 }, ml: { xs: "auto", sm: 1 } }}>
          <InputLabel id="company-select-label">Empresa</InputLabel>
          <Select labelId="company-select-label" value={companyId} label="Empresa" onChange={(event: SelectChangeEvent) => { setCompanyId(event.target.value); setBranchId(""); }}>
            {activeCompanies.map((company) => <MenuItem key={company.id} value={company.id}>{company.tradeName || company.legalName}</MenuItem>)}
          </Select>
        </FormControl>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 150, display: { xs: "none", md: "block" } }}>{userName}</Typography>
        <Tooltip title="Cerrar sesión"><IconButton aria-label="Cerrar sesión" onClick={() => void logout()}><LogoutRounded /></IconButton></Tooltip>
      </Toolbar>
    </AppBar>
    <Container maxWidth="xl" sx={{ py: { xs: 3, md: 5 } }}>
      <Box className="workspace-header">
        <Box>
          <Typography variant="overline" color="primary.main" sx={{ fontWeight: 700, letterSpacing: ".14em" }}>GESTIÓN DE TRANSPORTE</Typography>
          <Typography variant="h4" sx={{ mt: 0.5 }}>Control operativo</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>Administra flota, personal operativo, documentos, mantenimiento y combustible.</Typography>
        </Box>
        <Avatar sx={{ bgcolor: "#e3eee9", color: "primary.dark", width: 48, height: 48 }}>OP</Avatar>
      </Box>
      <Paper variant="outlined" sx={{ overflow: "hidden", borderColor: "#e2e9e5" }}>
        <Box className="nav-row">
          <NavigationLink to="/vehicles" label="Vehículos" icon={<LocalShippingRounded />} />
          <NavigationLink to="/staff" label="Personal operativo" icon={<GroupsRounded />} />
          <NavigationLink to="/resources" label="Recursos" icon={<BuildRounded />} />
        </Box>
        <Divider />
        {companies.isLoading && <LinearProgress />}
        {companies.isError && <Alert severity="error" sx={{ m: 2 }}>No se pudieron cargar las empresas: {companies.error.message}</Alert>}
        {!companies.isLoading && !companies.isError && activeCompanies.length === 0 && <Alert severity="info" sx={{ m: 2 }}>No hay empresas activas en la organización seleccionada.</Alert>}
        {companyId && <Routes>
          <Route path="/vehicles" element={<VehiclesPage companyId={companyId} branchId={branchId} branches={activeBranches} branchesError={branches.error?.message} onBranchChange={setBranchId} onNotice={setNotice} />} />
          <Route path="/staff" element={<StaffPage companyId={companyId} onNotice={setNotice} />} />
          <Route path="/resources" element={<ResourcesPage companyId={companyId} branchId={branchId} branches={activeBranches} branchesError={branches.error?.message} onBranchChange={setBranchId} onNotice={setNotice} />} />
          <Route path="*" element={<Navigate to="/vehicles" replace />} />
        </Routes>}
      </Paper>
      <Box className="footer-note"><Typography variant="caption" color="text.secondary">Datos operativos de Transporte · Identidad y permisos administrados por mvp-base</Typography></Box>
    </Container>
    <Snackbar open={Boolean(notice)} autoHideDuration={6000} onClose={() => setNotice("")} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
      <Alert severity="error" onClose={() => setNotice("")} variant="filled">{notice}</Alert>
    </Snackbar>
  </Box>;
}

function NavigationLink({ to, label, icon }: { to: string; label: string; icon: ReactNode }) {
  const location = useLocation();
  const selected = location.pathname === to;
  return <Button component={Link} to={to} startIcon={icon} className={`nav-link${selected ? " selected" : ""}`}>{label}</Button>;
}

function FullPageProgress({ label }: { label: string }) {
  return <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Stack spacing={2} sx={{ alignItems: "center" }}><CircularProgress /><Typography color="text.secondary">{label}</Typography></Stack></Box>;
}

function LoginPage() {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPending(true);
    try { await login(email, password); } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible iniciar sesión."); }
    finally { setPending(false); }
  };
  return <Box className="login-page">
    <Card className="login-card" sx={{ borderRadius: "20px" }} elevation={0}><CardContent sx={{ p: { xs: 3, sm: 5 } }}><Stack spacing={3}>
      <Box className="brand-mark">T</Box>
      <Box><Typography variant="h5">Ingresa a Transporte</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>Usa tu cuenta administrada en mvp-base.</Typography></Box>
      <form onSubmit={(event) => void submit(event)}><Stack spacing={2.2}>
        <TextField label="Correo electrónico" autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required fullWidth />
        <TextField label="Contraseña" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required fullWidth />
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" variant="contained" size="large" disabled={pending}>{pending ? "Validando…" : "Iniciar sesión"}</Button>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>La sesión se valida en mvp-base para cada operación.</Typography>
      </Stack></form>
    </Stack></CardContent></Card>
  </Box>;
}

function OrganizationPicker({ organizations, onChoose }: { organizations: OrganizationOption[]; onChoose: (id: string) => Promise<void> }) {
  const [organizationId, setOrganizationId] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const choose = async () => {
    setError("");
    setPending(true);
    try { await onChoose(organizationId); } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible seleccionar la organización."); }
    finally { setPending(false); }
  };
  return <Box className="login-page"><Card className="login-card" elevation={0}><CardContent sx={{ p: { xs: 3, sm: 5 } }}><Stack spacing={3}>
    <Box className="brand-mark">T</Box><Box><Typography variant="h5">Selecciona una organización</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>El contexto define las empresas y los permisos disponibles.</Typography></Box>
    <FormControl fullWidth><InputLabel id="organization-label">Organización</InputLabel><Select labelId="organization-label" value={organizationId} label="Organización" onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((organization) => <MenuItem key={organization.id} value={organization.id}>{organization.name ?? organization.legalName ?? organization.id}</MenuItem>)}</Select></FormControl>
    {error && <Alert severity="error">{error}</Alert>}
    <Button variant="contained" size="large" disabled={!organizationId || pending} onClick={() => void choose()}>{pending ? "Cargando…" : "Continuar"}</Button>
  </Stack></CardContent></Card></Box>;
}
