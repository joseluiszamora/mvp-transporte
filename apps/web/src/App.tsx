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
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { BrowserRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import type { HealthResponse, ReadinessResponse } from "@mvp-transporte/contracts";

const drawerWidth = 272;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});

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

function getApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
  return configuredUrl.replace(/\/+$/u, "");
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`);
  if (!response.ok) {
    throw new Error("La API no respondió correctamente.");
  }
  return (await response.json()) as T;
}

function ApiStatusCard(): React.JSX.Element {
  const health = useQuery({
    queryKey: ["api", "health"],
    queryFn: () => fetchJson<HealthResponse>("/health"),
    refetchInterval: 30_000,
  });
  const readiness = useQuery({
    queryKey: ["api", "readiness"],
    queryFn: () => fetchJson<ReadinessResponse>("/ready"),
    refetchInterval: 30_000,
  });

  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Typography color="text.secondary" variant="overline">
          Estado del servicio
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <StatusLine
            label="API"
            isLoading={health.isLoading}
            isHealthy={health.isSuccess && health.data.status === "ok"}
            error={health.isError}
          />
          <StatusLine
            label="Base de datos"
            isLoading={readiness.isLoading}
            isHealthy={readiness.isSuccess && readiness.data.status === "ready"}
            error={readiness.isError || readiness.data?.status === "not_ready"}
          />
        </Stack>
        {(health.isError || readiness.isError) && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            No fue posible consultar el estado completo. Comprueba que la API y PostgreSQL estén iniciados.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

interface StatusLineProps {
  label: string;
  isLoading: boolean;
  isHealthy: boolean;
  error: boolean;
}

function StatusLine({ label, isLoading, isHealthy, error }: StatusLineProps): React.JSX.Element {
  if (isLoading) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <CircularProgress aria-label={`Consultando ${label}`} size={16} />
        <Typography variant="body2">Consultando {label.toLocaleLowerCase("es-BO")}…</Typography>
      </Stack>
    );
  }

  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
      <Typography variant="body2">{label}</Typography>
      <Chip
        color={isHealthy ? "success" : error ? "warning" : "default"}
        label={isHealthy ? "Disponible" : error ? "Sin conexión" : "No confirmado"}
        size="small"
        variant={isHealthy ? "filled" : "outlined"}
      />
    </Stack>
  );
}

function NavigationContent({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const items = [
    { label: "Resumen", path: "/" },
    ...modules.map((module) => ({
      label: `${module.code} · ${module.name}`,
      path: `/modules/${module.code}`,
    })),
  ];

  return (
    <Box component="nav" aria-label="Navegación principal" sx={{ px: 1.5, py: 2 }}>
      <Typography color="text.secondary" sx={{ px: 1.5, pb: 1 }} variant="overline">
        ADMINISTRACIÓN
      </Typography>
      <List disablePadding>
        {items.map((item) => {
          const selected = location.pathname === item.path;
          return (
            <ListItemButton
              aria-current={selected ? "page" : undefined}
              key={item.path}
              onClick={() => {
                navigate(item.path);
                onNavigate?.();
              }}
              selected={selected}
              sx={{ borderRadius: 2, mb: 0.5 }}
            >
              <ListItemText
                primary={item.label}
                slotProps={{
                  primary: { sx: { fontSize: 14, fontWeight: selected ? 650 : 450 } },
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
      <Divider sx={{ my: 2 }} />
      <Typography color="text.secondary" sx={{ px: 1.5 }} variant="caption">
        Base fundacional · TASK-001
      </Typography>
    </Box>
  );
}

function Dashboard(): React.JSX.Element {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography color="text.secondary" variant="overline">
          INICIO
        </Typography>
        <Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">
          Resumen
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Base administrativa independiente para organizaciones, empresas y sucursales.
        </Typography>
      </Box>

      <Alert severity="info">
        Esta entrega prepara la plataforma. Los módulos y el inicio de sesión se habilitarán en sus tareas correspondientes.
      </Alert>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
        <Paper component="section" variant="outlined" sx={{ flex: "1 1 220px", p: 2.5 }}>
          <Typography color="text.secondary" variant="overline">
            ALCANCE PLANIFICADO
          </Typography>
          <Typography sx={{ fontWeight: 700, mt: 0.5 }} variant="h4">
            10 módulos
          </Typography>
          <Typography color="text.secondary" variant="body2">
            La base no incluye operaciones de distribución ni transporte.
          </Typography>
        </Paper>
        <Box sx={{ flex: "2 1 360px", minWidth: 0 }}>
          <ApiStatusCard />
        </Box>
      </Box>

      <Box component="section" aria-labelledby="modules-heading">
        <Stack
          direction="row"
          sx={{ alignItems: "baseline", justifyContent: "space-between", mb: 1.5 }}
        >
          <Typography component="h2" id="modules-heading" variant="h6">
            Módulos previstos
          </Typography>
          <Chip label="En preparación" size="small" variant="outlined" />
        </Stack>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          {modules.map((module) => (
            <Card key={module.code} variant="outlined" sx={{ flex: "1 1 220px" }}>
              <CardContent>
                <Typography color="text.secondary" variant="overline">
                  {module.code}
                </Typography>
                <Typography sx={{ fontWeight: 600 }} variant="body1">
                  {module.name}
                </Typography>
                <Chip label="Pendiente" size="small" sx={{ mt: 1.5 }} variant="outlined" />
              </CardContent>
            </Card>
          ))}
        </Box>
      </Box>
    </Stack>
  );
}

function ModulePage(): React.JSX.Element {
  const { moduleCode } = useParams();
  const module = modules.find((item) => item.code === moduleCode);

  if (!module) {
    return <NotFound />;
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography color="text.secondary" variant="overline">
          {module.code}
        </Typography>
        <Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">
          {module.name}
        </Typography>
      </Box>
      <Alert severity="info">Este módulo está pendiente de implementación.</Alert>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography sx={{ fontWeight: 600 }} variant="h6">
          Aún no hay contenido disponible
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
          Aquí aparecerán las funciones de {module.name.toLocaleLowerCase("es-BO")} cuando se complete su tarea.
        </Typography>
      </Paper>
    </Stack>
  );
}

function NotFound(): React.JSX.Element {
  return (
    <Alert severity="warning">
      No encontramos la página solicitada. Vuelve al resumen para continuar.
    </Alert>
  );
}

function AppFrame({ mode, onToggleMode }: { mode: "light" | "dark"; onToggleMode: () => void }): React.JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("md"));
  const drawerContent = <NavigationContent onNavigate={() => setMobileOpen(false)} />;

  return (
    <>
      <AppBar color="inherit" elevation={0} position="fixed" sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 2 }}>
          <Button
            aria-label="Abrir menú"
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: "none" }, minWidth: 0 }}
          >
            Menú
          </Button>
          <Box sx={{ flexGrow: 1 }}>
            <Typography color="text.secondary" variant="caption">
              PLATAFORMA ADMINISTRATIVA
            </Typography>
            <Typography sx={{ fontWeight: 650, lineHeight: 1.2 }} variant="subtitle1">
              Base administrativa
            </Typography>
          </Box>
          <Button onClick={onToggleMode} variant="outlined">
            {mode === "light" ? "Modo oscuro" : "Modo claro"}
          </Button>
        </Toolbar>
      </AppBar>

      {isWide ? (
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
              top: 64,
              borderRight: 1,
              borderColor: "divider",
            },
          }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          ModalProps={{ keepMounted: true }}
          onClose={() => setMobileOpen(false)}
          open={mobileOpen}
          sx={{ "& .MuiDrawer-paper": { width: drawerWidth, maxWidth: "85vw" } }}
          variant="temporary"
        >
          {drawerContent}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          ml: { md: `${drawerWidth}px` },
          minHeight: "100vh",
          px: { xs: 2, sm: 3, lg: 4 },
          pb: 5,
          pt: { xs: 11, md: 12 },
        }}
      >
        <Box sx={{ mx: "auto", maxWidth: 1320 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/modules/:moduleCode" element={<ModulePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Box>
      </Box>
    </>
  );
}

export function App(): React.JSX.Element {
  const [mode, setMode] = useState<"light" | "dark">("light");
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: { main: mode === "light" ? "#0f766e" : "#5eead4" },
          background: {
            default: mode === "light" ? "#f5f8f7" : "#101716",
            paper: mode === "light" ? "#ffffff" : "#18211f",
          },
        },
        shape: { borderRadius: 12 },
        typography: {
          fontFamily: '"Inter", "Segoe UI", "Roboto", sans-serif',
        },
      }),
    [mode],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppFrame mode={mode} onToggleMode={() => setMode((current) => (current === "light" ? "dark" : "light"))} />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
