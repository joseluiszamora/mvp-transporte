import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Link as MuiLink,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { AccountTokenInspectionResponse } from "@mvp-transporte/contracts";
import { AuthClientError, completeActivation, completeRecovery, inspectActivation, requestRecovery } from "./auth-client";
import { useAuth } from "./AuthContext";

function AuthCard({ title, children }: React.PropsWithChildren<{ title: string }>): React.JSX.Element {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2, bgcolor: "background.default" }}>
      <Card variant="outlined" sx={{ width: "min(100%, 440px)", borderRadius: 3 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography color="primary.main" variant="overline">BASE ADMINISTRATIVA</Typography>
          <Typography component="h1" variant="h5" sx={{ fontWeight: 700, mb: 2.5 }}>{title}</Typography>
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}

function errorText(error: unknown): string {
  if (error instanceof AuthClientError && error.status === 401) {
    return "Correo o contraseña no válidos.";
  }
  if (error instanceof AuthClientError && error.status === 429) {
    return "Se alcanzó el límite de intentos. Espera antes de continuar.";
  }
  return error instanceof AuthClientError ? error.message : "No fue posible completar la solicitud.";
}

export function LoginPage(): React.JSX.Element {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Iniciar sesión">
      <Stack component="form" spacing={2} onSubmit={(event) => void submit(event)}>
        <Typography color="text.secondary" variant="body2">Usa el correo y la contraseña de tu cuenta.</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField autoComplete="username" label="Correo electrónico" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
        <TextField autoComplete="current-password" label="Contraseña" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
        <Button disabled={busy} type="submit" variant="contained" size="large">
          {busy ? <CircularProgress color="inherit" size={22} /> : "Entrar"}
        </Button>
        <MuiLink component={Link} to="/recover" underline="hover" variant="body2">¿Olvidaste tu contraseña?</MuiLink>
      </Stack>
    </AuthCard>
  );
}

export function ActivationPage(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [inspection, setInspection] = useState<AccountTokenInspectionResponse | null>(null);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const value = new URLSearchParams(location.search).get("token") ?? "";
    setToken(value);
    if (value) {
      navigate("/activate", { replace: true });
      void inspectActivation(value).then(setInspection).catch((reason: unknown) => setError(errorText(reason)));
    } else {
      setError("El enlace no contiene un código de activación.");
    }
  }, [location.search, navigate]);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (inspection?.requiresPassword && password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await completeActivation(token, inspection?.requiresPassword ? password : undefined);
      setDone(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Activar acceso">
      {!inspection && !error && <CircularProgress aria-label="Validando enlace" />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {inspection && !done && (
        <Stack component="form" spacing={2} onSubmit={(event) => void submit(event)}>
          <Typography variant="body2">
            {inspection.purpose === "MEMBERSHIP_INVITATION" && inspection.organizationName
              ? `Hola ${inspection.displayName}, confirma tu acceso a ${inspection.organizationName}.`
              : `Hola ${inspection.displayName}, define tu contraseña para activar el acceso.`}
          </Typography>
          {inspection.requiresPassword && (
            <>
              <TextField autoComplete="new-password" helperText="Mínimo 12 caracteres." label="Nueva contraseña" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
              <TextField autoComplete="new-password" label="Confirmar contraseña" onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} />
            </>
          )}
          <Button disabled={busy} type="submit" variant="contained">
            {busy ? <CircularProgress color="inherit" size={22} /> : inspection.requiresPassword ? "Activar cuenta" : "Aceptar invitación"}
          </Button>
        </Stack>
      )}
      {done && <Stack spacing={2}><Alert severity="success">El acceso quedó activado.</Alert><Button component={Link} to="/login" variant="contained">Ir al inicio de sesión</Button></Stack>}
    </AuthCard>
  );
}

export function RecoveryRequestPage(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestRecovery(email);
      setSent(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Recuperar contraseña">
      {sent ? (
        <Stack spacing={2}><Alert severity="info">Si la cuenta está activa, recibirá un mensaje con los siguientes pasos.</Alert><Button component={Link} to="/login">Volver al inicio de sesión</Button></Stack>
      ) : (
        <Stack component="form" spacing={2} onSubmit={(event) => void submit(event)}>
          <Typography color="text.secondary" variant="body2">Ingresa el correo asociado a tu cuenta.</Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField autoComplete="email" label="Correo electrónico" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          <Button disabled={busy} type="submit" variant="contained">{busy ? <CircularProgress color="inherit" size={22} /> : "Enviar instrucciones"}</Button>
          <MuiLink component={Link} to="/login" underline="hover" variant="body2">Volver al inicio de sesión</MuiLink>
        </Stack>
      )}
    </AuthCard>
  );
}

export function RecoveryCompletePage(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const value = new URLSearchParams(location.search).get("token") ?? "";
    setToken(value);
    if (value) {
      navigate("/recover/complete", { replace: true });
    } else {
      setError("El enlace no contiene un código de recuperación.");
    }
  }, [location.search, navigate]);
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await completeRecovery(token, password);
      setDone(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Define una contraseña nueva">
      {done ? <Stack spacing={2}><Alert severity="success">La contraseña se actualizó. Inicia sesión nuevamente.</Alert><Button component={Link} to="/login" variant="contained">Ir al inicio de sesión</Button></Stack> : (
        <Stack component="form" spacing={2} onSubmit={(event) => void submit(event)}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField autoComplete="new-password" helperText="Mínimo 12 caracteres." label="Nueva contraseña" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          <TextField autoComplete="new-password" label="Confirmar contraseña" onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} />
          <Button disabled={busy || !token} type="submit" variant="contained">{busy ? <CircularProgress color="inherit" size={22} /> : "Actualizar contraseña"}</Button>
        </Stack>
      )}
    </AuthCard>
  );
}
