// src/hooks/useAuth.tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi } from '@/services/auth'
import { profileApi } from '@/services/api/profile'
import { SESSION_CLEARED_EVENT, TOKEN_STORAGE_KEY } from '@/services/api/http'
import type { User } from '@/services/types'

type Result = { ok: boolean; message?: string }

type AuthContextValue = {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<Result>
  signOut: () => Promise<void>
  /** Foto nova escolhida em Configurações: o cabeçalho troca na hora. */
  setAvatarUri: (avatarUri: string) => void
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

  // A sessão pode morrer com a tela já montada — o 401 do apiFetch apaga o
  // localStorage, mas isso sozinho não avisa o React. Sem estes dois listeners
  // o `user` fica stale e truthy: o RequireAuth não redireciona, o GuestOnly
  // rebate quem tenta ir pro /login, e não sobra caminho in-app pra sair.
  useEffect(() => {
    const drop = () => setUser(null)
    // Evento nativo `storage` só dispara nas OUTRAS abas — cobre "deslogou numa
    // aba, as irmãs acompanham". A própria aba fica com o evento custom, que o
    // clearSession dispara. `key === null` é o localStorage.clear() inteiro.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== TOKEN_STORAGE_KEY) return
      // Só derruba se o token realmente sumiu: um `storage` de login numa aba
      // irmã não pode expulsar quem está logado aqui.
      if (!window.localStorage.getItem(TOKEN_STORAGE_KEY)) drop()
    }
    window.addEventListener(SESSION_CLEARED_EVENT, drop)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SESSION_CLEARED_EVENT, drop)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // A foto vem do perfil, não do login, e é URL assinada que expira: por isso
  // é lida a cada sessão e não vai para o localStorage. Sem foto, ou se a
  // leitura falhar, a sessão fica sem foto, nunca com a de outra pessoa.
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void profileApi.me().then(({ data }) => {
      const avatarUri = data?.avatarUrl
      if (cancelled || !avatarUri) return
      setUser((u) => (u?.id === userId ? { ...u, avatarUri } : u))
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const setAvatarUri = useCallback((avatarUri: string) => {
    setUser((u) => (u ? { ...u, avatarUri } : u))
  }, [])

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

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, setAvatarUri }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
