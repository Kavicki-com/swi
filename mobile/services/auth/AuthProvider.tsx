import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  signIn: (email: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);

  // Stable identity: consumers that include `signIn` in their useEffect deps
  // (e.g. account-confirmation) would otherwise re-fire on every provider
  // render and trigger an infinite setState loop.
  const signIn = useCallback((email: string) => {
    setUser((prev) =>
      prev && prev.email === email
        ? prev
        : { id: '1', email, name: email.split('@')[0] ?? 'Usuário' },
    );
  }, []);

  const signOut = useCallback(() => setUser(null), []);

  const value = useMemo<AuthState>(
    () => ({ user, signIn, signOut }),
    [user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
