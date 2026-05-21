// src/hooks/useAuth.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi } from '@/services/mockApi/auth'
import type { User } from '@/services/types'

type SignUpInput = {
  email: string
  password: string
  full_name: string
  consent: boolean
}

type Result = { ok: boolean; message?: string }

type AuthContextValue = {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<Result>
  signUp: (input: SignUpInput) => Promise<Result>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    authApi.getSession().then(({ data }) => {
      if (cancelled) return
      setUser(data ?? null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    const { data, error } = await authApi.signIn({ email, password })
    if (data) {
      setUser(data)
      return { ok: true }
    }
    return { ok: false, message: error?.message }
  }

  const signUp: AuthContextValue['signUp'] = async (input) => {
    const { data, error } = await authApi.signUp(input)
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

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
