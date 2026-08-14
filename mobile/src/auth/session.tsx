import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as SecureStore from "expo-secure-store";

import { ApiError, request, setAuthToken } from "@/api/client";
import type { SessionResponse, User } from "@/api/types";

/**
 * Who is signed in, and the token that proves it.
 *
 * The token is the same JWT the web app keeps in an httpOnly cookie. On a
 * phone there is no cookie jar, so it lives in the OS keystore via
 * expo-secure-store — encrypted at rest and scoped to this app, unlike
 * AsyncStorage, which is a plain file any process with the sandbox can read.
 */

const TOKEN_KEY = "meetsnaply.session";

interface SessionValue {
  user: User | null;
  /** False once the stored token has been checked, however that turned out. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On launch, believe the stored token only as far as the server confirms it.
  // It is self-expiring, but the account behind it can change or disappear
  // inside the thirty days it lives for.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!stored) return;

        setAuthToken(stored);
        const me = await request<User>("/auth/me");
        if (!cancelled) setUser(me);
      } catch {
        // Expired, revoked, or unreachable. Either way there is nobody signed
        // in yet; a stale token is worse than none, so drop it.
        setAuthToken(null);
        await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await request<SessionResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });

    setAuthToken(session.token);
    await SecureStore.setItemAsync(TOKEN_KEY, session.token);
    setUser(session.user);
  }, []);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside a SessionProvider");
  }
  return value;
}

/** Turns a thrown error into something worth showing a person. */
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
