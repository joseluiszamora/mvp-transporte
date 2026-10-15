import { useEffect, useState } from "react";
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
import type { BranchItem, RecordStatus } from "@mvp-transporte/contracts";
import {
  createTenantBranch,
  createTenantCompany,
  deactivateTenantBranch,
  deactivateTenantCompany,
  listTenantBranches,
  listTenantCompanies,
  updateTenantBranch,
  updateTenantCompany,
} from "../auth/auth-client";
import { useAuth } from "../auth/AuthContext";

const pageSize = 20;
type CompanyInput = { legalName: string; tradeName: string; nit: string; contact: string; address: string };
type BranchInput = { code: string; name: string; contact: string; address: string };
const emptyCompany: CompanyInput = { legalName: "", tradeName: "", nit: "", contact: "", address: "" };
const emptyBranch: BranchInput = { code: "", name: "", contact: "", address: "" };

export function TenantOrganizationsPage(): React.JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = user?.selectedOrganizationId;
  const canReadCompanies = Boolean(user?.permissions.includes("companies.read"));
  const canReadBranches = Boolean(user?.permissions.includes("branches.read"));
  const [companySearch, setCompanySearch] = useState("");
  const [companyStatus, setCompanyStatus] = useState<RecordStatus | "">("");
  const [companyOffset, setCompanyOffset] = useState(0);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [newCompanyForm, setNewCompanyForm] = useState<CompanyInput>(emptyCompany);
  const [editCompanyForm, setEditCompanyForm] = useState<CompanyInput>(emptyCompany);
  const [branchSearch, setBranchSearch] = useState("");
  const [branchStatus, setBranchStatus] = useState<RecordStatus | "">("");
  const [branchOffset, setBranchOffset] = useState(0);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchForm, setBranchForm] = useState<BranchInput>(emptyBranch);

  const companies = useQuery({
    queryKey: ["tenant-companies", organizationId, companySearch, companyStatus, companyOffset],
    queryFn: () => listTenantCompanies({ limit: pageSize, offset: companyOffset, search: companySearch, status: companyStatus || undefined }),
    enabled: canReadCompanies,
  });
  const selectedCompany = companies.data?.items.find((company) => company.id === selectedCompanyId) ?? null;
  useEffect(() => {
    if (!selectedCompanyId && companies.data?.items[0]) setSelectedCompanyId(companies.data.items[0].id);
    if (selectedCompanyId && companies.data && !companies.data.items.some((company) => company.id === selectedCompanyId)) {
      setSelectedCompanyId(companies.data.items[0]?.id ?? "");
    }
  }, [companies.data, selectedCompanyId]);
  useEffect(() => {
    if (selectedCompany) {
      setEditCompanyForm({
        legalName: selectedCompany.legalName,
        tradeName: selectedCompany.tradeName ?? "",
        nit: selectedCompany.nit ?? "",
        contact: selectedCompany.contact ?? "",
        address: selectedCompany.address ?? "",
      });
      setSelectedBranchId("");
      setBranchForm(emptyBranch);
      setBranchOffset(0);
    }
  }, [selectedCompany]);

  const branches = useQuery({
    queryKey: ["tenant-branches", organizationId, canReadCompanies ? selectedCompanyId : "scoped", branchSearch, branchStatus, branchOffset],
    queryFn: () => listTenantBranches({ companyId: canReadCompanies ? selectedCompanyId : undefined, limit: pageSize, offset: branchOffset, search: branchSearch, status: branchStatus || undefined }),
    enabled: canReadBranches && (!canReadCompanies || Boolean(selectedCompanyId)),
  });
  const selectedBranch = branches.data?.items.find((branch) => branch.id === selectedBranchId) ?? null;
  const branchCompanyId = canReadCompanies ? selectedCompanyId : selectedBranch?.companyId ?? branches.data?.items[0]?.companyId ?? "";
  const branchCompanyName = branches.data?.items.find((branch) => branch.companyId === branchCompanyId)?.companyName;
  const selectedCompanyForBranches = selectedCompany ?? (branchCompanyId && branchCompanyName ? { id: branchCompanyId, legalName: branchCompanyName, status: "ACTIVE" as const } : null);
  useEffect(() => {
    if (selectedBranch) {
      setBranchForm({ code: selectedBranch.code, name: selectedBranch.name, contact: selectedBranch.contact ?? "", address: selectedBranch.address ?? "" });
    }
  }, [selectedBranch]);

  const invalidateCompanies = async (): Promise<void> => { await queryClient.invalidateQueries({ queryKey: ["tenant-companies", organizationId] }); };
  const invalidateBranches = async (): Promise<void> => { await queryClient.invalidateQueries({ queryKey: ["tenant-branches", organizationId] }); };
  const createCompany = useMutation({ mutationFn: (input: CompanyInput) => createTenantCompany({ ...input, tradeName: input.tradeName || null, nit: input.nit || null, contact: input.contact || null, address: input.address || null }), onSuccess: async (company) => { setSelectedCompanyId(company.id); setNewCompanyForm(emptyCompany); await invalidateCompanies(); } });
  const updateCompany = useMutation({ mutationFn: ({ id, input }: { id: string; input: CompanyInput }) => updateTenantCompany(id, { ...input, tradeName: input.tradeName || null, nit: input.nit || null, contact: input.contact || null, address: input.address || null }), onSuccess: invalidateCompanies });
  const deactivateCompany = useMutation({ mutationFn: (id: string) => deactivateTenantCompany(id), onSuccess: invalidateCompanies });
  const reactivateCompany = useMutation({ mutationFn: (id: string) => updateTenantCompany(id, { status: "ACTIVE" }), onSuccess: invalidateCompanies });
  const saveBranch = useMutation({
    mutationFn: (input: BranchInput) => selectedBranch
      ? updateTenantBranch(selectedBranch.id, { ...input, address: input.address || null, contact: input.contact || null })
      : createTenantBranch(branchCompanyId, { ...input, address: input.address || null, contact: input.contact || null }),
    onSuccess: async (branch) => { setSelectedBranchId(branch.id); await invalidateBranches(); },
  });
  const deactivateBranch = useMutation({ mutationFn: (id: string) => deactivateTenantBranch(id), onSuccess: async () => { setSelectedBranchId(""); setBranchForm(emptyBranch); await invalidateBranches(); } });
  const reactivateBranch = useMutation({ mutationFn: (id: string) => updateTenantBranch(id, { status: "ACTIVE" }), onSuccess: invalidateBranches });

  if (!canReadCompanies && !canReadBranches) return <Alert severity="warning">Tu cuenta no tiene permiso para consultar empresas ni sucursales.</Alert>;

  const updateNewCompanyField = (field: keyof CompanyInput, value: string): void => setNewCompanyForm((current) => ({ ...current, [field]: value }));
  const updateEditCompanyField = (field: keyof CompanyInput, value: string): void => setEditCompanyForm((current) => ({ ...current, [field]: value }));
  const updateBranchField = (field: keyof BranchInput, value: string): void => setBranchForm((current) => ({ ...current, [field]: value }));
  const actionError = createCompany.error ?? updateCompany.error ?? deactivateCompany.error ?? reactivateCompany.error ?? saveBranch.error ?? deactivateBranch.error ?? reactivateBranch.error;

  return <Stack spacing={3}>
    <Box>
      <Typography color="text.secondary" variant="overline">ADM-01</Typography>
      <Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">Empresas y sucursales</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>Gestiona las razones sociales y sucursales de la organización seleccionada.</Typography>
    </Box>
    {actionError && <Alert severity="error">{actionError.message}</Alert>}

    {canReadCompanies && user?.permissions.includes("companies.create") && <Paper component="form" onSubmit={(event) => { event.preventDefault(); createCompany.mutate(newCompanyForm); }} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography component="h2" sx={{ mb: 2 }} variant="h6">Registrar empresa</Typography>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        <TextField label="Razón social" onChange={(event) => updateNewCompanyField("legalName", event.target.value)} required value={newCompanyForm.legalName} />
        <TextField label="Nombre comercial" onChange={(event) => updateNewCompanyField("tradeName", event.target.value)} value={newCompanyForm.tradeName} />
        <TextField label="NIT" onChange={(event) => updateNewCompanyField("nit", event.target.value)} value={newCompanyForm.nit} />
        <TextField label="Contacto" onChange={(event) => updateNewCompanyField("contact", event.target.value)} value={newCompanyForm.contact} />
        <TextField label="Dirección" onChange={(event) => updateNewCompanyField("address", event.target.value)} value={newCompanyForm.address} />
        <Button disabled={createCompany.isPending} type="submit" variant="contained">{createCompany.isPending ? <CircularProgress color="inherit" size={21} /> : "Crear empresa"}</Button>
      </Stack>
    </Paper>}

    {canReadCompanies && <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ p: 2, alignItems: { sm: "center" }, justifyContent: "space-between" }} spacing={2}>
        <Typography component="h2" variant="h6">Empresas</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField label="Buscar empresa" onChange={(event) => { setCompanyOffset(0); setCompanySearch(event.target.value); }} size="small" value={companySearch} />
          <FormControl size="small" sx={{ minWidth: 160 }}><Select aria-label="Filtrar empresas por estado" displayEmpty onChange={(event) => { setCompanyOffset(0); setCompanyStatus(event.target.value as RecordStatus | ""); }} value={companyStatus}><MenuItem value="">Todos los estados</MenuItem><MenuItem value="ACTIVE">Activas</MenuItem><MenuItem value="INACTIVE">Inactivas</MenuItem></Select></FormControl>
        </Stack>
      </Stack>
      {companies.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando empresas" /></Box>
        : companies.isError ? <Alert severity="error" sx={{ m: 2 }}>{companies.error.message}</Alert>
          : companies.data?.items.length ? <>
            <Box sx={{ overflowX: "auto" }}><Table aria-label="Empresas de la organización"><TableHead><TableRow><TableCell>Razón social</TableCell><TableCell>NIT</TableCell><TableCell>Estado</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead><TableBody>
              {companies.data.items.map((company) => <TableRow hover key={company.id} selected={company.id === selectedCompanyId}>
                <TableCell><Button onClick={() => setSelectedCompanyId(company.id)} sx={{ justifyContent: "flex-start", textAlign: "left" }}>{company.legalName}</Button></TableCell><TableCell>{company.nit ?? "—"}</TableCell><TableCell>{company.status === "ACTIVE" ? "Activa" : "Inactiva"}</TableCell>
                <TableCell>{company.status === "ACTIVE" ? <Button disabled={!user?.permissions.includes("companies.deactivate") || deactivateCompany.isPending} onClick={() => deactivateCompany.mutate(company.id)}>Desactivar</Button> : <Button disabled={!user?.permissions.includes("companies.update") || reactivateCompany.isPending} onClick={() => reactivateCompany.mutate(company.id)}>Reactivar</Button>}</TableCell>
              </TableRow>)}
            </TableBody></Table></Box>
            <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center", p: 2 }}><Typography color="text.secondary" variant="body2">{companyOffset + 1}–{Math.min(companyOffset + pageSize, companies.data.total)} de {companies.data.total}</Typography><Stack direction="row" spacing={1}><Button disabled={companyOffset === 0} onClick={() => setCompanyOffset(Math.max(0, companyOffset - pageSize))}>Anterior</Button><Button disabled={companyOffset + pageSize >= companies.data.total} onClick={() => setCompanyOffset(companyOffset + pageSize)}>Siguiente</Button></Stack></Stack>
          </> : <Box sx={{ p: 3 }}><Alert severity="info">No hay empresas que coincidan con estos filtros.</Alert></Box>}
    </Paper>}

    {canReadCompanies && selectedCompany && user?.permissions.includes("companies.update") && <Paper component="form" onSubmit={(event) => { event.preventDefault(); updateCompany.mutate({ id: selectedCompany.id, input: editCompanyForm }); }} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography component="h2" sx={{ mb: 2 }} variant="h6">Editar empresa seleccionada</Typography>
      {selectedCompany.status === "INACTIVE" && <Alert severity="info" sx={{ mb: 2 }}>Reactiva la empresa antes de editar sus datos.</Alert>}
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        <TextField disabled={selectedCompany.status === "INACTIVE"} label="Razón social" onChange={(event) => updateEditCompanyField("legalName", event.target.value)} required value={editCompanyForm.legalName} />
        <TextField disabled={selectedCompany.status === "INACTIVE"} label="Nombre comercial" onChange={(event) => updateEditCompanyField("tradeName", event.target.value)} value={editCompanyForm.tradeName} />
        <TextField disabled={selectedCompany.status === "INACTIVE"} label="NIT" onChange={(event) => updateEditCompanyField("nit", event.target.value)} value={editCompanyForm.nit} />
        <TextField disabled={selectedCompany.status === "INACTIVE"} label="Contacto" onChange={(event) => updateEditCompanyField("contact", event.target.value)} value={editCompanyForm.contact} />
        <TextField disabled={selectedCompany.status === "INACTIVE"} label="Dirección" onChange={(event) => updateEditCompanyField("address", event.target.value)} value={editCompanyForm.address} />
        <Button disabled={selectedCompany.status === "INACTIVE" || updateCompany.isPending} type="submit" variant="outlined">Guardar empresa</Button>
      </Stack>
    </Paper>}

    {canReadBranches && selectedCompanyForBranches && <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ p: 2, alignItems: { sm: "center" }, justifyContent: "space-between" }} spacing={2}>
        <Box><Typography component="h2" variant="h6">{canReadCompanies ? "Sucursales" : "Sucursales autorizadas"}</Typography><Typography color="text.secondary" variant="body2">{canReadCompanies ? selectedCompanyForBranches.legalName : "Solo se muestran sucursales dentro de tu alcance."}</Typography></Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}><TextField label="Buscar sucursal" onChange={(event) => { setBranchOffset(0); setBranchSearch(event.target.value); }} size="small" value={branchSearch} /><FormControl size="small" sx={{ minWidth: 160 }}><Select aria-label="Filtrar sucursales por estado" displayEmpty onChange={(event) => { setBranchOffset(0); setBranchStatus(event.target.value as RecordStatus | ""); }} value={branchStatus}><MenuItem value="">Todos los estados</MenuItem><MenuItem value="ACTIVE">Activas</MenuItem><MenuItem value="INACTIVE">Inactivas</MenuItem></Select></FormControl></Stack>
      </Stack>
      {branches.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando sucursales" /></Box>
        : branches.isError ? <Alert severity="error" sx={{ m: 2 }}>{branches.error.message}</Alert>
          : branches.data?.items.length ? <>
            <Box sx={{ overflowX: "auto" }}><Table aria-label="Sucursales de la empresa"><TableHead><TableRow>{!canReadCompanies && <TableCell>Empresa</TableCell>}<TableCell>Código</TableCell><TableCell>Sucursal</TableCell><TableCell>Estado</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead><TableBody>
              {branches.data.items.map((branch) => <BranchRow key={branch.id} branch={branch} showCompany={!canReadCompanies} selected={branch.id === selectedBranchId} canUpdate={Boolean(user?.permissions.includes("branches.update"))} canDeactivate={Boolean(user?.permissions.includes("branches.deactivate"))} busy={deactivateBranch.isPending || reactivateBranch.isPending} onSelect={() => { setSelectedBranchId(branch.id); if (!canReadCompanies) setSelectedCompanyId(branch.companyId); }} onDeactivate={() => deactivateBranch.mutate(branch.id)} onReactivate={() => reactivateBranch.mutate(branch.id)} />)}
            </TableBody></Table></Box>
            <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center", p: 2 }}><Typography color="text.secondary" variant="body2">{branchOffset + 1}–{Math.min(branchOffset + pageSize, branches.data.total)} de {branches.data.total}</Typography><Stack direction="row" spacing={1}><Button disabled={branchOffset === 0} onClick={() => setBranchOffset(Math.max(0, branchOffset - pageSize))}>Anterior</Button><Button disabled={branchOffset + pageSize >= branches.data.total} onClick={() => setBranchOffset(branchOffset + pageSize)}>Siguiente</Button></Stack></Stack>
          </> : <Box sx={{ p: 3 }}><Alert severity="info">No hay sucursales que coincidan con estos filtros.</Alert></Box>}
    </Paper>}

    {selectedCompanyForBranches && selectedCompanyForBranches.status === "ACTIVE" && (user?.permissions.includes("branches.create") || (selectedBranch && user?.permissions.includes("branches.update"))) && <Paper component="form" onSubmit={(event) => { event.preventDefault(); saveBranch.mutate(branchForm); }} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography component="h2" sx={{ mb: 2 }} variant="h6">{selectedBranch ? "Editar sucursal" : "Registrar sucursal"}</Typography>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        <TextField disabled={Boolean(selectedBranch && selectedBranch.status === "INACTIVE")} label="Código" onChange={(event) => updateBranchField("code", event.target.value.toUpperCase())} required value={branchForm.code} />
        <TextField disabled={Boolean(selectedBranch && selectedBranch.status === "INACTIVE")} label="Nombre" onChange={(event) => updateBranchField("name", event.target.value)} required value={branchForm.name} />
        <TextField disabled={Boolean(selectedBranch && selectedBranch.status === "INACTIVE")} label="Contacto" onChange={(event) => updateBranchField("contact", event.target.value)} value={branchForm.contact} />
        <TextField disabled={Boolean(selectedBranch && selectedBranch.status === "INACTIVE")} label="Dirección" onChange={(event) => updateBranchField("address", event.target.value)} value={branchForm.address} />
        <Button disabled={saveBranch.isPending || Boolean(selectedBranch && selectedBranch.status === "INACTIVE")} type="submit" variant="contained">{saveBranch.isPending ? <CircularProgress color="inherit" size={21} /> : selectedBranch ? "Guardar sucursal" : "Crear sucursal"}</Button>
        {selectedBranch && <Button onClick={() => { setSelectedBranchId(""); setBranchForm(emptyBranch); }} type="button">Cancelar edición</Button>}
      </Stack>
      {selectedBranch?.status === "INACTIVE" && <Alert severity="info" sx={{ mt: 2 }}>Reactiva la sucursal antes de editar sus datos.</Alert>}
    </Paper>}
  </Stack>;
}

function BranchRow({ branch, showCompany, selected, canUpdate, canDeactivate, busy, onSelect, onDeactivate, onReactivate }: {
  branch: BranchItem;
  showCompany: boolean;
  selected: boolean;
  canUpdate: boolean;
  canDeactivate: boolean;
  busy: boolean;
  onSelect: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
}): React.JSX.Element {
  return <TableRow hover selected={selected}>
    {showCompany && <TableCell>{branch.companyName}</TableCell>}<TableCell><Button onClick={onSelect}>{branch.code}</Button></TableCell><TableCell>{branch.name}</TableCell><TableCell>{branch.status === "ACTIVE" ? "Activa" : "Inactiva"}</TableCell>
    <TableCell>{branch.status === "ACTIVE" ? <Button disabled={!canDeactivate || busy} onClick={onDeactivate}>Desactivar</Button> : <Button disabled={!canUpdate || busy} onClick={onReactivate}>Reactivar</Button>}</TableCell>
  </TableRow>;
}
