import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
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
import type { CatalogItem, CatalogScope, RecordStatus } from "@mvp-transporte/contracts";
import {
  createCatalog,
  createCatalogItem,
  deactivateCatalog,
  deactivateCatalogItem,
  listCatalogItems,
  listCatalogScopeOptions,
  listCatalogs,
  updateCatalog,
  updateCatalogItem,
} from "../auth/auth-client";
import { useAuth } from "../auth/AuthContext";

const pageSize = 20;
type CatalogForm = { code: string; name: string; description: string };
type ItemForm = { code: string; name: string; description: string };
const emptyCatalog: CatalogForm = { code: "", name: "", description: "" };
const emptyItem: ItemForm = { code: "", name: "", description: "" };

export function CatalogsPage(): React.JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = user?.selectedOrganizationId;
  const canRead = Boolean(user?.permissions.includes("catalogs.read"));
  const canManage = Boolean(user?.permissions.includes("catalogs.manage"));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RecordStatus | "">("");
  const [offset, setOffset] = useState(0);
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [catalogForm, setCatalogForm] = useState<CatalogForm>(emptyCatalog);
  const [catalogScope, setCatalogScope] = useState<Exclude<CatalogScope, "GLOBAL">>("ORGANIZATION");
  const [companyId, setCompanyId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [itemStatus, setItemStatus] = useState<RecordStatus | "">("");
  const [itemOffset, setItemOffset] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItem);

  const catalogs = useQuery({
    queryKey: ["catalogs", organizationId, search, status, offset],
    queryFn: () => listCatalogs({ limit: pageSize, offset, search, status: status || undefined }),
    enabled: canRead,
  });
  const scopeOptions = useQuery({
    queryKey: ["catalog-scope-options", organizationId],
    queryFn: () => listCatalogScopeOptions(100, 0),
    enabled: canManage,
  });
  const selectedCatalog = catalogs.data?.items.find((catalog) => catalog.id === selectedCatalogId) ?? null;
  useEffect(() => {
    if (!selectedCatalogId && catalogs.data?.items[0]) setSelectedCatalogId(catalogs.data.items[0].id);
    if (selectedCatalogId && catalogs.data && !catalogs.data.items.some((catalog) => catalog.id === selectedCatalogId)) {
      setSelectedCatalogId(catalogs.data.items[0]?.id ?? "");
    }
  }, [catalogs.data, selectedCatalogId]);
  useEffect(() => {
    if (selectedCatalog) {
      setCatalogForm({ code: selectedCatalog.code, name: selectedCatalog.name, description: selectedCatalog.description ?? "" });
      setSelectedItemId("");
      setItemForm(emptyItem);
      setItemOffset(0);
    }
  }, [selectedCatalog]);
  useEffect(() => {
    if (scopeOptions.data) {
      if (!scopeOptions.data.organization && scopeOptions.data.companies.length > 0) {
        setCatalogScope("COMPANY");
        setCompanyId(scopeOptions.data.companies[0]?.id ?? "");
      } else if (scopeOptions.data.organization) {
        setCatalogScope("ORGANIZATION");
      }
    }
  }, [scopeOptions.data]);

  const items = useQuery({
    queryKey: ["catalog-items", organizationId, selectedCatalogId, itemSearch, itemStatus, itemOffset],
    queryFn: () => listCatalogItems(selectedCatalogId, { limit: pageSize, offset: itemOffset, search: itemSearch, status: itemStatus || undefined }),
    enabled: canRead && Boolean(selectedCatalogId),
  });
  const selectedItem = items.data?.items.find((item) => item.id === selectedItemId) ?? null;
  useEffect(() => {
    if (selectedItem) setItemForm({ code: selectedItem.code, name: selectedItem.name, description: selectedItem.description ?? "" });
  }, [selectedItem]);

  const refreshCatalogs = async (): Promise<void> => { await queryClient.invalidateQueries({ queryKey: ["catalogs", organizationId] }); };
  const refreshItems = async (): Promise<void> => { await queryClient.invalidateQueries({ queryKey: ["catalog-items", organizationId, selectedCatalogId] }); };
  const createCatalogMutation = useMutation({
    mutationFn: () => createCatalog({
      ...catalogForm,
      description: catalogForm.description || null,
      scope: catalogScope,
      ...(catalogScope === "COMPANY" ? { companyId } : {}),
    }),
    onSuccess: async (catalog) => { setCatalogForm(emptyCatalog); setSelectedCatalogId(catalog.id); await refreshCatalogs(); },
  });
  const updateCatalogMutation = useMutation({
    mutationFn: () => selectedCatalog ? updateCatalog(selectedCatalog.id, { name: catalogForm.name, description: catalogForm.description || null }) : Promise.reject(new Error("Selecciona un catálogo.")),
    onSuccess: refreshCatalogs,
  });
  const deactivateCatalogMutation = useMutation({
    mutationFn: (catalogId: string) => deactivateCatalog(catalogId),
    onSuccess: refreshCatalogs,
  });
  const reactivateCatalogMutation = useMutation({
    mutationFn: (catalogId: string) => updateCatalog(catalogId, { status: "ACTIVE" }),
    onSuccess: refreshCatalogs,
  });
  const createItemMutation = useMutation({
    mutationFn: () => selectedCatalog ? createCatalogItem(selectedCatalog.id, { ...itemForm, description: itemForm.description || null }) : Promise.reject(new Error("Selecciona un catálogo.")),
    onSuccess: async (item) => { setSelectedItemId(item.id); await refreshItems(); },
  });
  const updateItemMutation = useMutation({
    mutationFn: () => selectedCatalog && selectedItem ? updateCatalogItem(selectedCatalog.id, selectedItem.id, { ...itemForm, description: itemForm.description || null }) : Promise.reject(new Error("Selecciona una opción.")),
    onSuccess: refreshItems,
  });
  const deactivateItemMutation = useMutation({
    mutationFn: (item: CatalogItem) => selectedCatalog ? deactivateCatalogItem(selectedCatalog.id, item.id) : Promise.reject(new Error("Selecciona un catálogo.")),
    onSuccess: async () => { setSelectedItemId(""); setItemForm(emptyItem); await refreshItems(); },
  });
  const reactivateItemMutation = useMutation({
    mutationFn: (item: CatalogItem) => selectedCatalog ? updateCatalogItem(selectedCatalog.id, item.id, { status: "ACTIVE" }) : Promise.reject(new Error("Selecciona un catálogo.")),
    onSuccess: refreshItems,
  });

  if (!canRead) return <Alert severity="warning">Tu cuenta no tiene permiso para consultar catálogos.</Alert>;
  const mutationError = [createCatalogMutation, updateCatalogMutation, deactivateCatalogMutation, reactivateCatalogMutation, createItemMutation, updateItemMutation, deactivateItemMutation, reactivateItemMutation].find((mutation) => mutation.isError)?.error;
  const scopeCanCreate = Boolean(scopeOptions.data?.organization || scopeOptions.data?.companies.length);
  const itemBusy = deactivateItemMutation.isPending || reactivateItemMutation.isPending;

  return <Stack spacing={3}>
    <Box>
      <Typography color="text.secondary" variant="overline">ADM-10</Typography>
      <Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">Catálogos</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>Consulta catálogos protegidos y administra los que pertenecen a tu organización o empresa.</Typography>
    </Box>
    {mutationError && <Alert severity="error">{mutationError.message}</Alert>}

    {canManage && scopeOptions.isError && <Alert severity="error">{scopeOptions.error.message}</Alert>}
    {canManage && scopeOptions.data && !scopeCanCreate && <Alert severity="info">Tu alcance permite consultar catálogos, pero no crear catálogos de organización o empresa.</Alert>}
    {canManage && scopeCanCreate && <Paper component="form" onSubmit={(event) => { event.preventDefault(); createCatalogMutation.mutate(); }} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography component="h2" sx={{ mb: 2 }} variant="h6">Crear catálogo propio</Typography>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        <TextField label="Código" onChange={(event) => setCatalogForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} required value={catalogForm.code} />
        <TextField label="Nombre" onChange={(event) => setCatalogForm((current) => ({ ...current, name: event.target.value }))} required value={catalogForm.name} />
        <TextField label="Descripción" onChange={(event) => setCatalogForm((current) => ({ ...current, description: event.target.value }))} value={catalogForm.description} />
        <FormControl sx={{ minWidth: 190 }}><Select aria-label="Alcance del catálogo" onChange={(event) => setCatalogScope(event.target.value as Exclude<CatalogScope, "GLOBAL">)} value={catalogScope}>
          {scopeOptions.data?.organization && <MenuItem value="ORGANIZATION">Organización</MenuItem>}
          {(scopeOptions.data?.companies.length ?? 0) > 0 && <MenuItem value="COMPANY">Empresa</MenuItem>}
        </Select></FormControl>
        {catalogScope === "COMPANY" && <FormControl sx={{ minWidth: 220 }}><Select aria-label="Empresa del catálogo" onChange={(event) => setCompanyId(event.target.value)} value={companyId}>
          {scopeOptions.data?.companies.map((company) => <MenuItem key={company.id} value={company.id}>{company.legalName}</MenuItem>)}
        </Select></FormControl>}
        <Button disabled={createCatalogMutation.isPending || !catalogForm.code.trim() || !catalogForm.name.trim() || (catalogScope === "COMPANY" && !companyId)} type="submit" variant="contained">{createCatalogMutation.isPending ? <CircularProgress color="inherit" size={21} /> : "Crear catálogo"}</Button>
      </Stack>
    </Paper>}

    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ p: 2, alignItems: { sm: "center" }, justifyContent: "space-between" }} spacing={2}>
        <Typography component="h2" variant="h6">Catálogos disponibles</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <TextField label="Buscar catálogo" onChange={(event) => { setOffset(0); setSearch(event.target.value); }} size="small" value={search} />
          <FormControl size="small" sx={{ minWidth: 160 }}><Select aria-label="Filtrar catálogos por estado" displayEmpty onChange={(event) => { setOffset(0); setStatus(event.target.value as RecordStatus | ""); }} value={status}><MenuItem value="">Todos los estados</MenuItem><MenuItem value="ACTIVE">Activos</MenuItem><MenuItem value="INACTIVE">Inactivos</MenuItem></Select></FormControl>
        </Stack>
      </Stack>
      {catalogs.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando catálogos" /></Box>
        : catalogs.isError ? <Alert severity="error" sx={{ m: 2 }}>{catalogs.error.message}</Alert>
          : catalogs.data?.items.length ? <>
            <Box sx={{ overflowX: "auto" }}><Table aria-label="Catálogos"><TableHead><TableRow><TableCell>Código</TableCell><TableCell>Nombre</TableCell><TableCell>Alcance</TableCell><TableCell>Estado</TableCell><TableCell>Protección</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead><TableBody>
              {catalogs.data.items.map((catalog) => <TableRow hover key={catalog.id} selected={catalog.id === selectedCatalogId}>
                <TableCell><Button onClick={() => setSelectedCatalogId(catalog.id)}>{catalog.code}</Button></TableCell><TableCell>{catalog.name}{catalog.scope === "COMPANY" && <Typography color="text.secondary" component="div" sx={{ display: "block" }} variant="caption">{catalog.companyName}</Typography>}</TableCell><TableCell>{scopeLabel(catalog.scope)}</TableCell><TableCell>{catalog.status === "ACTIVE" ? "Activo" : "Inactivo"}</TableCell><TableCell>{catalog.protected ? <Chip color="info" label="Protegido" size="small" variant="outlined" /> : "—"}</TableCell>
                <TableCell>{catalog.canManage && (catalog.status === "ACTIVE" ? <Button disabled={deactivateCatalogMutation.isPending} onClick={() => deactivateCatalogMutation.mutate(catalog.id)}>Desactivar</Button> : <Button disabled={reactivateCatalogMutation.isPending} onClick={() => reactivateCatalogMutation.mutate(catalog.id)}>Reactivar</Button>)}</TableCell>
              </TableRow>)}
            </TableBody></Table></Box>
            <Pager offset={offset} total={catalogs.data.total} onChange={setOffset} />
          </> : <Box sx={{ p: 3 }}><Alert severity="info">No hay catálogos que coincidan con estos filtros.</Alert></Box>}
    </Paper>

    {selectedCatalog && <>
      {selectedCatalog.canManage && <Paper component="form" onSubmit={(event) => { event.preventDefault(); updateCatalogMutation.mutate(); }} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography component="h2" sx={{ mb: 2 }} variant="h6">Editar catálogo</Typography>
        {selectedCatalog.status === "INACTIVE" && <Alert severity="info" sx={{ mb: 2 }}>Reactiva el catálogo antes de editarlo.</Alert>}
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
          <TextField disabled={selectedCatalog.status === "INACTIVE"} label="Código" value={selectedCatalog.code} />
          <TextField disabled={selectedCatalog.status === "INACTIVE"} label="Nombre" onChange={(event) => setCatalogForm((current) => ({ ...current, name: event.target.value }))} required value={catalogForm.name} />
          <TextField disabled={selectedCatalog.status === "INACTIVE"} label="Descripción" onChange={(event) => setCatalogForm((current) => ({ ...current, description: event.target.value }))} value={catalogForm.description} />
          <Button disabled={selectedCatalog.status === "INACTIVE" || updateCatalogMutation.isPending} type="submit" variant="outlined">Guardar cambios</Button>
        </Stack>
      </Paper>}
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Stack direction={{ xs: "column", sm: "row" }} sx={{ p: 2, alignItems: { sm: "center" }, justifyContent: "space-between" }} spacing={2}>
          <Box><Typography component="h2" variant="h6">Opciones · {selectedCatalog.name}</Typography>{selectedCatalog.protected && <Typography color="text.secondary" variant="body2">Este catálogo de sistema es de solo lectura.</Typography>}</Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField label="Buscar opción" onChange={(event) => { setItemOffset(0); setItemSearch(event.target.value); }} size="small" value={itemSearch} />
            <FormControl size="small" sx={{ minWidth: 150 }}><Select aria-label="Filtrar opciones por estado" displayEmpty onChange={(event) => { setItemOffset(0); setItemStatus(event.target.value as RecordStatus | ""); }} value={itemStatus}><MenuItem value="">Todos los estados</MenuItem><MenuItem value="ACTIVE">Activas</MenuItem><MenuItem value="INACTIVE">Inactivas</MenuItem></Select></FormControl>
          </Stack>
        </Stack>
        {items.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando opciones" /></Box>
          : items.isError ? <Alert severity="error" sx={{ m: 2 }}>{items.error.message}</Alert>
            : items.data?.items.length ? <>
              <Box sx={{ overflowX: "auto" }}><Table aria-label="Opciones del catálogo"><TableHead><TableRow><TableCell>Código</TableCell><TableCell>Nombre</TableCell><TableCell>Descripción</TableCell><TableCell>Estado</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead><TableBody>
                {items.data.items.map((item) => <TableRow hover key={item.id} selected={item.id === selectedItemId}>
                  <TableCell><Button disabled={!selectedCatalog.canManage || item.status === "INACTIVE"} onClick={() => setSelectedItemId(item.id)}>{item.code}</Button></TableCell><TableCell>{item.name}</TableCell><TableCell>{item.description ?? "—"}</TableCell><TableCell>{item.status === "ACTIVE" ? "Activa" : "Inactiva"}</TableCell>
                  <TableCell>{selectedCatalog.canManage && (item.status === "ACTIVE" ? <Button disabled={itemBusy} onClick={() => deactivateItemMutation.mutate(item)}>Desactivar</Button> : <Button disabled={itemBusy} onClick={() => reactivateItemMutation.mutate(item)}>Reactivar</Button>)}</TableCell>
                </TableRow>)}
              </TableBody></Table></Box>
              <Pager offset={itemOffset} total={items.data.total} onChange={setItemOffset} />
            </> : <Box sx={{ p: 3 }}><Alert severity="info">No hay opciones que coincidan con estos filtros.</Alert></Box>}
      </Paper>
      {selectedCatalog.canManage && selectedCatalog.status === "ACTIVE" && <Paper component="form" onSubmit={(event) => { event.preventDefault(); selectedItem ? updateItemMutation.mutate() : createItemMutation.mutate(); }} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography component="h2" sx={{ mb: 2 }} variant="h6">{selectedItem ? "Editar opción seleccionada" : "Agregar opción"}</Typography>
        {selectedItem?.status === "INACTIVE" && <Alert severity="info" sx={{ mb: 2 }}>Reactiva la opción antes de editar sus datos.</Alert>}
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
          <TextField disabled={Boolean(selectedItem?.status === "INACTIVE")} label="Código" onChange={(event) => setItemForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} required value={itemForm.code} />
          <TextField disabled={Boolean(selectedItem?.status === "INACTIVE")} label="Nombre" onChange={(event) => setItemForm((current) => ({ ...current, name: event.target.value }))} required value={itemForm.name} />
          <TextField disabled={Boolean(selectedItem?.status === "INACTIVE")} label="Descripción" onChange={(event) => setItemForm((current) => ({ ...current, description: event.target.value }))} value={itemForm.description} />
          <Button disabled={selectedItem?.status === "INACTIVE" || createItemMutation.isPending || updateItemMutation.isPending || !itemForm.code.trim() || !itemForm.name.trim()} type="submit" variant="contained">{createItemMutation.isPending || updateItemMutation.isPending ? <CircularProgress color="inherit" size={21} /> : selectedItem ? "Guardar opción" : "Agregar opción"}</Button>
          {selectedItem && <Button onClick={() => { setSelectedItemId(""); setItemForm(emptyItem); }} type="button">Cancelar edición</Button>}
        </Stack>
      </Paper>}
    </>}
  </Stack>;
}

function scopeLabel(scope: CatalogScope): string {
  if (scope === "GLOBAL") return "Global";
  return scope === "COMPANY" ? "Empresa" : "Organización";
}

function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (nextOffset: number) => void }): React.JSX.Element {
  return <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center", p: 2 }}>
    <Typography color="text.secondary" variant="body2">{offset + 1}–{Math.min(offset + pageSize, total)} de {total}</Typography>
    <Stack direction="row" spacing={1}>
      <Button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>Anterior</Button>
      <Button disabled={offset + pageSize >= total} onClick={() => onChange(offset + pageSize)}>Siguiente</Button>
    </Stack>
  </Stack>;
}
