"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { UserRole, UserRoleType } from "@/domain/complaint";
import { apiClient, AuthMeResponse } from "@/presentation/services/apiClient";

export interface RoleThemeTokens {
  primary: string;
  secondary: string;
  accent: string;
  surface: string;
  text: string;
  btnText: string;
}

export const ROLE_THEMES: Record<UserRoleType, RoleThemeTokens> = {
  [UserRole.ROLE_STUDENT]: {
    primary: "#7FA8D9",
    secondary: "#B8D0EC",
    accent: "#EAF2FB",
    surface: "#FAFCFE",
    text: "#33475B",
    btnText: "#1E3A5F",
  },
  [UserRole.ROLE_FACULTY]: {
    primary: "#7FA8D9",
    secondary: "#B8D0EC",
    accent: "#EAF2FB",
    surface: "#FAFCFE",
    text: "#33475B",
    btnText: "#1E3A5F",
  },
  [UserRole.ROLE_HANDLER]: {
    primary: "#7FC4B2",
    secondary: "#B7E0D3",
    accent: "#E9F6F1",
    surface: "#FAFDFC",
    text: "#2E4A42",
    btnText: "#1A3830",
  },
  [UserRole.ROLE_DEPT_HEAD]: {
    primary: "#B39DDB",
    secondary: "#D6C6EC",
    accent: "#F3EDFA",
    surface: "#FCFAFE",
    text: "#43395A",
    btnText: "#2B1E40",
  },
  [UserRole.ROLE_ADMIN]: {
    primary: "#9FB4C7",
    secondary: "#C7D5E0",
    accent: "#EEF3F7",
    surface: "#FBFCFD",
    text: "#37495A",
    btnText: "#1C2B38",
  },
  [UserRole.ROLE_MANAGEMENT]: {
    primary: "#E3A6AE",
    secondary: "#F0C9CE",
    accent: "#FBEDEF",
    surface: "#FEFAFA",
    text: "#5C333A",
    btnText: "#3D1C22",
  },
};

export function applyRoleTheme(role: UserRoleType): void {
  if (typeof document === "undefined") return;
  const theme = ROLE_THEMES[role] || ROLE_THEMES[UserRole.ROLE_STUDENT];
  const root = document.documentElement;

  root.style.setProperty("--role-primary", theme.primary);
  root.style.setProperty("--role-secondary", theme.secondary);
  root.style.setProperty("--role-accent", theme.accent);
  root.style.setProperty("--role-surface", theme.surface);
  root.style.setProperty("--role-text", theme.text);
  root.style.setProperty("--role-btn-text", theme.btnText);
}

/**
 * Explicit 9-State Authentication State Machine
 * Prevents ambiguous booleans and flashes of unauthorized content.
 */
export type AuthState =
  | "UNKNOWN"
  | "INITIALIZING"
  | "AUTHENTICATING"
  | "AUTHENTICATED_PENDING_ACTOR"
  | "AUTHENTICATED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ERROR"
  | "SIGNING_OUT";

export interface AuthContextValue {
  authState: AuthState;
  user: User | null;
  actor: AuthMeResponse | null;
  role: UserRoleType | null;
  departmentId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshActor: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

let browserSupabaseClient: SupabaseClient | null = null;

export function getBrowserSupabaseClient(): SupabaseClient | null {
  if (browserSupabaseClient) return browserSupabaseClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  browserSupabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return browserSupabaseClient;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const authClientConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const [authState, setAuthState] = useState<AuthState>(
    authClientConfigured ? "INITIALIZING" : "UNAUTHENTICATED"
  );
  const [user, setUser] = useState<User | null>(null);
  const [actor, setActor] = useState<AuthMeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Configure apiClient token provider
  useEffect(() => {
    apiClient.setTokenProvider(async () => {
      const client = getBrowserSupabaseClient();
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data?.session?.access_token || null;
    });
  }, []);

  const resolveActor = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      setAuthState("AUTHENTICATED_PENDING_ACTOR");
      const actorData = await apiClient.getAuthMe();

      if (!actorData || !actorData.role) {
        setActor(null);
        setAuthState("FORBIDDEN");
        setError("Your account is not assigned an active campus role. Please contact administration.");
        return;
      }

      setActor(actorData);
      applyRoleTheme(actorData.role);
      setAuthState("AUTHENTICATED");
    } catch (err: unknown) {
      setActor(null);
      if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 403) {
        setAuthState("FORBIDDEN");
        setError("Your campus account does not have access permissions.");
      } else if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 401) {
        const errMsg = err instanceof Error ? err.message : "";
        if (
          errMsg.toLowerCase().includes("does not map to any active user record") ||
          errMsg.toLowerCase().includes("not provisioned")
        ) {
          setAuthState("FORBIDDEN");
          setError("Your account exists, but institutional access has not yet been provisioned.");
        } else {
          setAuthState("UNAUTHENTICATED");
          setError("Authentication session expired. Please sign in again.");
        }
      } else {
        setAuthState("ERROR");
        setError(err instanceof Error ? err.message : "Failed to verify server actor identity.");
      }
    }
  }, []);

  useEffect(() => {
    const client = getBrowserSupabaseClient();
    if (!client) return;

    // Initial session check
    client.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        await resolveActor();
      } else {
        setUser(null);
        setActor(null);
        setAuthState("UNAUTHENTICATED");
      }
    }).catch(() => {
      setUser(null);
      setActor(null);
      setAuthState("UNAUTHENTICATED");
    });

    // Authoritative multi-tab and auth state event subscription
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setUser(null);
        setActor(null);
        setError(null);
        applyRoleTheme(UserRole.ROLE_STUDENT);
        setAuthState("UNAUTHENTICATED");
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        setUser(session.user);
        await resolveActor();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [resolveActor]);

  const signIn = async (email: string, password: string): Promise<void> => {
    setAuthState("AUTHENTICATING");
    setError(null);
    const client = getBrowserSupabaseClient();
    if (!client) {
      setAuthState("ERROR");
      const msg = "Supabase authentication client is not configured.";
      setError(msg);
      throw new Error(msg);
    }

    const { data, error: authError } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !data.user) {
      setAuthState("UNAUTHENTICATED");
      const msg = authError?.message || "Invalid credentials";
      setError(msg);
      throw new Error(msg);
    }

    setUser(data.user);
    await resolveActor();
  };

  const signOut = async (): Promise<void> => {
    setAuthState("SIGNING_OUT");
    const client = getBrowserSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
    setUser(null);
    setActor(null);
    setError(null);
    applyRoleTheme(UserRole.ROLE_STUDENT);
    if (typeof window !== "undefined") {
      window.location.replace("/");
    } else {
      setAuthState("UNAUTHENTICATED");
    }
  };

  const isLoading = useMemo(() => {
    return (
      authState === "INITIALIZING" ||
      authState === "AUTHENTICATING" ||
      authState === "AUTHENTICATED_PENDING_ACTOR" ||
      authState === "SIGNING_OUT"
    );
  }, [authState]);

  const isAuthenticated = useMemo(() => {
    return authState === "AUTHENTICATED";
  }, [authState]);

  const value: AuthContextValue = {
    authState,
    user,
    actor,
    role: actor?.role || null,
    departmentId: actor?.departmentId || null,
    isAuthenticated,
    isLoading,
    error,
    signIn,
    signOut,
    refreshActor: resolveActor,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
