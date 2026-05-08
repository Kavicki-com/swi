import { createContext, useContext, useState, type ReactNode } from 'react'
import { authApi } from '@/services/mockApi'
import type { User } from '@/services/types'

type AuthContextValue = {
  user: User | null
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { data, error } = await authApi.signIn({ email, password })
    if (data) {
      setUser(data)
      return { ok: true }
    }
    return { ok: false, message: error?.message }
  }

  const signOut: AuthContextValue['signOut'] = async () => {
    await authApi.signOut()
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, signIn, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
