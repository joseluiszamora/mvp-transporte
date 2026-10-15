import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import type { AuthCredentialsResponse, CurrentUserResponse } from "@mvp-transporte/contracts";
import {
  initializeAuth,
  loadCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  selectOrganization as selectOrganizationRequest,
  subscribeAuthChanges,
} from "./auth-client";

interface AuthContextValue {
  status: "loading" | "anonymous" | "authenticated";
  user: CurrentUserResponse | null;
  login: (email: string, password: string) => Promise<AuthCredentialsResponse>;
  logout: () => Promise<void>;
  selectOrganization: (organizationId: string) => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [user, setUser] = useState<CurrentUserResponse | null>(null);

  const reloadUser = useCallback(async (): Promise<void> => {
    try {
      const current = await loadCurrentUser();
      setUser(current);
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void initializeAuth().then((current) => {
      if (!mounted) {
        return;
      }
      setUser(current);
      setStatus(current ? "authenticated" : "anonymous");
    });
    const unsubscribe = subscribeAuthChanges(() => {
      if (mounted) {
        void reloadUser();
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [reloadUser]);

  const login = useCallback(async (email: string, password: string) => {
    const credentials = await loginRequest(email, password);
    await reloadUser();
    return credentials;
  }, [reloadUser]);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const selectOrganization = useCallback(async (organizationId: string) => {
    const current = await selectOrganizationRequest(organizationId);
    setUser(current);
    setStatus("authenticated");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, selectOrganization, reloadUser }),
    [status, user, login, logout, selectOrganization, reloadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("AuthProvider is required.");
  }
  return context;
}
