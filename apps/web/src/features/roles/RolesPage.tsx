import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
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
import type { OrganizationRoleItem, RoleScopeType } from "@mvp-transporte/contracts";
import {
  createOrganizationRole,
  createRoleAssignment,
  deleteRoleAssignment,
  listOrganizationRoles,
  listRoleAssignmentOptions,
  listRoleAssignments,
  listRolePermissionCatalog,
  updateOrganizationRole,
} from "../auth/auth-client";
import { useAuth } from "../auth/AuthContext";

const pageSize = 20;
const scopeLabels: Record<RoleScopeType, string> = { ORGANIZATION: "Organización", COMPANY: "Empresa", BRANCH: "Sucursal" };

export function RolesPage(): React.JSX.Element {
  const { user, reloadUser } = useAuth();
  const queryClient = useQueryClient();
  const [roleOffset, setRoleOffset] = useState(0);
  const [assignmentOffset, setAssignmentOffset] = useState(0);
  const [editingRoleId, setEditingRoleId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [permissionCodes, setPermissionCodes] = useState<string[]>([]);
  const [scopeType, setScopeType] = useState<RoleScopeType>("ORGANIZATION");
  const [membershipId, setMembershipId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [message, setMessage] = useState("");
  const canRead = Boolean(user?.permissions.includes("roles.read"));
  const canCreate = Boolean(user?.permissions.includes("roles.create"));
  const canUpdate = Boolean(user?.permissions.includes("roles.update"));
  const canAssign = Boolean(user?.permissions.includes("roles.assign"));
  const organizationId = user?.selectedOrganizationId;

  const roles = useQuery({
    queryKey: ["organization-roles", organizationId, roleOffset],
    queryFn: () => listOrganizationRoles(pageSize, roleOffset),
    enabled: canRead,
  });
  const assignments = useQuery({
    queryKey: ["role-assignments", organizationId, assignmentOffset],
    queryFn: () => listRoleAssignments(pageSize, assignmentOffset),
    enabled: canRead,
  });
  const catalog = useQuery({
    queryKey: ["role-permission-catalog", organizationId],
    queryFn: listRolePermissionCatalog,
    enabled: canRead,
  });
  const memberships = useQuery({
    queryKey: ["role-options", organizationId, "memberships"],
    queryFn: () => listRoleAssignmentOptions("memberships"),
    enabled: canAssign,
  });
  const companies = useQuery({
    queryKey: ["role-options", organizationId, "companies"],
    queryFn: () => listRoleAssignmentOptions("companies"),
    enabled: canAssign && scopeType !== "ORGANIZATION",
  });
  const branches = useQuery({
    queryKey: ["role-options", organizationId, "branches", companyId],
    queryFn: () => listRoleAssignmentOptions("branches", { companyId }),
    enabled: canAssign && scopeType === "BRANCH" && Boolean(companyId),
  });

  const invalidateRoleData = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["organization-roles", organizationId] }),
      queryClient.invalidateQueries({ queryKey: ["role-assignments", organizationId] }),
    ]);
    await reloadUser();
  };
  const saveRole = useMutation({
    mutationFn: () => editingRoleId
      ? updateOrganizationRole(editingRoleId, { name: roleName, permissionCodes })
      : createOrganizationRole({ name: roleName, permissionCodes }),
    onSuccess: async (saved) => {
      setMessage(editingRoleId ? "Cambios del rol guardados." : "Rol creado.");
      setEditingRoleId(saved.id);
      setRoleName(saved.name);
      setPermissionCodes(saved.permissions);
      await invalidateRoleData();
    },
  });
  const changeRoleStatus = useMutation({
    mutationFn: (role: OrganizationRoleItem) => updateOrganizationRole(role.id, { status: role.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
    onSuccess: async () => { setMessage("Estado del rol actualizado."); await invalidateRoleData(); },
  });
  const addAssignment = useMutation({
    mutationFn: () => createRoleAssignment({
      membershipId,
      roleId,
      scopeType,
      ...(scopeType !== "ORGANIZATION" ? { companyId } : {}),
      ...(scopeType === "BRANCH" ? { branchId } : {}),
    }),
    onSuccess: async () => {
      setMessage("Asignación creada.");
      setMembershipId("");
      setRoleId("");
      await invalidateRoleData();
    },
  });
  const removeAssignment = useMutation({
    mutationFn: deleteRoleAssignment,
    onSuccess: async () => { setMessage("Asignación retirada."); await invalidateRoleData(); },
  });

  function selectRole(role: OrganizationRoleItem): void {
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setPermissionCodes(role.permissions);
    setMessage("");
  }

  if (!canRead) return <Alert severity="warning">Tu cuenta no tiene permiso para consultar los roles de este tenant.</Alert>;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography color="text.secondary" variant="overline">ADM-04</Typography>
        <Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">Roles y permisos</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>Roles del tenant, permisos efectivos y alcances por organización, empresa o sucursal.</Typography>
      </Box>
      {message && <Alert onClose={() => setMessage("")} severity="success">{message}</Alert>}

      {(canCreate || canUpdate) && <Paper component="form" onSubmit={(event) => { event.preventDefault(); setMessage(""); saveRole.mutate(); }} sx={{ p: { xs: 2, sm: 3 } }} variant="outlined">
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
            <Box><Typography component="h2" variant="h6">{editingRoleId ? "Editar rol" : "Crear rol"}</Typography><Typography color="text.secondary" variant="body2">El servidor valida cada permiso antes de guardarlo.</Typography></Box>
            {editingRoleId && <Button onClick={() => { setEditingRoleId(""); setRoleName(""); setPermissionCodes([]); setMessage(""); }}>Nuevo rol</Button>}
          </Stack>
          <TextField disabled={editingRoleId ? !canUpdate : !canCreate} label="Nombre del rol" onChange={(event) => setRoleName(event.target.value)} required value={roleName} slotProps={{ htmlInput: { maxLength: 120 } }} />
          {catalog.isLoading ? <CircularProgress aria-label="Cargando permisos" size={24} /> : catalog.isError ? <Alert severity="error">{catalog.error.message}</Alert> : <Box sx={{ display: "grid", gap: 0.25, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }}}>
            {catalog.data?.map((permission) => <FormControlLabel
              control={<Checkbox checked={permissionCodes.includes(permission.code)} disabled={editingRoleId ? !canUpdate : !canCreate} onChange={(event) => setPermissionCodes((current) => event.target.checked ? [...current, permission.code] : current.filter((code) => code !== permission.code))} />}
              key={permission.code}
              label={<Box><Typography variant="body2">{permission.code}</Typography><Typography color="text.secondary" variant="caption">{permission.description}</Typography></Box>}
            />)}
          </Box>}
          {saveRole.isError && <Alert severity="error">{saveRole.error.message}</Alert>}
          {(editingRoleId ? canUpdate : canCreate) && <Button disabled={saveRole.isPending || !roleName.trim()} type="submit" variant="contained">{saveRole.isPending ? <CircularProgress color="inherit" size={20} /> : "Guardar rol"}</Button>}
        </Stack>
      </Paper>}

      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Box sx={{ p: 2 }}><Typography component="h2" variant="h6">Catálogo de roles</Typography></Box>
        {roles.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando roles" /></Box> : roles.isError ? <Alert severity="error" sx={{ m: 2 }}>{roles.error.message}</Alert> : roles.data?.items.length ? <>
          <Box sx={{ overflowX: "auto" }}><Table aria-label="Roles del tenant"><TableHead><TableRow><TableCell>Rol</TableCell><TableCell>Estado</TableCell><TableCell>Permisos</TableCell><TableCell>Asignaciones</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead><TableBody>
            {roles.data.items.map((role) => <TableRow hover key={role.id}>
              <TableCell><Typography sx={{ fontWeight: 600 }}>{role.name}</Typography><Typography color="text.secondary" variant="caption">{role.code}</Typography></TableCell>
              <TableCell>{role.status === "ACTIVE" ? "Activo" : "Inactivo"}</TableCell>
              <TableCell>{role.permissions.length}</TableCell><TableCell>{role.assignmentCount}</TableCell>
              <TableCell><Stack direction="row" spacing={0.5}>{canUpdate && <Button onClick={() => selectRole(role)} size="small">Editar</Button>}{canUpdate && <Button disabled={changeRoleStatus.isPending} onClick={() => changeRoleStatus.mutate(role)} size="small">{role.status === "ACTIVE" ? "Desactivar" : "Activar"}</Button>}</Stack></TableCell>
            </TableRow>)}
          </TableBody></Table></Box>
          <PageControls offset={roleOffset} page={roles.data} onChange={setRoleOffset} />
        </> : <Box sx={{ p: 3 }}><Alert severity="info">Este tenant todavía no tiene roles para mostrar.</Alert></Box>}
        {changeRoleStatus.isError && <Alert severity="error" sx={{ m: 2 }}>{changeRoleStatus.error.message}</Alert>}
      </Paper>

      {canAssign && <Paper component="form" onSubmit={(event) => { event.preventDefault(); setMessage(""); addAssignment.mutate(); }} sx={{ p: { xs: 2, sm: 3 } }} variant="outlined">
        <Stack spacing={2}>
          <Box><Typography component="h2" variant="h6">Asignar rol</Typography><Typography color="text.secondary" variant="body2">Solo se asignan roles y permisos incluidos en tu alcance efectivo.</Typography></Box>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <FormControl fullWidth><InputLabel id="role-membership-label">Membresía</InputLabel><Select label="Membresía" labelId="role-membership-label" onChange={(event) => setMembershipId(event.target.value)} value={membershipId}><MenuItem value="">Selecciona una membresía</MenuItem>{memberships.data?.items.map((item) => <MenuItem key={item.id} value={item.id}>{item.name} · {item.detail}</MenuItem>)}</Select></FormControl>
            <FormControl fullWidth><InputLabel id="role-to-assign-label">Rol</InputLabel><Select label="Rol" labelId="role-to-assign-label" onChange={(event) => setRoleId(event.target.value)} value={roleId}><MenuItem value="">Selecciona un rol</MenuItem>{roles.data?.items.filter((item) => item.status === "ACTIVE").map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</Select></FormControl>
            <FormControl fullWidth><InputLabel id="role-scope-label">Alcance</InputLabel><Select label="Alcance" labelId="role-scope-label" onChange={(event) => { const next = event.target.value as RoleScopeType; setScopeType(next); setCompanyId(""); setBranchId(""); }} value={scopeType}><MenuItem value="ORGANIZATION">Organización</MenuItem><MenuItem value="COMPANY">Empresa</MenuItem><MenuItem value="BRANCH">Sucursal</MenuItem></Select></FormControl>
          </Stack>
          {scopeType !== "ORGANIZATION" && <FormControl fullWidth><InputLabel id="role-company-label">Empresa</InputLabel><Select label="Empresa" labelId="role-company-label" onChange={(event) => { setCompanyId(event.target.value); setBranchId(""); }} value={companyId}><MenuItem value="">Selecciona una empresa</MenuItem>{companies.data?.items.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}</Select></FormControl>}
          {scopeType === "BRANCH" && <FormControl fullWidth><InputLabel id="role-branch-label">Sucursal</InputLabel><Select disabled={!companyId} label="Sucursal" labelId="role-branch-label" onChange={(event) => setBranchId(event.target.value)} value={branchId}><MenuItem value="">Selecciona una sucursal</MenuItem>{branches.data?.items.map((item) => <MenuItem key={item.id} value={item.id}>{item.name} · {item.detail}</MenuItem>)}</Select></FormControl>}
          {memberships.isError && <Alert severity="error">{memberships.error.message}</Alert>}
          {companies.isError && <Alert severity="error">{companies.error.message}</Alert>}
          {branches.isError && <Alert severity="error">{branches.error.message}</Alert>}
          {addAssignment.isError && <Alert severity="error">{addAssignment.error.message}</Alert>}
          <Button disabled={addAssignment.isPending || !membershipId || !roleId || (scopeType !== "ORGANIZATION" && !companyId) || (scopeType === "BRANCH" && !branchId)} type="submit" variant="contained">{addAssignment.isPending ? <CircularProgress color="inherit" size={20} /> : "Asignar"}</Button>
        </Stack>
      </Paper>}

      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Box sx={{ p: 2 }}><Typography component="h2" variant="h6">Asignaciones</Typography></Box>
        {assignments.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando asignaciones" /></Box> : assignments.isError ? <Alert severity="error" sx={{ m: 2 }}>{assignments.error.message}</Alert> : assignments.data?.items.length ? <>
          <Box sx={{ overflowX: "auto" }}><Table aria-label="Asignaciones de roles"><TableHead><TableRow><TableCell>Persona</TableCell><TableCell>Rol</TableCell><TableCell>Alcance</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead><TableBody>
            {assignments.data.items.map((assignment) => <TableRow hover key={assignment.id}>
              <TableCell>{assignment.userDisplayName}<Typography color="text.secondary" sx={{ display: "block" }} variant="caption">{assignment.userEmail}</Typography></TableCell>
              <TableCell>{assignment.roleName}{assignment.roleStatus === "INACTIVE" ? " · inactivo" : ""}</TableCell>
              <TableCell>{scopeLabels[assignment.scopeType]}{assignment.branchName ? ` · ${assignment.branchName}` : assignment.companyName ? ` · ${assignment.companyName}` : ""}</TableCell>
              <TableCell>{canAssign && <Button color="error" disabled={removeAssignment.isPending} onClick={() => removeAssignment.mutate(assignment.id)} size="small">Retirar</Button>}</TableCell>
            </TableRow>)}
          </TableBody></Table></Box>
          <PageControls offset={assignmentOffset} page={assignments.data} onChange={setAssignmentOffset} />
        </> : <Box sx={{ p: 3 }}><Alert severity="info">Este tenant todavía no tiene asignaciones para mostrar.</Alert></Box>}
        {removeAssignment.isError && <Alert severity="error" sx={{ m: 2 }}>{removeAssignment.error.message}</Alert>}
      </Paper>
    </Stack>
  );
}

function PageControls({ offset, page, onChange }: { offset: number; page: { total: number }; onChange: (offset: number) => void }): React.JSX.Element {
  return <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", p: 2 }}>
    <Typography color="text.secondary" variant="body2">{page.total === 0 ? "0" : `${offset + 1}–${Math.min(offset + pageSize, page.total)}`} de {page.total}</Typography>
    <Stack direction="row" spacing={1}><Button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>Anterior</Button><Button disabled={offset + pageSize >= page.total} onClick={() => onChange(offset + pageSize)}>Siguiente</Button></Stack>
  </Stack>;
}
