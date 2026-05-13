import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  signIn: (email: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);

  const signIn = (email: string) => {
    setUser({
      id: '1',
      email,
      name: email.split('@')[0] ?? 'Usuário',
    });
  };

  const signOut = () => setUser(null);

  return (
    <AuthContext.Provider value={{ user, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
