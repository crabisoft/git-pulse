import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthState } from '@repo/shared';
import { api, apiErrorInfo, setUnauthorizedHandler } from './api';

interface Auth {
  /** Null until the first answer: nothing can be rendered before it. */
  state: AuthState | null;
  error: string | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

/**
 * Holds the one thing every screen needs to know: who is here, and what this
 * install shows to someone who is not. The state comes from the API rather than
 * from the cookie — the session is httpOnly, so the browser cannot read it, and
 * the server is the only one that can say whether it is still valid.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.authState());
      setError(null);
    } catch (e) {
      const { code, params } = apiErrorInfo(e);
      setError(t(code, params));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A request refused mid-session means the state on screen is out of date.
  useEffect(() => {
    setUnauthorizedHandler(() => void refresh());
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const value = useMemo<Auth>(
    () => ({
      state,
      error,
      refresh,
      signIn: async (email, password) => setState(await api.login(email, password)),
      signOut: async () => {
        await api.logout();
        await refresh();
      },
    }),
    [state, error, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used within an AuthProvider');
  return auth;
}
