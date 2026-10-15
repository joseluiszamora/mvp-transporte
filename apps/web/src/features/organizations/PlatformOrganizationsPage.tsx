import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { OrganizationStatus } from "@mvp-transporte/contracts";
import { listPlatformOrganizations, updatePlatformOrganization } from "../auth/auth-client";
import { useAuth } from "../auth/AuthContext";

const pageSize = 20;

export function PlatformOrganizationsPage(): React.JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrganizationStatus | "">("");
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ["platform-organizations", search, status, offset],
    queryFn: () => listPlatformOrganizations({ limit: pageSize, offset, search, status: status || undefined }),
    enabled: Boolean(user?.platformAdmin),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; status?: OrganizationStatus } }) => updatePlatformOrganization(id, input),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["platform-organizations"] }); },
  });

  if (!user?.platformAdmin) return <Alert severity="warning">Esta función está reservada para administración de plataforma.</Alert>;

  return <Stack spacing={3}>
    <Box>
      <Typography color="text.secondary" variant="overline">ADMINISTRACIÓN DE PLATAFORMA</Typography>
      <Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">Organizaciones</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>Gestiona los tenants de esta instalación y su estado operativo.</Typography>
    </Box>
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField fullWidth label="Buscar organización" onChange={(event) => { setOffset(0); setSearch(event.target.value); }} value={search} />
        <FormControl sx={{ minWidth: 180 }}>
          <Select aria-label="Filtrar por estado" displayEmpty onChange={(event) => { setOffset(0); setStatus(event.target.value as OrganizationStatus | ""); }} value={status}>
            <MenuItem value="">Todos los estados</MenuItem><MenuItem value="ACTIVE">Activa</MenuItem><MenuItem value="SUSPENDED">Suspendida</MenuItem>
          </Select>
        </FormControl>
        <Button href="/platform/organizations/new" variant="contained" sx={{ whiteSpace: "nowrap" }}>Nueva organización</Button>
      </Stack>
    </Paper>
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      {query.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando organizaciones" /></Box>
        : query.isError ? <Alert severity="error" sx={{ m: 2 }}>{query.error.message}</Alert>
          : query.data?.items.length ? <>
            <Box sx={{ overflowX: "auto" }}><Table aria-label="Organizaciones de plataforma">
              <TableHead><TableRow><TableCell>Organización</TableCell><TableCell>Estado</TableCell><TableCell>Creada</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead>
              <TableBody>{query.data.items.map((organization) => <TableRow hover key={organization.id}>
                <TableCell sx={{ minWidth: 280 }}>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      aria-label={`Nombre de ${organization.name}`}
                      fullWidth
                      size="small"
                      value={nameDrafts[organization.id] ?? organization.name}
                      onChange={(event) => setNameDrafts((drafts) => ({ ...drafts, [organization.id]: event.target.value }))}
                    />
                    <Button
                      disabled={update.isPending || !(nameDrafts[organization.id]?.trim()) || (nameDrafts[organization.id] ?? organization.name).trim() === organization.name}
                      onClick={() => update.mutate({ id: organization.id, input: { name: nameDrafts[organization.id]?.trim() } }, { onSuccess: () => setNameDrafts((drafts) => { const next = { ...drafts }; delete next[organization.id]; return next; }) })}
                    >Guardar</Button>
                  </Stack>
                </TableCell>
                <TableCell>{organization.status === "ACTIVE" ? "Activa" : "Suspendida"}</TableCell>
                <TableCell>{new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeZone: "America/La_Paz" }).format(new Date(organization.createdAt))}</TableCell>
                <TableCell><Button disabled={update.isPending} onClick={() => update.mutate({ id: organization.id, input: { status: organization.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" } })}>
                  {organization.status === "ACTIVE" ? "Suspender" : "Reactivar"}
                </Button></TableCell>
              </TableRow>)}</TableBody>
            </Table></Box>
            <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center", p: 2 }}>
              <Typography color="text.secondary" variant="body2">{offset + 1}–{Math.min(offset + pageSize, query.data.total)} de {query.data.total}</Typography>
              <Stack direction="row" spacing={1}><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</Button><Button disabled={offset + pageSize >= query.data.total} onClick={() => setOffset(offset + pageSize)}>Siguiente</Button></Stack>
            </Stack>
          </> : <Box sx={{ p: 3 }}><Alert severity="info">No hay organizaciones que coincidan con estos filtros.</Alert></Box>}
    </Paper>
    {update.isError && <Alert severity="error">{update.error.message}</Alert>}
  </Stack>;
}
