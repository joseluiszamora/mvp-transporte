import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  MenuItem,
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
import type { FileScopeOption } from "@mvp-transporte/contracts";
import { useAuth } from "../auth/AuthContext";
import {
  deletePrivateFile,
  downloadPrivateFileById,
  listFileScopeOptions,
  listFiles,
  uploadPrivateFile,
} from "../auth/auth-client";

const pageSize = 20;
const maxFileBytes = 10 * 1024 * 1024;
const acceptedFileTypes = ".pdf,.jpg,.jpeg,.png,.webp";

function scopeKey(scope: Pick<FileScopeOption, "resourceType" | "resourceId">): string {
  return `${scope.resourceType}:${scope.resourceId}`;
}

export function FilesPage(): React.JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [scopeOffset, setScopeOffset] = useState(0);
  const [scopeSearch, setScopeSearch] = useState("");
  const [selectedScopeKey, setSelectedScopeKey] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [validationError, setValidationError] = useState("");
  const scopes = useQuery({
    queryKey: ["files", "scope-options", user?.selectedOrganizationId, scopeSearch, scopeOffset],
    queryFn: () => listFileScopeOptions({ limit: 100, offset: scopeOffset, search: scopeSearch }),
    enabled: Boolean(user?.selectedOrganizationId && user.permissions.some((permission) => permission.startsWith("files."))),
  });
  const selectedScope = scopes.data?.items.find((item) => scopeKey(item) === selectedScopeKey);
  const filesQuery = useQuery({
    queryKey: ["files", selectedScope?.resourceType, selectedScope?.resourceId, search, offset],
    queryFn: () => listFiles({ resourceType: selectedScope?.resourceType ?? "COMPANY_ATTACHMENT", resourceId: selectedScope?.resourceId ?? "", limit: pageSize, offset, search }),
    enabled: Boolean(selectedScope?.canRead),
  });
  const scopesForControl = useMemo(() => scopes.data?.items ?? [], [scopes.data?.items]);

  useEffect(() => {
    if (scopesForControl.length && !scopesForControl.some((scope) => scopeKey(scope) === selectedScopeKey)) {
      setSelectedScopeKey(scopeKey(scopesForControl[0]));
      setOffset(0);
    }
  }, [scopesForControl, selectedScopeKey]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedScope) throw new Error("Selecciona un recurso permitido.");
      setProgress(0);
      return uploadPrivateFile(selectedScope, file, (loaded, total) => setProgress(total > 0 ? Math.round((loaded / total) * 100) : 0));
    },
    onSuccess: async () => {
      setProgress(null);
      setValidationError("");
      await queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (error: unknown) => {
      setProgress(null);
      setActionError(error instanceof Error ? error.message : "No fue posible cargar el archivo.");
    },
  });
  const remove = useMutation({
    mutationFn: deletePrivateFile,
    onSuccess: async () => {
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (error: unknown) => setActionError(error instanceof Error ? error.message : "No fue posible quitar el archivo."),
  });

  const handleUpload = (file: File | undefined): void => {
    setActionError("");
    setValidationError("");
    if (!file) return;
    if (!selectedScope?.canUpload) {
      setValidationError("No tienes permiso para cargar archivos en este recurso.");
      return;
    }
    if (file.size < 1 || file.size > maxFileBytes) {
      setValidationError("El archivo debe tener entre 1 byte y 10 MiB.");
      return;
    }
    upload.mutate(file);
  };

  const handleDownload = async (fileId: string, name: string): Promise<void> => {
    setActionError("");
    try {
      await downloadPrivateFileById(fileId, name);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No fue posible descargar el archivo.");
    }
  };

  const handleDelete = (fileId: string, name: string): void => {
    if (!window.confirm(`¿Quitar “${name}” de este recurso? El archivo se purgará después del periodo de gracia.`)) return;
    setActionError("");
    remove.mutate(fileId);
  };

  const hasFilePermissions = user?.permissions.some((permission) => permission.startsWith("files.")) ?? false;
  const page = filesQuery.data;

  return <Stack spacing={2.5}>
    <Box>
      <Typography color="text.secondary" variant="overline">ADM-08</Typography>
      <Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">Archivos privados</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.75 }}>Adjuntos privados de empresas y sucursales autorizadas. Límite 10 MiB; PDF, JPEG, PNG y WEBP.</Typography>
    </Box>
    {!hasFilePermissions && <Alert severity="info">Tu cuenta no tiene permisos de archivos en la organización seleccionada.</Alert>}
    {actionError && <Alert onClose={() => setActionError("")} severity="error">{actionError}</Alert>}
    {validationError && <Alert onClose={() => setValidationError("")} severity="warning">{validationError}</Alert>}
    {scopes.isLoading && <Box sx={{ display: "flex", justifyContent: "center", py: 5 }}><CircularProgress aria-label="Cargando recursos autorizados" /></Box>}
    {scopes.isError && <Alert severity="error">{scopes.error.message}</Alert>}
    {scopes.data && <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField label="Buscar empresa o sucursal" onChange={(event) => { setScopeSearch(event.target.value); setScopeOffset(0); }} size="small" value={scopeSearch} />
          <TextField label="Recurso" onChange={(event) => { setSelectedScopeKey(event.target.value); setOffset(0); setActionError(""); }} select size="small" sx={{ minWidth: { sm: 320 } }} value={selectedScopeKey}>
            {scopesForControl.map((scope) => <MenuItem key={scopeKey(scope)} value={scopeKey(scope)}>{scope.label}{scope.branchId ? " · Sucursal" : " · Empresa"}</MenuItem>)}
          </TextField>
        </Stack>
        {!scopes.data.items.length && <Alert severity="info">No hay empresas o sucursales disponibles con los permisos de archivo y del recurso requeridos.</Alert>}
        {scopes.data.total > scopes.data.limit && <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography color="text.secondary" variant="body2">Recursos {scopeOffset + 1}–{Math.min(scopeOffset + scopes.data.items.length, scopes.data.total)} de {scopes.data.total}</Typography>
          <Button disabled={scopeOffset === 0} onClick={() => setScopeOffset(Math.max(0, scopeOffset - (scopes.data?.limit ?? 100)))} size="small">Anterior</Button>
          <Button disabled={scopeOffset + scopes.data.limit >= scopes.data.total} onClick={() => setScopeOffset(scopeOffset + scopes.data.limit)} size="small">Siguiente</Button>
        </Stack>}
      </Stack>
    </Paper>}
    {selectedScope && <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Box><Typography sx={{ fontWeight: 650 }} variant="h6">{selectedScope.label}</Typography><Typography color="text.secondary" variant="body2">{selectedScope.branchId ? "Archivos de esta sucursal" : "Archivos de esta empresa"}</Typography></Box>
          {selectedScope.canUpload && <Button component="label" disabled={upload.isPending} variant="contained">{upload.isPending ? "Cargando…" : "Cargar archivo"}<input accept={acceptedFileTypes} hidden onChange={(event) => { handleUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} type="file" /></Button>}
        </Stack>
        {upload.isPending && progress !== null && <Box><LinearProgress aria-label="Progreso de carga" value={progress} variant="determinate" /><Typography color="text.secondary" sx={{ mt: 0.5 }} variant="caption">Cargando {progress}%</Typography></Box>}
        {!selectedScope.canRead && <Alert severity="info">Puedes cargar archivos en este recurso, pero tu rol no permite consultar la lista.</Alert>}
        {selectedScope.canRead && <TextField label="Buscar archivos" onChange={(event) => { setSearch(event.target.value); setOffset(0); }} size="small" value={search} />}
        {selectedScope.canRead && filesQuery.isLoading && <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress aria-label="Cargando archivos" /></Box>}
        {selectedScope.canRead && filesQuery.isError && <Alert severity="error">{filesQuery.error.message}</Alert>}
        {selectedScope.canRead && page && !filesQuery.isError && (page.items.length ? <>
          <Box sx={{ overflowX: "auto" }}><Table size="small"><TableHead><TableRow><TableCell>Archivo</TableCell><TableCell>Tipo</TableCell><TableCell>Tamaño</TableCell><TableCell>Fecha</TableCell><TableCell align="right">Acciones</TableCell></TableRow></TableHead><TableBody>
            {page.items.map((file) => <TableRow key={file.id} hover><TableCell>{file.originalName}</TableCell><TableCell>{file.detectedMime}</TableCell><TableCell>{(file.bytes / (1024 * 1024)).toLocaleString("es-BO", { maximumFractionDigits: 2 })} MiB</TableCell><TableCell>{new Intl.DateTimeFormat("es-BO", { dateStyle: "short", timeStyle: "short", timeZone: "America/La_Paz" }).format(new Date(file.createdAt))}</TableCell><TableCell align="right"><Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
              {selectedScope.canDownload && <Button onClick={() => { void handleDownload(file.id, file.originalName); }} size="small">Descargar</Button>}
              {selectedScope.canDelete && <Button color="error" disabled={remove.isPending} onClick={() => handleDelete(file.id, file.originalName)} size="small">Quitar</Button>}
            </Stack></TableCell></TableRow>)}
          </TableBody></Table></Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><Typography color="text.secondary" variant="body2">Archivos {offset + 1}–{Math.min(offset + page.items.length, page.total)} de {page.total}</Typography><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - page.limit))} size="small">Anterior</Button><Button disabled={offset + page.limit >= page.total} onClick={() => setOffset(offset + page.limit)} size="small">Siguiente</Button></Stack>
        </> : <Alert severity="info">No hay archivos asociados a este recurso.</Alert>)}
      </Stack>
    </Paper>}
  </Stack>;
}
