import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { createOrganization } from "../auth/auth-client";
import { useAuth } from "../auth/AuthContext";

export function CreateOrganizationPage(): React.JSX.Element {
  const { user } = useAuth();
  const [organizationName, setOrganizationName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [created, setCreated] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user?.platformAdmin) {
    return <Alert severity="warning">Esta función está reservada para administración de plataforma.</Alert>;
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCreated("");
    try {
      const result = await createOrganization({ organizationName, adminEmail, adminDisplayName });
      setCreated(`Se creó ${result.name}. La invitación inicial quedó en la cola de correo.`);
      setOrganizationName("");
      setAdminEmail("");
      setAdminDisplayName("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo crear la organización.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box><Typography color="text.secondary" variant="overline">ADMINISTRACIÓN DE PLATAFORMA</Typography><Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>Nueva organización</Typography></Box>
      <Paper component="form" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 720 }} onSubmit={(event) => void submit(event)}>
        <Stack spacing={2}>
          <Typography color="text.secondary" variant="body2">Se creará el tenant con su rol inicial de administrador y una invitación para activarlo.</Typography>
          {created && <Alert severity="success">{created}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Nombre de la organización" onChange={(event) => setOrganizationName(event.target.value)} required value={organizationName} />
          <TextField label="Nombre del administrador" onChange={(event) => setAdminDisplayName(event.target.value)} required value={adminDisplayName} />
          <TextField autoComplete="email" label="Correo del administrador" onChange={(event) => setAdminEmail(event.target.value)} required type="email" value={adminEmail} />
          <Box><Button disabled={busy} type="submit" variant="contained">{busy ? <CircularProgress color="inherit" size={22} /> : "Crear organización"}</Button></Box>
        </Stack>
      </Paper>
    </Stack>
  );
}
