"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  getSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  getCurrentUser,
  syncCurrentUser,
  updateCurrentUser,
} from "@/lib/api/auth";
import type { CurrentUser, UpdateCurrentUserInput } from "@/lib/api/auth";
import { setAmbientAccessTokenGetter } from "@/lib/api/client";
import { ApiError } from "@/lib/api/client";

type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "not_configured";

type ProfileStatus = "idle" | "loading" | "ready" | "error";

export interface SignUpInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  displayName: string;
  userType: "renter" | "host";
  healthcareRole?: string;
}

type ActionResult =
  | { ok: true }
  | { ok: false; message: string };

type SignUpResult =
  | { ok: true; needsEmailConfirmation: boolean }
  | { ok: false; message: string };

interface AuthContextValue {
  status: AuthStatus;
  /** MediCN profile from GET /auth/me — null until synced/loaded. */
  user: CurrentUser | null;
  profileStatus: ProfileStatus;
  /** Whether the browser Supabase env vars are configured. */
  configured: boolean;
  /** Email from the Supabase session (available before the profile loads). */
  email: string | null;
  /**
   * ISO timestamp of Supabase email confirmation, or null when unconfirmed.
   * Reported honestly for diagnostics; email verification does NOT gate access.
   */
  emailConfirmedAt: string | null;
  accessToken: string | null;
  signIn: (email: string, password: string) => Promise<ActionResult>;
  signUp: (input: SignUpInput) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<ActionResult>;
  /** Re-run GET /auth/me for the current session. */
  refreshProfile: () => Promise<void>;
  /** Saves the real MediCN profile and keeps the in-memory profile current. */
  updateProfile: (input: UpdateCurrentUserInput) => Promise<CurrentUser>;
  /** Force a Supabase session/token refresh. */
  refreshSession: () => Promise<ActionResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NOT_CONFIGURED_MESSAGE =
  "Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable sign in.";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>(
    isSupabaseConfigured ? "loading" : "not_configured"
  );
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>("idle");

  // Keep the latest token in a ref so apiFetch's ambient getter is always fresh.
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    setAmbientAccessTokenGetter(() => sessionRef.current?.access_token ?? null);
    return () => setAmbientAccessTokenGetter(() => null);
  }, []);

  // Loads the MediCN profile for a session, syncing first when the Supabase user
  // has no MediCN profile yet (first login after signup).
  const loadProfile = useCallback(
    async (accessToken: string) => {
      setProfileStatus("loading");
      try {
        let profile: CurrentUser;
        try {
          profile = await getCurrentUser(accessToken);
        } catch (error) {
          if (error instanceof ApiError && error.code === "USER_NOT_SYNCED") {
            profile = await syncCurrentUser(accessToken);
          } else {
            throw error;
          }
        }
        setUser(profile);
        setProfileStatus("ready");
      } catch {
        // Session is still valid even if the backend profile can't be loaded
        // (e.g. API offline). Keep the user authenticated with a null profile.
        setUser(null);
        setProfileStatus("error");
      }
    },
    []
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;

    const applySession = (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "unauthenticated");
      if (nextSession) {
        void loadProfile(nextSession.access_token);
      } else {
        setUser(null);
        setProfileStatus("idle");
      }
    };

    void supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      applySession(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<ActionResult> => {
      if (!supabase) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        return { ok: false, message: error.message };
      }
      // onAuthStateChange applies the session and loads the profile.
      return { ok: true };
    },
    [supabase]
  );

  const signUp = useCallback(
    async (input: SignUpInput): Promise<SignUpResult> => {
      if (!supabase) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
      const { data, error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          // Keys the backend reads from Supabase user_metadata
          // (see auth.service.ts toVerifiedSupabaseUser).
          data: {
            first_name: input.firstName,
            last_name: input.lastName,
            display_name: input.displayName,
            user_type: input.userType,
            ...(input.healthcareRole
              ? { healthcare_role: input.healthcareRole }
              : {}),
          },
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/login`
              : undefined,
        },
      });
      if (error) {
        return { ok: false, message: error.message };
      }
      // When email confirmation is required, Supabase returns no session.
      const needsEmailConfirmation = !data.session;
      if (data.session) {
        // Proactively create the MediCN profile from metadata.
        try {
          await syncCurrentUser(data.session.access_token);
        } catch {
          // Non-fatal: the profile will sync on next /auth/me.
        }
      }
      return { ok: true, needsEmailConfirmation };
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    // onAuthStateChange clears the session; clear eagerly for responsiveness.
    setUser(null);
    setProfileStatus("idle");
  }, [supabase]);

  const sendPasswordReset = useCallback(
    async (email: string): Promise<ActionResult> => {
      if (!supabase) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/login`
            : undefined,
      });
      if (error) {
        return { ok: false, message: error.message };
      }
      return { ok: true };
    },
    [supabase]
  );

  const refreshProfile = useCallback(async () => {
    const token = sessionRef.current?.access_token;
    if (token) {
      await loadProfile(token);
    }
  }, [loadProfile]);

  const updateProfile = useCallback(
    async (input: UpdateCurrentUserInput) => {
      const token = sessionRef.current?.access_token;
      if (!token) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const updated = await updateCurrentUser(input, token);
      setUser(updated);
      setProfileStatus("ready");
      return updated;
    },
    []
  );

  const refreshSession = useCallback(async (): Promise<ActionResult> => {
    if (!supabase) return { ok: false, message: NOT_CONFIGURED_MESSAGE };
    const { error } = await supabase.auth.refreshSession();
    if (error) {
      return { ok: false, message: error.message };
    }
    // onAuthStateChange applies the refreshed session.
    return { ok: true };
  }, [supabase]);

  // Supabase exposes email confirmation via email_confirmed_at (falls back to
  // confirmed_at on older shapes). null => not confirmed / unknown.
  const sessionUser = session?.user as
    | { email_confirmed_at?: string | null; confirmed_at?: string | null }
    | undefined;
  const emailConfirmedAt =
    sessionUser?.email_confirmed_at ?? sessionUser?.confirmed_at ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      profileStatus,
      configured: isSupabaseConfigured,
      email: session?.user.email ?? null,
      emailConfirmedAt,
      accessToken: session?.access_token ?? null,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      refreshProfile,
      updateProfile,
      refreshSession,
    }),
    [
      status,
      user,
      profileStatus,
      session,
      emailConfirmedAt,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      refreshProfile,
      updateProfile,
      refreshSession,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
