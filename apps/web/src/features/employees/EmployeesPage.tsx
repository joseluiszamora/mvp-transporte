import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import type { EmployeeDetails, EmployeeDocumentItem, EmployeeListItem, EmployeeScopeOptions } from "@mvp-transporte/contracts";
import { useAuth } from "../auth/AuthContext";
import { createEmployee, deletePrivateFile, downloadPrivateFileById, getEmployee, getPrivateFileBlob, listEmployeeDocuments, listEmployeeScopeOptions, listEmployees, updateEmployee, uploadEmployeeDocument, uploadEmployeePhoto } from "../auth/auth-client";

const pageSize = 20;
const documentAccept = ".pdf,.jpg,.jpeg,.png,.webp";
function dateLabel(value: string): string {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("es-BO", { timeZone: "America/La_Paz" });
}

function updateFormValue(setter: React.Dispatch<React.SetStateAction<Record<string, unknown>>>, key: string, value: unknown): void {
  setter((current) => ({ ...current, [key]: value }));
}

function EmployeeFormDialog({ open, initial, scopes, allowPersonal, onClose, onSaved }: {
  open: boolean; initial: EmployeeDetails | null; scopes: EmployeeScopeOptions; allowPersonal: boolean; onClose: () => void; onSaved: () => void;
}): React.JSX.Element {
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const saving = useMutation({
    mutationFn: async () => {
      const branchIds = (form.branchIds as string[] | undefined) ?? [];
      if (initial && !initial.canUpdateSharedFields) return updateEmployee(initial.id, { branchIds });
      const payload = { ...form, positionId: form.positionId || null, ...(Object.hasOwn(form, "userId") ? { userId: form.userId || null } : {}) };
      return initial ? updateEmployee(initial.id, payload as never) : createEmployee(payload as never);
    },
    onSuccess: () => { setError(""); onSaved(); },
    onError: (failure: unknown) => setError(failure instanceof Error ? failure.message : "No se pudo guardar el empleado."),
  });

  useEffect(() => {
    if (!open) return;
    setError("");
    const includePersonalData = initial ? initial.canManagePersonalData : allowPersonal;
    const includeUserLink = initial ? initial.canManageUserLink && scopes.users.length > 0 : allowPersonal && scopes.users.length > 0;
    setForm(initial ? {
      internalCode: initial.internalCode,
      firstNames: initial.firstNames,
      lastNames: initial.lastNames,
      positionId: initial.position?.id ?? "",
      hireDate: initial.hireDate,
      branchIds: initial.branches.map((branch) => branch.id),
      ...(includePersonalData ? {
        personalDocumentNumber: initial.personalData?.documentNumber ?? "",
        personalPhone: initial.personalData?.phone ?? "",
        personalEmail: initial.personalData?.email ?? "",
        personalAddress: initial.personalData?.address ?? "",
      } : {}),
      ...(includeUserLink ? { userId: initial.linkedUser?.id ?? "" } : {}),
      ...(initial.canDeactivate ? { status: initial.status } : {}),
    } : {
      companyId: "", internalCode: "", firstNames: "", lastNames: "", positionId: "", hireDate: "", branchIds: [],
      ...(includePersonalData ? { personalDocumentNumber: "", personalPhone: "", personalEmail: "", personalAddress: "" } : {}),
      ...(includeUserLink ? { userId: "" } : {}),
    });
  }, [open, initial, allowPersonal, scopes.users.length]);

  const selectedCompany = scopes.companies.find((company) => company.id === ((form.companyId as string | undefined) ?? initial?.companyId));
  const canEditPersonalData = initial ? initial.canManagePersonalData : allowPersonal;
  const field = (key: string, label: string, type = "text", required = false, multiline = false) => (
    <TextField fullWidth label={label} type={type} required={required} multiline={multiline} minRows={multiline ? 2 : undefined}
      disabled={Boolean(initial && !initial.canUpdateSharedFields)} value={(form[key] as string | undefined) ?? ""}
      onChange={(event) => updateFormValue(setForm, key, event.target.value)} />
  );
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); setError(""); saving.mutate(); };
  const selectedBranchIds = (form.branchIds as string[] | undefined) ?? [];
  const canCreateInSelected = Boolean(selectedCompany?.canCreate || selectedBranchIds.some((id) => selectedCompany?.branches.some((branch) => branch.id === id && branch.canCreate)));

  return <Dialog fullWidth maxWidth="md" onClose={onClose} open={open}><Box component="form" onSubmit={submit}>
    <DialogTitle>{initial ? "Editar empleado" : "Nuevo empleado"}</DialogTitle>
    <DialogContent><Stack spacing={2.25} sx={{ pt: 1 }}>
      {error && <Alert severity="error">{error}</Alert>}
      {!initial && <FormControl fullWidth required><InputLabel>Empresa</InputLabel><Select label="Empresa" value={(form.companyId as string | undefined) ?? ""}
        onChange={(event) => setForm((current) => ({ ...current, companyId: event.target.value, branchIds: [] }))}>
        {scopes.companies.filter((company) => company.canCreate || company.branches.some((branch) => branch.canCreate)).map((company) => <MenuItem key={company.id} value={company.id}>{company.legalName}</MenuItem>)}
      </Select></FormControl>}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
        {field("internalCode", "Código interno", "text", true)}{field("hireDate", "Fecha de ingreso", "date", true)}
        {field("firstNames", "Nombres", "text", true)}{field("lastNames", "Apellidos", "text", true)}
      </Box>
      <FormControl fullWidth disabled={Boolean(initial && !initial.canUpdateSharedFields)}><InputLabel>Cargo</InputLabel><Select label="Cargo" value={(form.positionId as string | undefined) ?? ""} onChange={(event) => updateFormValue(setForm, "positionId", event.target.value)}>
        <MenuItem value="">Sin cargo</MenuItem>{scopes.positions.map((position) => <MenuItem key={position.id} value={position.id}>{position.name}</MenuItem>)}
      </Select></FormControl>
      {selectedCompany && <FormControl fullWidth disabled={Boolean(initial && !initial.canUpdate)}><InputLabel>Sucursales</InputLabel><Select multiple label="Sucursales" value={(form.branchIds as string[] | undefined) ?? []}
        onChange={(event) => updateFormValue(setForm, "branchIds", event.target.value as string[])} renderValue={(selected) => selectedCompany.branches.filter((branch) => selected.includes(branch.id)).map((branch) => branch.name).join(", ")}>
        {selectedCompany.branches.filter((branch) => initial ? branch.canUpdate || initial.branches.some((assigned) => assigned.id === branch.id) : branch.canCreate).map((branch) => <MenuItem
          disabled={Boolean(initial && !branch.canUpdate && initial.branches.some((assigned) => assigned.id === branch.id))} key={branch.id} value={branch.id}>{branch.code} · {branch.name}</MenuItem>)}
      </Select></FormControl>}
      {initial?.canUpdateSharedFields && (initial.canDeactivate || initial.status === "INACTIVE") && <FormControl fullWidth><InputLabel>Estado</InputLabel><Select label="Estado" value={(form.status as string | undefined) ?? initial.status} onChange={(event) => updateFormValue(setForm, "status", event.target.value)}>
        <MenuItem value="ACTIVE">Activo</MenuItem>{initial.canDeactivate && <MenuItem value="INACTIVE">Inactivo</MenuItem>}
      </Select></FormControl>}
      {canEditPersonalData && <><Typography color="text.secondary" variant="subtitle2">Datos personales restringidos</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          {field("personalDocumentNumber", "Documento")}{field("personalPhone", "Teléfono")}{field("personalEmail", "Correo personal", "email")}{field("personalAddress", "Domicilio", "text", false, true)}
        </Box>
        {scopes.users.length > 0 && <FormControl fullWidth><InputLabel>Cuenta de usuario vinculada</InputLabel><Select label="Cuenta de usuario vinculada" value={(form.userId as string | undefined) ?? ""} onChange={(event) => updateFormValue(setForm, "userId", event.target.value)}>
          <MenuItem value="">Sin cuenta vinculada</MenuItem>{scopes.users.map((user) => <MenuItem key={user.id} value={user.id}>{user.displayName} · {user.email} ({user.membershipStatus.toLocaleLowerCase("es-BO")})</MenuItem>)}
        </Select></FormControl>}
      </>}
    </Stack></DialogContent>
    {saving.isPending && <LinearProgress />}
    <DialogActions sx={{ px: 3, py: 2 }}><Button onClick={onClose}>Cancelar</Button><Button disabled={saving.isPending || (!initial && !canCreateInSelected)} type="submit" variant="contained">Guardar empleado</Button></DialogActions>
  </Box></Dialog>;
}

function DocumentRow({ document, canDownload, canDelete, onDelete }: { document: EmployeeDocumentItem; canDownload: boolean; canDelete: boolean; onDelete: (fileId: string) => void }): React.JSX.Element {
  return <Paper variant="outlined" sx={{ p: 1.5, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
    <Box sx={{ flex: 1, minWidth: 180 }}><Typography sx={{ fontWeight: 600 }}>{document.type.name} · {document.originalName}</Typography>
      <Typography color="text.secondary" variant="caption">{document.issuedAt ? `Emisión ${dateLabel(document.issuedAt)}` : "Sin fecha de emisión"}{document.expiresAt ? ` · Vence ${dateLabel(document.expiresAt)}` : ""} · {(document.bytes / 1024).toFixed(0)} KiB</Typography></Box>
    {canDownload && <Button onClick={() => void downloadPrivateFileById(document.fileId, document.originalName)}>Descargar</Button>}
    {canDelete && <Button color="error" onClick={() => onDelete(document.fileId)}>Quitar</Button>}
  </Paper>;
}

function EmployeeDetailDialog({ employeeId, scopes, onClose, onEdit }: { employeeId: string | null; scopes: EmployeeScopeOptions; onClose: () => void; onEdit: (employee: EmployeeDetails) => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  const employeeQuery = useQuery({ queryKey: ["employees", "detail", employeeId], queryFn: () => getEmployee(employeeId as string), enabled: Boolean(employeeId) });
  const employee = employeeQuery.data?.item;
  const documentsQuery = useQuery({ queryKey: ["employees", "documents", employeeId], queryFn: () => listEmployeeDocuments(employeeId as string), enabled: Boolean(employeeId && employee?.canReadDocuments) });
  const uploadPhoto = useMutation({
    mutationFn: () => { if (!employeeId || !photoFile) throw new Error("Selecciona una foto."); return uploadEmployeePhoto(employeeId, photoFile); },
    onSuccess: async () => { setPhotoFile(null); await queryClient.invalidateQueries({ queryKey: ["employees", "detail", employeeId] }); },
    onError: (failure: unknown) => setError(failure instanceof Error ? failure.message : "No se pudo guardar la foto."),
  });
  const uploadDocument = useMutation({
    mutationFn: () => { if (!employeeId || !documentFile || !documentTypeId) throw new Error("Selecciona el tipo y el archivo."); return uploadEmployeeDocument(employeeId, documentFile, { typeId: documentTypeId, issuedAt: issuedAt || undefined, expiresAt: expiresAt || undefined }); },
    onSuccess: async () => { setDocumentFile(null); setIssuedAt(""); setExpiresAt(""); await queryClient.invalidateQueries({ queryKey: ["employees", "documents", employeeId] }); },
    onError: (failure: unknown) => setError(failure instanceof Error ? failure.message : "No se pudo cargar el documento."),
  });
  const removeFile = useMutation({
    mutationFn: deletePrivateFile,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["employees", "documents", employeeId] }); await queryClient.invalidateQueries({ queryKey: ["employees", "detail", employeeId] }); },
    onError: (failure: unknown) => setError(failure instanceof Error ? failure.message : "No se pudo quitar el archivo."),
  });
  useEffect(() => {
    let objectUrl = "";
    let canceled = false;
    if (employee?.photoFileId && employee.canReadPhoto) {
      void getPrivateFileBlob(employee.photoFileId).then((blob) => {
        if (!canceled) { objectUrl = URL.createObjectURL(blob); setPhotoUrl(objectUrl); }
      }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "No se pudo mostrar la foto."));
    } else setPhotoUrl("");
    return () => { canceled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [employee?.photoFileId, employee?.canReadPhoto]);
  const companyName = scopes.companies.find((company) => company.id === employee?.companyId)?.legalName ?? "Empresa";

  return <Dialog fullWidth maxWidth="md" onClose={onClose} open={Boolean(employeeId)}><DialogTitle>Detalle de personal</DialogTitle><DialogContent><Stack spacing={2.5} sx={{ pt: 1 }}>
    {employeeQuery.isLoading && <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress aria-label="Cargando empleado" /></Box>}
    {employeeQuery.isError && <Alert severity="error">{employeeQuery.error.message}<Button onClick={() => void employeeQuery.refetch()} size="small">Reintentar</Button></Alert>}
    {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
    {employee && <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        {photoUrl && <Box component="img" alt={`Foto de ${employee.firstNames} ${employee.lastNames}`} src={photoUrl} sx={{ width: 88, height: 88, borderRadius: 2, objectFit: "cover" }} />}
        <Box sx={{ flex: 1 }}><Typography color="text.secondary" variant="overline">{employee.internalCode} · {companyName}</Typography><Typography component="h2" variant="h5">{employee.firstNames} {employee.lastNames}</Typography><Typography color="text.secondary">{employee.position?.name ?? "Sin cargo"} · Ingreso {dateLabel(employee.hireDate)}</Typography></Box>
        <Chip color={employee.status === "ACTIVE" ? "success" : "default"} label={employee.status === "ACTIVE" ? "Activo" : "Inactivo"} variant="outlined" />
      </Box>
      <Box><Typography sx={{ fontWeight: 650, mb: 0.5 }}>Sucursales autorizadas</Typography><Typography color="text.secondary">{employee.branches.length ? employee.branches.map((branch) => `${branch.code} · ${branch.name}`).join(", ") : "Sin sucursales visibles o asignadas"}</Typography></Box>
      {employee.canReadPersonalData && <Paper variant="outlined" sx={{ p: 2 }}><Typography sx={{ fontWeight: 650, mb: 1 }}>Datos personales</Typography>
        <Typography>Documento: {employee.personalData?.documentNumber || "No registrado"}</Typography><Typography>Teléfono: {employee.personalData?.phone || "No registrado"}</Typography><Typography>Correo: {employee.personalData?.email || "No registrado"}</Typography><Typography>Domicilio: {employee.personalData?.address || "No registrado"}</Typography>
        {employee.canReadLinkedUser && <Typography sx={{ mt: 1 }}>Cuenta vinculada: {employee.linkedUser ? `${employee.linkedUser.displayName} · ${employee.linkedUser.email}` : "Sin cuenta vinculada"}</Typography>}
        {!employee.canReadLinkedUser && <Typography color="text.secondary" sx={{ mt: 1 }}>El vínculo de cuenta requiere permiso de consulta de usuarios.</Typography>}
      </Paper>}
      {(employee.canReadPhoto || employee.canManagePhoto || employee.canDeletePhoto) && <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        {employee.canManagePhoto && <Button component="label" variant="outlined">{employee.photoFileId ? "Cambiar foto" : "Cargar foto"}<input hidden accept="image/jpeg,image/png,image/webp" type="file" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} /></Button>}
        {photoFile && employee.canManagePhoto && <><Typography variant="body2">{photoFile.name}</Typography><Button disabled={uploadPhoto.isPending} onClick={() => uploadPhoto.mutate()} variant="contained">Guardar foto</Button></>}
        {employee.photoFileId && employee.canDeletePhoto && <Button color="error" disabled={removeFile.isPending} onClick={() => removeFile.mutate(employee.photoFileId as string)}>Quitar foto</Button>}
      </Stack>}
      {employee.canReadDocuments && <Box><Typography sx={{ fontWeight: 650, mb: 1 }}>Documentos</Typography>
        {documentsQuery.isLoading && <CircularProgress size={20} aria-label="Cargando documentos" />}
        {documentsQuery.isError && <Alert severity="error">No se pudieron consultar los documentos. <Button onClick={() => void documentsQuery.refetch()} size="small">Reintentar</Button></Alert>}
        {documentsQuery.isSuccess && documentsQuery.data.items.length === 0 && <Typography color="text.secondary">Todavía no hay documentos cargados.</Typography>}
        <Stack spacing={1}>{documentsQuery.data?.items.map((document) => <DocumentRow key={document.id} document={document} canDownload={documentsQuery.data.canDownload} canDelete={employee.canDeleteDocuments} onDelete={(fileId) => removeFile.mutate(fileId)} />)}</Stack>
      </Box>}
      {employee.canManageDocuments && <Paper variant="outlined" sx={{ p: 2 }}><Typography sx={{ fontWeight: 650, mb: 1.5 }}>Cargar documento</Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
          <FormControl fullWidth size="small"><InputLabel>Tipo</InputLabel><Select label="Tipo" value={documentTypeId} onChange={(event) => setDocumentTypeId(event.target.value)}><MenuItem value="">Seleccionar tipo</MenuItem>{scopes.documentTypes.map((type) => <MenuItem key={type.id} value={type.id}>{type.name}</MenuItem>)}</Select></FormControl>
          <TextField label="Emitido el" size="small" type="date" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Vence el" size="small" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <Button component="label" variant="outlined">Elegir archivo<input hidden accept={documentAccept} type="file" onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)} /></Button>
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mt: 1.5 }}><Typography color="text.secondary" variant="caption">{documentFile?.name ?? "PDF o imagen, máximo 10 MiB"}</Typography><Button disabled={!documentFile || !documentTypeId || uploadDocument.isPending} onClick={() => uploadDocument.mutate()} variant="contained">Cargar documento</Button></Stack>
      </Paper>}
    </>}
  </Stack></DialogContent><DialogActions sx={{ px: 3, py: 2 }}>{employee?.canUpdate && <Button onClick={() => onEdit(employee)}>Editar</Button>}<Button onClick={onClose}>Cerrar</Button></DialogActions></Dialog>;
}

export function EmployeesPage(): React.JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmployeeDetails | null>(null);
  const [creating, setCreating] = useState(false);
  const canRead = Boolean(user?.permissions.includes("employees.read"));
  const canCreate = Boolean(user?.permissions.includes("employees.create"));
  const canUpdate = Boolean(user?.permissions.includes("employees.update"));
  const scopes = useQuery({ queryKey: ["employees", "scope-options", user?.selectedOrganizationId], queryFn: listEmployeeScopeOptions, enabled: Boolean(user?.selectedOrganizationId && (canRead || canCreate || canUpdate)) });
  const employees = useQuery({ queryKey: ["employees", user?.selectedOrganizationId, search, companyId, offset], queryFn: () => listEmployees({ limit: pageSize, offset, search, companyId: companyId || undefined }), enabled: Boolean(user?.selectedOrganizationId && canRead) });
  const companyNames = useMemo(() => new Map((scopes.data?.companies ?? []).map((company) => [company.id, company.legalName])), [scopes.data?.companies]);
  if (!canRead && !canCreate && !canUpdate) return <Alert severity="warning">Tu cuenta no tiene permiso para consultar ni administrar personal.</Alert>;
  const emptyScopes: EmployeeScopeOptions = { companies: [], positions: [], documentTypes: [], users: [] };
  return <Stack spacing={2.5}>
    <Box sx={{ display: "flex", alignItems: { sm: "center" }, justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
      <Box><Typography color="text.secondary" variant="overline">ADM-05</Typography><Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">Personal</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Gestiona la información laboral con datos personales y documentos restringidos.</Typography></Box>
      {canCreate && <Button onClick={() => setCreating(true)} variant="contained">Nuevo empleado</Button>}
    </Box>
    {scopes.isError && <Alert severity="warning">No se pudieron cargar las empresas, sucursales y catálogos permitidos. {scopes.error.message}<Button onClick={() => void scopes.refetch()} size="small">Reintentar</Button></Alert>}
    <Paper variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
      <TextField fullWidth label="Buscar por código o nombre" value={search} onChange={(event) => { setOffset(0); setSearch(event.target.value); }} />
      <FormControl sx={{ minWidth: { sm: 240 } }}><InputLabel>Empresa</InputLabel><Select label="Empresa" value={companyId} onChange={(event) => { setOffset(0); setCompanyId(event.target.value); }}>
        <MenuItem value="">Todas las empresas autorizadas</MenuItem>{scopes.data?.companies.map((company) => <MenuItem key={company.id} value={company.id}>{company.legalName}</MenuItem>)}
      </Select></FormControl>
    </Stack></Paper>
    {employees.isLoading && <Box sx={{ display: "grid", placeItems: "center", py: 5 }}><CircularProgress aria-label="Cargando personal" /></Box>}
    {employees.isError && <Alert severity="error">{employees.error.message}<Button onClick={() => void employees.refetch()} size="small">Reintentar</Button></Alert>}
    {employees.isSuccess && employees.data.items.length === 0 && <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}><Typography sx={{ fontWeight: 650 }}>No hay empleados para mostrar</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Ajusta la búsqueda o registra el primer empleado.</Typography></Paper>}
    {employees.isSuccess && employees.data.items.length > 0 && <Paper variant="outlined" sx={{ overflowX: "auto" }}><Table size="small"><TableHead><TableRow><TableCell>Código</TableCell><TableCell>Nombre</TableCell><TableCell>Empresa</TableCell><TableCell>Cargo</TableCell><TableCell>Sucursales autorizadas</TableCell><TableCell>Ingreso</TableCell><TableCell>Estado</TableCell></TableRow></TableHead><TableBody>
      {employees.data.items.map((employee: EmployeeListItem) => <TableRow hover key={employee.id} onClick={() => setSelectedEmployeeId(employee.id)} sx={{ cursor: "pointer" }}>
        <TableCell>{employee.internalCode}</TableCell><TableCell>{employee.firstNames} {employee.lastNames}</TableCell><TableCell>{companyNames.get(employee.companyId) ?? "Empresa"}</TableCell><TableCell>{employee.position?.name ?? "—"}</TableCell><TableCell>{employee.branches.map((branch) => branch.code).join(", ") || "—"}</TableCell><TableCell>{dateLabel(employee.hireDate)}</TableCell><TableCell><Chip label={employee.status === "ACTIVE" ? "Activo" : "Inactivo"} color={employee.status === "ACTIVE" ? "success" : "default"} size="small" variant="outlined" /></TableCell>
      </TableRow>)}
    </TableBody></Table><Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: 1 }}><Typography color="text.secondary" variant="caption">{employees.data.total} empleados</Typography><Stack direction="row"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</Button><Button disabled={offset + pageSize >= employees.data.total} onClick={() => setOffset(offset + pageSize)}>Siguiente</Button></Stack></Stack></Paper>}
    <EmployeeDetailDialog employeeId={selectedEmployeeId} scopes={scopes.data ?? emptyScopes} onClose={() => setSelectedEmployeeId(null)} onEdit={(employee) => { setSelectedEmployeeId(null); setEditing(employee); }} />
    {scopes.data && <EmployeeFormDialog key={editing?.id ?? (creating ? "new" : "closed")} open={creating || Boolean(editing)} initial={editing} scopes={scopes.data} allowPersonal={Boolean(user?.permissions.includes("employees.personal.read"))} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["employees"] }); setCreating(false); setEditing(null); }} />}
  </Stack>;
}
