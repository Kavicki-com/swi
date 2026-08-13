// describe/it/expect/beforeEach/afterEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ApiError, apiFetch, SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/services/api/http'
import { AuthProvider, useAuth } from './useAuth'

// signIn agora é real (backend Nest) — o fetch é stubado pra não depender de
// rede. getSession/signOut só tocam localStorage e rodam de verdade.
const jwt = (payload: object) =>
  `x.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.y`

const stubAdminLogin = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: jwt({ sub: 'u1', role: 'ADMIN' }),
        user: { id: 'u1', email: 'admin@swi.local', name: 'Admin Demo' },
      }),
    } as Response),
  )

describe('useAuth', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with user=null', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('signs in against the backend (fetch stubado)', async () => {
    stubAdminLogin()
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signIn('admin@swi.local', 'admin123')
    })
    expect(result.current.user?.email).toBe('admin@swi.local')
  })

  it('surfaces the backend error message on failed sign-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Credenciais inválidas' }),
      } as Response),
    )
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    let outcome: { ok: boolean; message?: string } | undefined
    await act(async () => {
      outcome = await result.current.signIn('a@b.c', 'x')
    })
    expect(outcome).toEqual({ ok: false, message: 'Credenciais inválidas' })
    expect(result.current.user).toBeNull()
  })
})

describe('useAuth (hydration)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hydrates user from localStorage on mount', async () => {
    // getSession real exige token + sessão.
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        id: 'u_seed_1',
        email: 'admin@swi.test',
        full_name: 'Admin Seed',
        role: 'super_admin',
        consent_given_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }),
    )
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => {
      expect(result.current.user?.email).toBe('admin@swi.test')
    })
  })

  it('does not hydrate from an orphan session (sem token)', async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ id: 'u_seed_1', email: 'admin@swi.test', full_name: 'Admin Seed' }),
    )
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('exposes a hydration flag (loading=true initially, false after hydrate)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  // O 401 do apiFetch apaga o localStorage, mas isso sozinho não avisa o React:
  // sem o listener o `user` continuaria truthy e a tela ficaria viva com
  // credencial morta — RequireAuth não redirecionaria e GuestOnly não deixaria
  // ir pro /login, prendendo o usuário sem saída a não ser F5.
  it('drops the user when a 401 clears the session mid-flight', async () => {
    stubAdminLogin()
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signIn('admin@swi.local', 'admin123')
    })
    expect(result.current.user?.email).toBe('admin@swi.local')

    // Uma chamada qualquer do app tomando 401 com o token já gravado.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      } as Response),
    )
    await act(async () => {
      await expect(apiFetch('/work-orders')).rejects.toBeInstanceOf(ApiError)
    })

    expect(result.current.user).toBeNull()
  })

  // O evento `storage` do browser só dispara nas OUTRAS abas: é o que cobre
  // "deslogou numa aba, a outra tem que acompanhar".
  it('drops the user when another tab clears the token (storage event)', async () => {
    stubAdminLogin()
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signIn('admin@swi.local', 'admin123')
    })
    expect(result.current.user?.email).toBe('admin@swi.local')

    // A aba irmã apagou o token; o jsdom não propaga `storage` sozinho.
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY }))
    })

    expect(result.current.user).toBeNull()
  })

  // Sem esta guarda, QUALQUER escrita no localStorage (outro domínio de estado
  // da app numa aba irmã) derrubaria a sessão de quem está logado.
  it('keeps the user when a storage event does not touch the token', async () => {
    stubAdminLogin()
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signIn('admin@swi.local', 'admin123')
    })

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'algum.outro.estado' }))
    })

    expect(result.current.user?.email).toBe('admin@swi.local')
  })

  it('signOut clears the user', async () => {
    stubAdminLogin()
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signIn('admin@swi.local', 'admin123')
    })
    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.user).toBeNull()
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})
