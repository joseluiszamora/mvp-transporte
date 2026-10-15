import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { inviteUser, listOrganizationUsers, updateMembershipStatus } from "../auth/auth-client";
import { useAuth } from "../auth/AuthContext";

const pageSize = 20;

export function UsersPage(): React.JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["organization-users", user?.selectedOrganizationId, offset],
    queryFn: () => listOrganizationUsers(pageSize, offset),
    enabled: Boolean(user?.permissions.includes("users.read")),
  });
  const invite = useMutation({
    mutationFn: () => inviteUser(email, displayName),
    onSuccess: async () => {
      setMessage("Si la invitación puede procesarse, se enviarán instrucciones al correo indicado.");
      setEmail("");
      setDisplayName("");
      await queryClient.invalidateQueries({ queryKey: ["organization-users", user?.selectedOrganizationId] });
    },
  });
  const changeMembershipStatus = useMutation({
    mutationFn: ({ membershipId, status }: { membershipId: string; status: "ACTIVE" | "SUSPENDED" }) => updateMembershipStatus(membershipId, status),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["organization-users", user?.selectedOrganizationId] }); },
  });

  if (!user?.permissions.includes("users.read")) {
    return <Alert severity="warning">Tu cuenta no tiene permiso para consultar las membresías de este tenant.</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography color="text.secondary" variant="overline">ADM-02</Typography>
        <Typography component="h1" variant="h4" sx={{ fontWeight: 700 }}>Usuarios</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>Membresías del tenant seleccionado.</Typography>
      </Box>
      {user.permissions.includes("users.create") && (
        <Paper component="form" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} onSubmit={(event) => { event.preventDefault(); setMessage(""); invite.mutate(); }}>
          <Typography component="h2" variant="h6" sx={{ mb: 2 }}>Invitar usuario</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField fullWidth label="Nombre visible" onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
            <TextField fullWidth label="Correo electrónico" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
            <Button disabled={invite.isPending} type="submit" variant="contained" sx={{ minWidth: 150 }}>
              {invite.isPending ? <CircularProgress color="inherit" size={21} /> : "Enviar invitación"}
            </Button>
          </Stack>
          {message && <Alert severity="success" sx={{ mt: 2 }}>{message}</Alert>}
          {invite.isError && <Alert severity="error" sx={{ mt: 2 }}>{invite.error.message}</Alert>}
        </Paper>
      )}
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Box sx={{ p: 2 }}><Typography component="h2" variant="h6">Membresías</Typography></Box>
        {query.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando usuarios" /></Box> : query.isError ? <Alert severity="error" sx={{ m: 2 }}>{query.error.message}</Alert> : query.data?.items.length ? (
          <>
            <Box sx={{ overflowX: "auto" }}><Table aria-label="Membresías del tenant">
              <TableHead><TableRow><TableCell>Nombre</TableCell><TableCell>Correo</TableCell><TableCell>Cuenta</TableCell><TableCell>Membresía</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead>
              <TableBody>{query.data.items.map((item) => <TableRow key={item.membershipId} hover>
                <TableCell>{item.displayName}</TableCell><TableCell>{item.email}</TableCell>
                <TableCell>{item.accountStatus === "PENDING_ACTIVATION" ? "Pendiente de activación" : item.accountStatus === "BLOCKED" ? "Bloqueada" : "Activa"}</TableCell>
                <TableCell>{item.membershipStatus === "INVITED" ? "Invitada" : item.membershipStatus === "SUSPENDED" ? "Suspendida" : "Activa"}</TableCell>
                <TableCell>{item.membershipStatus !== "INVITED" && <Button
                  disabled={changeMembershipStatus.isPending || (item.membershipStatus === "ACTIVE" ? !user.permissions.includes("users.deactivate") : !user.permissions.includes("users.update"))}
                  onClick={() => changeMembershipStatus.mutate({ membershipId: item.membershipId, status: item.membershipStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}
                >{item.membershipStatus === "ACTIVE" ? "Suspender acceso" : "Reactivar acceso"}</Button>}</TableCell>
              </TableRow>)}</TableBody>
            </Table></Box>
            <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center", p: 2 }}>
              <Typography color="text.secondary" variant="body2">{offset + 1}–{Math.min(offset + pageSize, query.data.total)} de {query.data.total}</Typography>
              <Stack direction="row" spacing={1}>
                <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</Button>
                <Button disabled={offset + pageSize >= query.data.total} onClick={() => setOffset(offset + pageSize)}>Siguiente</Button>
              </Stack>
            </Stack>
          </>
        ) : <Box sx={{ p: 3 }}><Alert severity="info">Todavía no hay membresías para mostrar.</Alert></Box>}
        {changeMembershipStatus.isError && <Alert severity="error" sx={{ m: 2 }}>{changeMembershipStatus.error.message}</Alert>}
      </Paper>
    </Stack>
  );
}
