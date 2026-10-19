import { useEffect, useMemo, useState } from "react";
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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import type { BusinessHourDay, BusinessHourInterval, NumberSequence, SettingKey, SettingScopeType } from "@mvp-transporte/contracts";
import {
  createNumberSequence,
  getBusinessHours,
  getEffectiveSettings,
  getInstallationSettings,
  issueSequenceNumber,
  listNumberSequences,
  listSettingOverrides,
  listSettingScopeOptions,
  replaceBusinessHours,
  updateInstallationSetting,
  updateNumberSequence,
  updateSetting,
} from "../auth/auth-client";
import { useAuth } from "../auth/AuthContext";

const pageSize = 20;
const weekdays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const baseSettingKeys: SettingKey[] = ["locale", "currency", "timeZone"];
const identitySettingKeys: SettingKey[] = ["identity.name", "identity.logoUrl", "identity.brandColor"];
type TenantScope = Exclude<SettingScopeType, "INSTALLATION">;
type SequenceForm = { documentType: string; period: string; prefix: string; padding: string };
type SequenceDraft = { prefix: string; padding: string };

const emptySequence: SequenceForm = { documentType: "", period: "ALL", prefix: "", padding: "0" };
const emptyHours = (): BusinessHourDay[] => Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, intervals: [] }));

export function SettingsPage({ installationOnly = false }: { installationOnly?: boolean }): React.JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = user?.selectedOrganizationId;
  const canRead = Boolean(user?.permissions.includes("settings.read"));
  const canUpdate = Boolean(user?.permissions.includes("settings.update"));
  const installationMode = installationOnly;
  const [selectedScope, setSelectedScope] = useState<TenantScope>("ORGANIZATION");
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [scopeOffset, setScopeOffset] = useState(0);
  const [sequenceOffset, setSequenceOffset] = useState(0);
  const [sequenceSearch, setSequenceSearch] = useState("");
  const [activeTab, setActiveTab] = useState(0);
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [hoursDraft, setHoursDraft] = useState<BusinessHourDay[]>(emptyHours);
  const [sequenceForm, setSequenceForm] = useState<SequenceForm>(emptySequence);
  const [sequenceDrafts, setSequenceDrafts] = useState<Record<string, SequenceDraft>>({});
  const [notice, setNotice] = useState("");

  const scopeOptions = useQuery({
    queryKey: ["setting-scope-options", organizationId, scopeOffset],
    queryFn: () => listSettingScopeOptions(100, scopeOffset),
    enabled: !installationMode && canRead && Boolean(organizationId),
  });
  const companies = scopeOptions.data?.companies ?? [];
  const companyScopeOptions = companies.filter((company) => company.canRead || company.canUpdate);
  const branchScopeOptions = companies.flatMap((company) => company.branches
    .filter((branch) => branch.canRead || branch.canUpdate)
    .map((branch) => ({ companyId: company.id, branch })));
  const availableScopes: TenantScope[] = [];
  if (scopeOptions.data?.organization.canRead || scopeOptions.data?.organization.canUpdate) availableScopes.push("ORGANIZATION");
  if (companyScopeOptions.length) availableScopes.push("COMPANY");
  if (branchScopeOptions.length) availableScopes.push("BRANCH");
  const selectedCompany = companies.find((item) => item.id === companyId) ?? null;
  const branches = selectedCompany?.branches ?? [];
  const selectedBranch = branches.find((item) => item.id === branchId) ?? null;
  const canReadTarget = installationMode
    ? Boolean(user?.platformAdmin)
    : selectedScope === "ORGANIZATION"
      ? Boolean(scopeOptions.data?.organization.canRead)
      : selectedScope === "COMPANY"
        ? Boolean(selectedCompany?.canRead)
        : Boolean(selectedBranch?.canRead);
  const canUpdateTarget = installationMode
    ? Boolean(user?.platformAdmin)
    : selectedScope === "ORGANIZATION"
      ? Boolean(scopeOptions.data?.organization.canUpdate)
      : selectedScope === "COMPANY"
        ? Boolean(selectedCompany?.canUpdate)
        : Boolean(selectedBranch?.canUpdate);
  const target = useMemo(() => ({
    ...(selectedScope !== "ORGANIZATION" && companyId ? { companyId } : {}),
    ...(selectedScope === "BRANCH" && branchId ? { branchId } : {}),
  }), [selectedScope, companyId, branchId]);
  const scopeLabel = installationMode ? "Instalación" : selectedScope === "ORGANIZATION" ? "Organización" : selectedScope === "COMPANY" ? selectedCompany?.legalName ?? "Empresa" : selectedBranch?.name ?? "Sucursal";

  const installation = useQuery({
    queryKey: ["installation-settings"],
    queryFn: getInstallationSettings,
    enabled: installationMode && Boolean(user?.platformAdmin),
  });
  const effective = useQuery({
    queryKey: ["effective-settings", organizationId, selectedScope, companyId, branchId],
    queryFn: () => getEffectiveSettings(target),
    enabled: !installationMode && canReadTarget,
  });
  const overrides = useQuery({
    queryKey: ["setting-overrides", organizationId, selectedScope, companyId, branchId],
    queryFn: () => listSettingOverrides(target),
    enabled: !installationMode && canReadTarget,
  });
  const businessHours = useQuery({
    queryKey: ["setting-business-hours", organizationId, companyId, selectedScope === "BRANCH" ? branchId : "company"],
    queryFn: () => getBusinessHours({ companyId, ...(selectedScope === "BRANCH" ? { branchId } : {}) }),
    enabled: !installationMode && selectedScope !== "ORGANIZATION" && Boolean(companyId) && canReadTarget,
  });
  const sequences = useQuery({
    queryKey: ["setting-number-sequences", organizationId, selectedScope, companyId, branchId, sequenceOffset, sequenceSearch],
    queryFn: () => listNumberSequences({ ...target, limit: pageSize, offset: sequenceOffset, search: sequenceSearch }),
    enabled: !installationMode && canReadTarget,
  });

  useEffect(() => {
    if (!scopeOptions.data) return;
    const organizationAvailable = scopeOptions.data.organization.canRead || scopeOptions.data.organization.canUpdate;
    const firstCompanyScope = scopeOptions.data.companies.find((company) => company.canRead || company.canUpdate);
    const firstBranchCompany = scopeOptions.data.companies.find((company) => company.branches.some((branch) => branch.canRead || branch.canUpdate));
    const firstBranchScope = firstBranchCompany?.branches.find((branch) => branch.canRead || branch.canUpdate);
    const currentCompany = scopeOptions.data.companies.find((company) => company.id === companyId);
    const currentBranch = currentCompany?.branches.find((branch) => branch.id === branchId);
    const currentScopeValid = selectedScope === "ORGANIZATION"
      ? organizationAvailable
      : selectedScope === "COMPANY"
        ? Boolean(currentCompany?.canRead || currentCompany?.canUpdate)
        : Boolean(currentBranch && (currentBranch.canRead || currentBranch.canUpdate));
    if (!currentCompany) {
      const fallbackCompanyId = selectedScope === "BRANCH" && firstBranchCompany ? firstBranchCompany.id : firstCompanyScope?.id ?? firstBranchCompany?.id ?? "";
      setCompanyId(fallbackCompanyId);
      const fallbackBranch = scopeOptions.data.companies.find((company) => company.id === fallbackCompanyId)?.branches.find((branch) => branch.canRead || branch.canUpdate);
      setBranchId(fallbackBranch?.id ?? "");
    } else if (selectedScope === "BRANCH" && !currentBranch) {
      const fallbackBranch = currentCompany.branches.find((branch) => branch.canRead || branch.canUpdate);
      if (fallbackBranch) setBranchId(fallbackBranch.id);
    }
    if (!currentScopeValid) {
      if (organizationAvailable) setSelectedScope("ORGANIZATION");
      else if (firstCompanyScope) {
        setSelectedScope("COMPANY");
        setCompanyId(firstCompanyScope.id);
        setBranchId("");
      } else if (firstBranchScope) {
        setSelectedScope("BRANCH");
        setCompanyId(firstBranchCompany?.id ?? "");
        setBranchId(firstBranchScope.id);
      } else setSelectedScope("ORGANIZATION");
    }
  }, [scopeOptions.data, companyId, branchId, selectedScope]);

  useEffect(() => {
    const source = installationMode ? installation.data?.items : overrides.data?.items;
    const effectiveByKey = new Map(effective.data?.items.map((item) => [item.key, item.value]) ?? []);
    const next: Record<string, string> = {};
    for (const key of [...baseSettingKeys, ...identitySettingKeys]) {
      const override = source?.find((item) => item.key === key)?.value;
      const fallback = installationMode ? key === "locale" ? "es" : key === "currency" ? "BOB" : key === "timeZone" ? "America/La_Paz" : "" : effectiveByKey.get(key) ?? "";
      next[key] = override ?? fallback ?? "";
    }
    setSettingDrafts(next);
  }, [installationMode, installation.data, overrides.data, effective.data]);

  useEffect(() => {
    if (businessHours.data) setHoursDraft(businessHours.data.items.map((day) => ({ weekday: day.weekday, intervals: day.intervals.map((interval) => ({ ...interval })) })));
  }, [businessHours.data]);

  const refreshSettings = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["installation-settings"] }),
      queryClient.invalidateQueries({ queryKey: ["effective-settings", organizationId] }),
      queryClient.invalidateQueries({ queryKey: ["setting-overrides", organizationId] }),
    ]);
  };
  const saveSettingMutation = useMutation({
    mutationFn: ({ key, value }: { key: SettingKey; value: string | null }) => installationMode
      ? updateInstallationSetting({ key, value })
      : updateSetting({ scopeType: selectedScope, ...target, key, value }),
    onSuccess: async () => { setNotice("Configuración guardada."); await refreshSettings(); },
  });
  const saveHoursMutation = useMutation({
    mutationFn: () => replaceBusinessHours({ companyId, ...(selectedScope === "BRANCH" ? { branchId } : {}), days: hoursDraft.map(({ weekday, intervals }) => ({ weekday, intervals })) }),
    onSuccess: async () => { setNotice("Horario guardado."); await queryClient.invalidateQueries({ queryKey: ["setting-business-hours", organizationId, companyId] }); },
  });
  const createSequenceMutation = useMutation({
    mutationFn: () => createNumberSequence({
      ...target,
      documentType: sequenceForm.documentType,
      period: sequenceForm.period,
      prefix: sequenceForm.prefix,
      padding: Number(sequenceForm.padding),
    }),
    onSuccess: async () => { setSequenceForm(emptySequence); setSequenceOffset(0); setNotice("Numeración creada."); await queryClient.invalidateQueries({ queryKey: ["setting-number-sequences", organizationId, selectedScope, companyId, branchId] }); },
  });
  const updateSequenceMutation = useMutation({
    mutationFn: ({ sequence, draft }: { sequence: NumberSequence; draft: SequenceDraft }) => updateNumberSequence(sequence.id, { prefix: draft.prefix, padding: Number(draft.padding) }),
    onSuccess: async () => { setNotice("Formato de numeración actualizado."); await queryClient.invalidateQueries({ queryKey: ["setting-number-sequences", organizationId, selectedScope, companyId, branchId] }); },
  });
  const issueSequenceMutation = useMutation({
    mutationFn: issueSequenceNumber,
    onSuccess: async (result) => { setNotice(`Número emitido: ${result.number}`); await queryClient.invalidateQueries({ queryKey: ["setting-number-sequences", organizationId, selectedScope, companyId, branchId] }); },
  });

  if (installationMode && !user?.platformAdmin) return <Alert severity="warning">Solo un administrador de plataforma puede consultar la configuración de instalación.</Alert>;
  if (!installationMode && !canRead) return <Alert severity="warning">Tu cuenta no tiene permiso para consultar la configuración.</Alert>;

  const effectiveValues = new Map(effective.data?.items.map((item) => [item.key, item]) ?? []);
  const mutationError = [saveSettingMutation, saveHoursMutation, createSequenceMutation, updateSequenceMutation, issueSequenceMutation].find((mutation) => mutation.isError)?.error;
  const settingsLoading = installationMode ? installation.isLoading : scopeOptions.isLoading || (canReadTarget && (effective.isLoading || overrides.isLoading));
  const settingsError = installationMode ? installation.error : scopeOptions.error ?? effective.error ?? overrides.error;

  function changeHour(weekday: number, intervalIndex: number, key: keyof BusinessHourInterval, value: string): void {
    setHoursDraft((current) => current.map((day) => {
      if (day.weekday !== weekday) return day;
      const intervals = [...day.intervals];
      while (intervals.length <= intervalIndex) intervals.push(intervals.length === 0 ? { start: "09:00", end: "13:00" } : { start: "14:00", end: "18:00" });
      const currentInterval = intervals[intervalIndex] ?? { start: "09:00", end: "13:00" };
      intervals[intervalIndex] = { ...currentInterval, [key]: value };
      return { ...day, intervals };
    }));
  }

  function addHourInterval(weekday: number): void {
    setHoursDraft((current) => current.map((day) => day.weekday !== weekday || day.intervals.length >= 2 ? day : {
      ...day,
      intervals: [...day.intervals, { start: "14:00", end: "18:00" }],
    }));
  }

  function removeHourInterval(weekday: number, intervalIndex: number): void {
    setHoursDraft((current) => current.map((day) => day.weekday !== weekday ? day : { ...day, intervals: day.intervals.filter((_, index) => index !== intervalIndex) }));
  }

  function saveKey(key: SettingKey): void {
    setNotice("");
    const value = settingDrafts[key]?.trim() ?? "";
    saveSettingMutation.mutate({ key, value: value || null });
  }

  return <Stack spacing={3}>
    <Box>
      <Typography color="text.secondary" variant="overline">ADM-06</Typography>
      <Typography component="h1" sx={{ fontWeight: 700 }} variant="h4">{installationMode ? "Configuración de instalación" : "Configuración"}</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>Administra idioma, moneda, identidad, horarios y numeraciones para el alcance autorizado.</Typography>
    </Box>
    {notice && <Alert onClose={() => setNotice("")} severity="success">{notice}</Alert>}
    {mutationError && <Alert severity="error">{mutationError.message}</Alert>}
    {settingsError && <Alert severity="error">{settingsError instanceof Error ? settingsError.message : "No fue posible cargar la configuración."}</Alert>}

    {!installationMode && scopeOptions.data && <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
        <FormControl sx={{ minWidth: 190 }}><Select aria-label="Alcance de configuración" onChange={(event) => {
          const nextScope = event.target.value as TenantScope;
          setSelectedScope(nextScope);
          setNotice("");
          if (nextScope === "COMPANY" && companyScopeOptions[0]) { setCompanyId(companyScopeOptions[0].id); setBranchId(""); }
          if (nextScope === "BRANCH" && branchScopeOptions[0]) { setCompanyId(branchScopeOptions[0].companyId); setBranchId(branchScopeOptions[0].branch.id); }
          if (nextScope === "ORGANIZATION") setActiveTab(0);
        }} value={availableScopes.includes(selectedScope) ? selectedScope : availableScopes[0] ?? "ORGANIZATION"}>
          {availableScopes.map((scope) => <MenuItem key={scope} value={scope}>{scope === "ORGANIZATION" ? "Organización" : scope === "COMPANY" ? "Empresa" : "Sucursal"}</MenuItem>)}
        </Select></FormControl>
        {selectedScope !== "ORGANIZATION" && <FormControl sx={{ minWidth: 240 }}><Select aria-label="Empresa de configuración" onChange={(event) => {
          const nextCompanyId = event.target.value;
          setCompanyId(nextCompanyId);
          const nextCompany = companies.find((company) => company.id === nextCompanyId);
          setBranchId(selectedScope === "BRANCH" ? nextCompany?.branches.find((branch) => branch.canRead || branch.canUpdate)?.id ?? "" : "");
        }} value={companyId}>
          {companies.filter((company) => selectedScope === "COMPANY" ? company.canRead || company.canUpdate : company.branches.some((branch) => branch.canRead || branch.canUpdate)).map((company) => <MenuItem key={company.id} value={company.id}>{company.legalName}</MenuItem>)}
        </Select></FormControl>}
        {selectedScope === "BRANCH" && <FormControl sx={{ minWidth: 220 }}><Select aria-label="Sucursal de configuración" onChange={(event) => setBranchId(event.target.value)} value={branchId}>
          {branches.map((branch) => <MenuItem key={branch.id} value={branch.id}>{branch.code} · {branch.name}</MenuItem>)}
        </Select></FormControl>}
        <Chip label={`Ámbito: ${scopeLabel}`} variant="outlined" />
      </Stack>
      {selectedScope !== "ORGANIZATION" && scopeOptions.data.totalCompanies > scopeOptions.data.limit && <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1.5 }}>
        <Typography color="text.secondary" variant="body2">Empresas {scopeOffset + 1}–{Math.min(scopeOffset + companies.length, scopeOptions.data.totalCompanies)} de {scopeOptions.data.totalCompanies}</Typography>
        <Button disabled={scopeOffset === 0} onClick={() => setScopeOffset(Math.max(0, scopeOffset - scopeOptions.data.limit))} size="small">Anterior</Button>
        <Button disabled={scopeOffset + scopeOptions.data.limit >= scopeOptions.data.totalCompanies} onClick={() => setScopeOffset(scopeOffset + scopeOptions.data.limit)} size="small">Siguiente</Button>
      </Stack>}
      {!availableScopes.length && <Alert severity="info" sx={{ mt: 2 }}>No hay ámbitos de configuración disponibles para esta membresía.</Alert>}
      {availableScopes.length > 0 && !canReadTarget && <Alert severity="warning" sx={{ mt: 2 }}>Tu cuenta no tiene permiso de lectura para el ámbito seleccionado.</Alert>}
    </Paper>}

    {settingsLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando configuración" /></Box> : canReadTarget && <>
      <Paper variant="outlined">
        <Tabs aria-label="Secciones de configuración" onChange={(_event, value: number) => setActiveTab(value)} scrollButtons="auto" value={activeTab} variant="scrollable">
          <Tab label="General e identidad" />
          {!installationMode && <Tab disabled={selectedScope === "ORGANIZATION"} label="Horario" />}
          {!installationMode && <Tab label="Numeraciones" />}
        </Tabs>
      </Paper>

      {activeTab === 0 && <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography component="h2" sx={{ mb: 2 }} variant="h6">Valores efectivos · {scopeLabel}</Typography>
          <Stack spacing={2}>
            {[...baseSettingKeys, ...identitySettingKeys].map((key) => {
              const identity = key.startsWith("identity.");
              const editable = canUpdateTarget && (!identity || installationMode || selectedScope === "COMPANY");
              const hidden = !identity && installationMode && !baseSettingKeys.includes(key);
              if (hidden) return null;
              const effectiveSetting = effectiveValues.get(key);
              const displayedValue = installationMode ? installation.data?.items.find((item) => item.key === key)?.value ?? settingDrafts[key] ?? "" : effectiveSetting?.value ?? "";
              const source = effectiveSetting?.sourceScopeType ? `Heredado de ${scopeTypeLabel(effectiveSetting.sourceScopeType)}` : identity ? "Predeterminado de la empresa" : "Predeterminado de la instalación";
              const label = settingLabel(key);
              return <Box key={key} sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "1fr", md: "minmax(190px, 0.8fr) minmax(240px, 1.3fr) minmax(160px, 0.8fr)" }, alignItems: "center" }}>
                <Box><Typography sx={{ fontWeight: 600 }}>{label}</Typography><Typography color="text.secondary" variant="caption">{installationMode ? "Instalación" : source}</Typography></Box>
                {editable && (key === "locale" || key === "currency" || key === "timeZone") ? <FormControl size="small"><Select aria-label={label} onChange={(event) => setSettingDrafts((current) => ({ ...current, [key]: event.target.value }))} value={settingDrafts[key] ?? (key === "locale" ? "es" : key === "currency" ? "BOB" : "America/La_Paz")}>
                  {key === "locale" && <MenuItem value="es">Español</MenuItem>}
                  {key === "currency" && <MenuItem value="BOB">Boliviano (BOB)</MenuItem>}
                  {key === "timeZone" && <MenuItem value="America/La_Paz">La Paz (America/La_Paz)</MenuItem>}
                </Select></FormControl> : editable ? <TextField
                  aria-label={label}
                  disabled={!editable}
                  onChange={(event) => setSettingDrafts((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder={key === "identity.logoUrl" ? "https://ejemplo.com/logo.png" : key === "identity.brandColor" ? "#176B5B" : "Nombre de la empresa"}
                  size="small"
                  slotProps={key === "identity.brandColor" ? { htmlInput: { maxLength: 7 } } : undefined}
                  value={settingDrafts[key] ?? ""}
                /> : <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>{displayedValue || "Sin valor"}</Typography>}
                {editable && <Button disabled={saveSettingMutation.isPending || !canUpdate} onClick={() => saveKey(key)} variant="outlined">Guardar</Button>}
              </Box>;
            })}
          </Stack>
          {!installationMode && selectedScope === "BRANCH" && <Alert severity="info" sx={{ mt: 2 }}>La identidad pertenece a la empresa y se hereda en sus sucursales.</Alert>}
          {!installationMode && <Alert severity="info" sx={{ mt: 2 }}>Los valores efectivos se resuelven desde instalación, organización, empresa y sucursal. Usa un campo vacío y guarda para quitar la excepción del ámbito.</Alert>}
        </Paper>
        {!installationMode && overrides.data && <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography component="h2" sx={{ mb: 1 }} variant="h6">Excepciones guardadas en {scopeLabel}</Typography>
          {overrides.data.items.length ? <Stack spacing={1}>{overrides.data.items.map((item) => <Stack direction={{ xs: "column", sm: "row" }} key={item.key} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}><Typography>{settingLabel(item.key)}: {item.value}</Typography><Button disabled={!canUpdateTarget || !canUpdate || saveSettingMutation.isPending} onClick={() => saveSettingMutation.mutate({ key: item.key, value: null })}>Usar valor heredado</Button></Stack>)}</Stack> : <Alert severity="info">Este ámbito no tiene valores propios; aplica los valores heredados.</Alert>}
        </Paper>}
      </Stack>}

      {!installationMode && activeTab === 1 && selectedScope !== "ORGANIZATION" && <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ mb: 2 }}><Typography component="h2" variant="h6">Horario comercial</Typography><Typography color="text.secondary" variant="body2">Lunes a domingo, con hasta dos bloques por día. Las horas usan el horario local configurado.</Typography></Box>
        {businessHours.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 4 }}><CircularProgress aria-label="Cargando horario" /></Box>
          : businessHours.isError ? <Alert severity="error">{businessHours.error.message}</Alert>
            : <Stack spacing={1.5}>
              {hoursDraft.map((day) => <Box key={day.weekday} sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", md: "150px 1fr" }, alignItems: "center" }}>
                <Typography sx={{ fontWeight: 600 }}>{weekdays[day.weekday - 1]}</Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: { sm: "center" } }}>
                  {day.intervals.map((interval, index) => <Stack direction="row" key={index === 0 ? "first" : "second"} spacing={1} sx={{ alignItems: "center" }}>
                    <TextField aria-label={`${weekdays[day.weekday - 1]} bloque ${index + 1} desde`} disabled={!canUpdateTarget || !canUpdate} label="Desde" onChange={(event) => changeHour(day.weekday, index, "start", event.target.value)} size="small" type="time" value={interval.start} slotProps={{ inputLabel: { shrink: true } }} />
                    <TextField aria-label={`${weekdays[day.weekday - 1]} bloque ${index + 1} hasta`} disabled={!canUpdateTarget || !canUpdate} label="Hasta" onChange={(event) => changeHour(day.weekday, index, "end", event.target.value)} size="small" type="time" value={interval.end} slotProps={{ inputLabel: { shrink: true } }} />
                    {canUpdateTarget && canUpdate && <Button onClick={() => removeHourInterval(day.weekday, index)} size="small">Quitar</Button>}
                  </Stack>)}
                  {!day.intervals.length && <Typography color="text.secondary" variant="body2">Cerrado</Typography>}
                  {canUpdateTarget && canUpdate && day.intervals.length < 2 && <Button onClick={() => addHourInterval(day.weekday)} size="small">{day.intervals.length ? "Agregar bloque" : "Agregar horario"}</Button>}
                </Stack>
              </Box>)}
              {selectedScope === "BRANCH" && <Alert severity="info">{businessHours.data?.items.some((day) => day.sourceScopeType === "COMPANY") ? "El horario mostrado se hereda de la empresa. Al guardar, esta sucursal tendrá su propia semana de horarios." : "El horario guardado pertenece a esta sucursal."}</Alert>}
              <Box><Button disabled={!canUpdateTarget || !canUpdate || saveHoursMutation.isPending} onClick={() => saveHoursMutation.mutate()} variant="contained">{saveHoursMutation.isPending ? <CircularProgress color="inherit" size={20} /> : "Guardar horario"}</Button></Box>
            </Stack>}
      </Paper>}

      {!installationMode && activeTab === 2 && <Stack spacing={2}>
        <Paper component="form" onSubmit={(event) => { event.preventDefault(); createSequenceMutation.mutate(); }} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography component="h2" sx={{ mb: 2 }} variant="h6">Nueva numeración · {scopeLabel}</Typography>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
            <TextField label="Tipo documental" onChange={(event) => setSequenceForm((current) => ({ ...current, documentType: event.target.value.toUpperCase() }))} required value={sequenceForm.documentType} />
            <TextField helperText="ALL, AAAA o AAAA-MM" label="Período" onChange={(event) => setSequenceForm((current) => ({ ...current, period: event.target.value.toUpperCase() }))} required value={sequenceForm.period} />
            <TextField label="Prefijo" onChange={(event) => setSequenceForm((current) => ({ ...current, prefix: event.target.value }))} value={sequenceForm.prefix} />
            <TextField slotProps={{ htmlInput: { min: 0, max: 12 } }} label="Dígitos" onChange={(event) => setSequenceForm((current) => ({ ...current, padding: event.target.value }))} type="number" value={sequenceForm.padding} />
            <Button disabled={!canUpdateTarget || !canUpdate || createSequenceMutation.isPending || !sequenceForm.documentType.trim() || !/^ALL$|^\d{4}(-\d{2})?$/u.test(sequenceForm.period) || !/^\d+$/u.test(sequenceForm.padding)} type="submit" variant="contained">Crear numeración</Button>
          </Stack>
        </Paper>
        <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ p: 2, alignItems: { sm: "center" }, justifyContent: "space-between" }}>
            <Typography component="h2" variant="h6">Numeraciones disponibles</Typography>
            <TextField label="Buscar tipo documental" onChange={(event) => { setSequenceOffset(0); setSequenceSearch(event.target.value); }} size="small" value={sequenceSearch} />
          </Stack>
          {sequences.isLoading ? <Box sx={{ display: "grid", placeItems: "center", p: 5 }}><CircularProgress aria-label="Cargando numeraciones" /></Box>
            : sequences.isError ? <Alert severity="error" sx={{ m: 2 }}>{sequences.error.message}</Alert>
              : sequences.data?.items.length ? <Box sx={{ overflowX: "auto" }}><Table aria-label="Numeraciones"><TableHead><TableRow><TableCell>Documento</TableCell><TableCell>Período</TableCell><TableCell>Formato</TableCell><TableCell>Próximo valor</TableCell><TableCell>Acciones</TableCell></TableRow></TableHead><TableBody>
                {sequences.data.items.map((sequence) => {
                  const draft = sequenceDrafts[sequence.id] ?? { prefix: sequence.prefix, padding: String(sequence.padding) };
                  const unused = sequence.nextValue === "1";
                  return <TableRow key={sequence.id}>
                    <TableCell>{sequence.documentType}</TableCell><TableCell>{sequence.period}</TableCell>
                    <TableCell>{canUpdateTarget && canUpdate && unused ? <Stack direction="row" spacing={1}><TextField aria-label={`Prefijo ${sequence.documentType}`} onChange={(event) => setSequenceDrafts((current) => ({ ...current, [sequence.id]: { ...draft, prefix: event.target.value } }))} size="small" value={draft.prefix} /><TextField aria-label={`Dígitos ${sequence.documentType}`} slotProps={{ htmlInput: { min: 0, max: 12 } }} onChange={(event) => setSequenceDrafts((current) => ({ ...current, [sequence.id]: { ...draft, padding: event.target.value } }))} size="small" sx={{ width: 90 }} type="number" value={draft.padding} /></Stack> : `${sequence.prefix}${sequence.period === "ALL" ? "" : `${sequence.period}-`}${"0".repeat(sequence.padding)}…`}</TableCell>
                    <TableCell>{sequence.nextValue}</TableCell>
                    <TableCell><Stack direction={{ xs: "column", sm: "row" }} spacing={0.5}>
                      {canUpdateTarget && canUpdate && unused && <Button disabled={updateSequenceMutation.isPending || !/^\d+$/u.test(draft.padding)} onClick={() => updateSequenceMutation.mutate({ sequence, draft })}>Guardar formato</Button>}
                      {canUpdateTarget && canUpdate && <Button disabled={issueSequenceMutation.isPending} onClick={() => { setNotice(""); issueSequenceMutation.mutate(sequence.id); }}>Emitir siguiente</Button>}
                    </Stack></TableCell>
                  </TableRow>;
                })}
              </TableBody></Table></Box> : <Box sx={{ p: 3 }}><Alert severity="info">No hay numeraciones para este ámbito.</Alert></Box>}
          {sequences.data && <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center", p: 2 }}>
            <Typography color="text.secondary" variant="body2">{sequences.data.total ? `${sequenceOffset + 1}–${Math.min(sequenceOffset + sequences.data.items.length, sequences.data.total)} de ${sequences.data.total}` : "0 de 0"}</Typography>
            <Stack direction="row" spacing={1}>
              <Button disabled={sequenceOffset === 0} onClick={() => setSequenceOffset(Math.max(0, sequenceOffset - pageSize))}>Anterior</Button>
              <Button disabled={sequenceOffset + pageSize >= sequences.data.total} onClick={() => setSequenceOffset(sequenceOffset + pageSize)}>Siguiente</Button>
            </Stack>
          </Stack>}
        </Paper>
        <Alert severity="info">El contador se emite atómicamente. Después del primer número, el tipo, período y formato quedan protegidos contra cambios retrospectivos.</Alert>
      </Stack>}
    </>}
    {!installationMode && !scopeOptions.isLoading && scopeOptions.isError && !settingsError && <Alert severity="error">{scopeOptions.error.message}</Alert>}
  </Stack>;
}

function settingLabel(key: SettingKey): string {
  const labels: Record<SettingKey, string> = {
    locale: "Idioma",
    currency: "Moneda",
    timeZone: "Zona horaria",
    "identity.name": "Nombre de empresa",
    "identity.logoUrl": "URL del logotipo",
    "identity.brandColor": "Color de identidad",
  };
  return labels[key];
}

function scopeTypeLabel(scope: SettingScopeType): string {
  if (scope === "INSTALLATION") return "la instalación";
  if (scope === "ORGANIZATION") return "la organización";
  if (scope === "COMPANY") return "la empresa";
  return "la sucursal";
}
