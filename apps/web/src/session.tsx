import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PropsWithChildren } from "react";

const baseApiUrl = (import.meta.env.VITE_MVP_BASE_API_URL as string | undefined)?.replace(/\/+$/u, "") ?? "http://localhost:4000/api/v1";
const transportApiUrl = (import.meta.env.VITE_TRANSPORT_API_URL as string | undefined)?.replace(/\/+$/u, "") ?? "http://localhost:4100/api/v1/transport";
const csrfStorageKey = "mvp-transporte-csrf";

export interface OrganizationOption {
  id: string;
  name?: string;
  legalName?: string;
  tradeName?: string | null;
  status?: string;
}

interface SessionCredentials {
  accessToken: string;
  csrfToken?: string;
  organizations?: OrganizationOption[];
  selectedOrganizationId?: string | null;
  user?: { id?: string; displayName?: string; email?: string };
}

interface SessionContextValue {
  accessToken: string | null;
  organizations: OrganizationOption[];
  selectedOrganizationId: string | null;
  userName: string;
  restoring: boolean;
  login(email: string, password: string): Promise<void>;
  selectOrganization(id: string): Promise<void>;
  logout(): Promise<void>;
  apiRequest(path: string, init?: RequestInit): Promise<Response>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

async function responseError(response: Response): Promise<Error> {
  try {
    const body = await response.json() as { error?: { message?: string }; message?: string };
    return new Error(body.error?.message ?? body.message ?? `La solicitud falló (${response.status}).`);
  } catch {
    return new Error(`La solicitud falló (${response.status}).`);
  }
}

async function readCredentials(response: Response): Promise<SessionCredentials> {
  if (!response.ok) throw await responseError(response);
  const body = await response.json() as Partial<SessionCredentials>;
  if (typeof body.accessToken !== "string") throw new Error("mvp-base devolvió una sesión no válida.");
  return body as SessionCredentials;
}

export function SessionProvider({ children }: PropsWithChildren) {
  const tokenRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [userName, setUserName] = useState("Usuario");
  const [restoring, setRestoring] = useState(true);

  const applyCredentials = useCallback((credentials: SessionCredentials) => {
    tokenRef.current = credentials.accessToken;
    setAccessToken(credentials.accessToken);
    if (credentials.csrfToken) sessionStorage.setItem(csrfStorageKey, credentials.csrfToken);
    if (credentials.organizations) setOrganizations(credentials.organizations);
    if (credentials.selectedOrganizationId !== undefined) setSelectedOrganizationId(credentials.selectedOrganizationId ?? null);
    if (credentials.user?.displayName || credentials.user?.email) setUserName(credentials.user.displayName ?? credentials.user.email ?? "Usuario");
  }, []);

  const refresh = useCallback((): Promise<boolean> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const request = (async () => {
      const csrfToken = sessionStorage.getItem(csrfStorageKey);
      if (!csrfToken) return false;
      try {
        const response = await fetch(`${baseApiUrl}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "X-CSRF-Token": csrfToken },
        });
        const credentials = await readCredentials(response);
        applyCredentials(credentials);
        return true;
      } catch {
        tokenRef.current = null;
        setAccessToken(null);
        sessionStorage.removeItem(csrfStorageKey);
        return false;
      }
    })();
    refreshInFlightRef.current = request;
    void request.finally(() => {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
    });
    return request;
  }, [applyCredentials]);

  useEffect(() => {
    void refresh().finally(() => setRestoring(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch(`${baseApiUrl}/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const credentials = await readCredentials(response);
    if (!credentials.csrfToken) throw new Error("mvp-base no devolvió el token CSRF de la sesión.");
    applyCredentials(credentials);
  }, [applyCredentials]);

  const selectOrganization = useCallback(async (id: string) => {
    const token = tokenRef.current;
    if (!token) throw new Error("Inicia sesión para continuar.");
    const response = await fetch(`${baseApiUrl}/auth/select-organization`, {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: id }),
    });
    const credentials = await readCredentials(response);
    applyCredentials({ ...credentials, selectedOrganizationId: credentials.selectedOrganizationId ?? id });
  }, [applyCredentials]);

  const logout = useCallback(async () => {
    const csrfToken = sessionStorage.getItem(csrfStorageKey);
    const token = tokenRef.current;
    if (csrfToken) {
      await fetch(`${baseApiUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      }).catch(() => undefined);
    }
    tokenRef.current = null;
    setAccessToken(null);
    setOrganizations([]);
    setSelectedOrganizationId(null);
    setUserName("Usuario");
    sessionStorage.removeItem(csrfStorageKey);
  }, []);

  const apiRequest = useCallback(async (path: string, init: RequestInit = {}) => {
    const send = (token: string | null) => fetch(`${transportApiUrl}${path}`, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers).entries()), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    let response = await send(tokenRef.current);
    if (response.status === 401 && await refresh()) response = await send(tokenRef.current);
    if (!response.ok) throw await responseError(response);
    return response;
  }, [refresh]);

  const value = useMemo<SessionContextValue>(() => ({
    accessToken, organizations, selectedOrganizationId, userName, restoring, login, selectOrganization, logout, apiRequest,
  }), [accessToken, organizations, selectedOrganizationId, userName, restoring, login, selectOrganization, logout, apiRequest]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession requiere SessionProvider.");
  return context;
}
