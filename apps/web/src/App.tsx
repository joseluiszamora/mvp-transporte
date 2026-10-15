import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  CssBaseline,
  Divider,
  Drawer,
  FormControl,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import type { HealthResponse, ReadinessResponse } from "@mvp-transporte/contracts";
import { ActivationPage, LoginPage, RecoveryCompletePage, RecoveryRequestPage } from "./features/auth/AuthPages";
import { getApiBaseUrl } from "./features/auth/auth-client";
import { AuthProvider, useAuth } from "./features/auth/AuthContext";
import { CreateOrganizationPage } from "./features/organizations/CreateOrganizationPage";
import { PlatformOrganizationsPage } from "./features/organizations/PlatformOrganizationsPage";
import { TenantOrganizationsPage } from "./features/organizations/TenantOrganizationsPage";
import { UsersPage } from "./features/users/UsersPage";
import { RolesPage } from "./features/roles/RolesPage";

const drawerWidth = 272;
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

const modules = [
  { code: "ADM-01", name: "Empresas y sucursales" },
  { code: "ADM-02", name: "Usuarios" },
  { code: "ADM-03", name: "Autenticación" },
  { code: "ADM-04", name: "Roles y permisos" },
  { code: "ADM-05", name: "Personal" },
  { code: "ADM-06", name: "Configuración" },
  { code: "ADM-07", name: "Auditoría" },
  { code: "ADM-08", name: "Archivos privados" },
  { code: "ADM-09", name: "Correo" },
  { code: "ADM-10", name: "Catálogos" },
];

async function fetchPublicJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`);
  if (!response.ok) {
    throw new Error("La API no respondió correctamente.");
  }
  return (await response.json()) as T;
}

function ApiStatusCard(): React.JSX.Element {
  const health = useQuery({ queryKey: ["api", "health"], queryFn: () => fetchPublicJson<HealthResponse>("/health"), refetchInterval: 30_000 });
  const readiness = useQuery({ queryKey: ["api", "readiness"], queryFn: () => fetchPublicJson<ReadinessResponse>("/ready"), refetchInterval: 30_000 });
  return (
    <Card variant="outlined" sx={{ height: "100%" }}><CardContent>
      <Typography color="text.secondary" variant="overline">Estado del servicio</Typography>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <StatusLine label="API" isLoading={health.isLoading} isHealthy={health.isSuccess && health.data.status === "ok"} error={health.isError} />
        <StatusLine label="Base de datos" isLoading={readiness.isLoading} isHealthy={readiness.isSuccess && readiness.data.status === "ready"} error={readiness.isError || readiness.data?.status === "not_ready"} />
      </Stack>
      {(health.isError || readiness.isError) && <Alert severity="warning" sx={{ mt: 2 }}>No fue posible consultar el estado completo. Comprueba que la API y PostgreSQL estén iniciados.</Alert>}
    </CardContent></Card>
  );
}

function StatusLine({ label, isLoading, isHealthy, error }: { label: string; isLoading: boolean; isHealthy: boolean; error: boolean }): React.JSX.Element {
  if (isLoading) {
    return <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><CircularProgress aria-label={`Consultando ${label}`} size={16} /><Typography variant="body2">Consultando {label.toLocaleLowerCase("es-BO")}…</Typography></Stack>;
  }
  return <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
    <Typography variant="body2">{label}</Typography>
    <Chip color={isHealthy ? "success" : error ? "warning" : "default"} label={isHealthy ? "Disponible" : error ? "Sin conexión" : "No confirmado"} size="small" variant={isHealthy ? "filled" : "outlined"} />
  </Stack>;
}

function NavigationContent({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const items = [
    { label: "Resumen", path: "/" },
    ...(user?.permissions.includes("users.read") ? [{ label: "ADM-02 · Usuarios", path: "/modules/ADM-02" }] : []),
    ...(user?.permissions.includes("roles.read") ? [{ label: "ADM-04 · Roles y permisos", path: "/modules/ADM-04" }] : []),
    ...(user?.platformAdmin ? [{ label: "Organizaciones de plataforma", path: "/platform/organizations" }] : []),
    ...(user?.platformAdmin ? [{ label: "Nueva organización", path: "/platform/organizations/new" }] : []),
    ...modules.filter((module) => module.code !== "ADM-02" && module.code !== "ADM-04").map((module) => ({ label: `${module.code} · ${module.name}`, path: `/modules/${module.code}` })),
  ];
  return (
    <Box component="nav" aria-label="Navegación principal" sx={{ px: 1.5, py: 2 }}>
      <Typography color="text.secondary" sx={{ px: 1.5, pb: 1 }} variant="overline">ADMINISTRACIÓN</Typography>
      <List disablePadding>
        {items.map((item) => {
          const selected = location.pathname === item.path;
          return <ListItemButton aria-current={selected ? "page" : undefined} key={item.path} onClick={() => { navigate(item.path); onNavigate?.(); }} selected={selected} sx={{ borderRadius: 2, mb: 0.5 }}>
            <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: selected ? 650 : 450 } } }} />
          </ListItemButton>;
        })}
      </List>
      <Divider sx={{ my: 2 }} />
      <Typography color="text.secondary" sx={{ px: 1.5 }} variant="caption">Sesión verificada en cada solicitud</Typography>
    </Box>
  );
}

function Dashboard(): React.JSX.Element {
  const { user } = useAuth();
  const selectedOrganization = user?.organizations.find((item) => item.id === user.selectedOrganizationId);
  return (
    <Stack spacing={3}>
      <Box><Typography color="text.secondary" variant="overline">INICIO</Typography><Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">Resumen</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>Bienvenido, {user?.displayName}.</Typography></Box>
      {!selectedOrganization && !user?.platformAdmin && <Alert severity="info">Tu cuenta no tiene una membresía activa seleccionada. Contacta a la administración de tu organización.</Alert>}
      {selectedOrganization && <Card variant="outlined"><CardContent><Typography color="text.secondary" variant="overline">ORGANIZACIÓN ACTIVA</Typography><Typography variant="h6">{selectedOrganization.name}</Typography></CardContent></Card>}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
        <Paper component="section" variant="outlined" sx={{ flex: "1 1 220px", p: 2.5 }}><Typography color="text.secondary" variant="overline">PLATAFORMA</Typography><Typography sx={{ fontWeight: 700, mt: 0.5 }} variant="h5">Base administrativa</Typography><Typography color="text.secondary" variant="body2">Instalación independiente para organizaciones y empresas.</Typography></Paper>
        <Box sx={{ flex: "2 1 360px", minWidth: 0 }}><ApiStatusCard /></Box>
      </Box>
      <Box component="section" aria-labelledby="modules-heading"><Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 1.5 }}><Typography component="h2" id="modules-heading" variant="h6">Módulos</Typography><Chip label="En implementación" size="small" variant="outlined" /></Stack><Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>{modules.map((module) => { const available = (module.code === "ADM-01" && (user?.permissions.includes("companies.read") || user?.permissions.includes("branches.read"))) || (module.code === "ADM-02" && user?.permissions.includes("users.read")) || (module.code === "ADM-04" && user?.permissions.includes("roles.read")); return <Card key={module.code} variant="outlined" sx={{ flex: "1 1 220px" }}><CardContent><Typography color="text.secondary" variant="overline">{module.code}</Typography><Typography sx={{ fontWeight: 600 }} variant="body1">{module.name}</Typography><Chip label={available ? "Disponible" : "En preparación"} color={available ? "success" : "default"} size="small" sx={{ mt: 1.5 }} variant="outlined" /></CardContent></Card>; })}</Box></Box>
    </Stack>
  );
}

function ModulePage(): React.JSX.Element {
  const { moduleCode } = useParams();
  const module = modules.find((item) => item.code === moduleCode);
  if (!module) return <Alert severity="warning">No encontramos el módulo solicitado.</Alert>;
  if (module.code === "ADM-01") return <TenantOrganizationsPage />;
  if (module.code === "ADM-02") return <UsersPage />;
  if (module.code === "ADM-04") return <RolesPage />;
  return <Stack spacing={2}><Box><Typography color="text.secondary" variant="overline">{module.code}</Typography><Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">{module.name}</Typography></Box><Alert severity="info">Este módulo está pendiente de implementación.</Alert><Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}><Typography sx={{ fontWeight: 600 }} variant="h6">Aún no hay contenido disponible</Typography><Typography color="text.secondary" sx={{ mt: 0.75 }}>Las funciones de {module.name.toLocaleLowerCase("es-BO")} aparecerán cuando se complete su tarea.</Typography></Paper></Stack>;
}

function AuthenticatedApplication({ mode, onToggleMode }: { mode: "light" | "dark"; onToggleMode: () => void }): React.JSX.Element {
  const { status, user, logout, selectOrganization } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [organizationError, setOrganizationError] = useState("");
  if (status === "loading") return <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><CircularProgress aria-label="Restaurando sesión" /></Box>;
  if (status === "anonymous" || !user) return <LoginPage />;
  const drawerContent = <NavigationContent onNavigate={() => setMobileOpen(false)} />;
  return <>
    <AppBar color="inherit" elevation={0} position="fixed" sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar sx={{ gap: 2 }}>
        <Button aria-label="Abrir menú" onClick={() => setMobileOpen(true)} sx={{ display: { md: "none" }, minWidth: 0 }}>Menú</Button>
        <Box sx={{ flexGrow: 1, minWidth: 120 }}><Typography color="text.secondary" variant="caption">PLATAFORMA ADMINISTRATIVA</Typography><Typography sx={{ fontWeight: 650, lineHeight: 1.2 }} variant="subtitle1">Base administrativa</Typography></Box>
        {user.organizations.length > 0 && <FormControl size="small" sx={{ minWidth: { xs: 145, sm: 220 } }}><Select aria-label="Organización activa" value={user.selectedOrganizationId ?? ""} onChange={(event) => { setOrganizationError(""); void selectOrganization(event.target.value).catch((error: unknown) => setOrganizationError(error instanceof Error ? error.message : "No se pudo cambiar de organización.")); }}><MenuItem disabled value="">Seleccionar organización</MenuItem>{user.organizations.map((organization) => <MenuItem key={organization.id} value={organization.id}>{organization.name}</MenuItem>)}</Select></FormControl>}
        <Button onClick={onToggleMode} sx={{ display: { xs: "none", sm: "inline-flex" } }} variant="outlined">{mode === "light" ? "Modo oscuro" : "Modo claro"}</Button>
        <Button onClick={() => { void logout().finally(() => navigate("/login", { replace: true })); }} variant="text">Salir</Button>
      </Toolbar>
    </AppBar>
    {isWide ? <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box", top: 64, borderRight: 1, borderColor: "divider" } }}>{drawerContent}</Drawer> : <Drawer ModalProps={{ keepMounted: true }} onClose={() => setMobileOpen(false)} open={mobileOpen} sx={{ "& .MuiDrawer-paper": { width: drawerWidth, maxWidth: "85vw" } }} variant="temporary">{drawerContent}</Drawer>}
    <Box component="main" sx={{ ml: { md: `${drawerWidth}px` }, minHeight: "100vh", px: { xs: 2, sm: 3, lg: 4 }, pb: 5, pt: { xs: 11, md: 12 } }}>
      <Box sx={{ mx: "auto", maxWidth: 1320 }}>
        {organizationError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setOrganizationError("")}>{organizationError}</Alert>}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/modules/:moduleCode" element={<ModulePage />} />
          <Route path="/platform/organizations" element={<PlatformOrganizationsPage />} />
          <Route path="/platform/organizations/new" element={<CreateOrganizationPage />} />
          <Route path="*" element={<Stack spacing={2}><Alert severity="warning">No encontramos la página solicitada.</Alert><Button component={Link} to="/">Volver al resumen</Button></Stack>} />
        </Routes>
      </Box>
    </Box>
  </>;
}

function ApplicationRoutes({ mode, onToggleMode }: { mode: "light" | "dark"; onToggleMode: () => void }): React.JSX.Element {
  const location = useLocation();
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/activate" element={<ActivationPage />} />
    <Route path="/recover" element={<RecoveryRequestPage />} />
    <Route path="/recover/complete" element={<RecoveryCompletePage />} />
    <Route path="*" element={<AuthenticatedApplication key={`${location.pathname}:${mode}`} mode={mode} onToggleMode={onToggleMode} />} />
  </Routes>;
}

export function App(): React.JSX.Element {
  const [mode, setMode] = useState<"light" | "dark">("light");
  const theme = useMemo(() => createTheme({
    palette: { mode, primary: { main: mode === "light" ? "#0f766e" : "#5eead4" }, background: { default: mode === "light" ? "#f5f8f7" : "#101716", paper: mode === "light" ? "#ffffff" : "#18211f" } },
    shape: { borderRadius: 12 },
    typography: { fontFamily: '"Inter", "Segoe UI", "Roboto", sans-serif' },
  }), [mode]);
  return <ThemeProvider theme={theme}><CssBaseline /><QueryClientProvider client={queryClient}><AuthProvider><BrowserRouter><ApplicationRoutes mode={mode} onToggleMode={() => setMode((current) => current === "light" ? "dark" : "light")} /></BrowserRouter></AuthProvider></QueryClientProvider></ThemeProvider>;
}
