import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from './useAuth'

describe('useAuth', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starts with user=null', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
  })

  it('signs in with seed credentials', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signIn('admin@swi.test', 'demo1234')
    })
    expect(result.current.user?.email).toBe('admin@swi.test')
  })
})

describe('useAuth (hydration)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('hydrates user from localStorage on mount', async () => {
    window.localStorage.setItem(
      'swi.admin.session',
      JSON.stringify({
        id: 'u_seed_1',
        org_id: 'org_seed_1',
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

  it('exposes a hydration flag (loading=true initially, false after hydrate)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  it('signUp signs in the new user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signUp({
        email: 'novo@swi.test',
        password: 'novo1234',
        full_name: 'Novo',
        consent: true,
      })
    })
    expect(result.current.user?.email).toBe('novo@swi.test')
  })

  it('signOut clears the user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.signIn('admin@swi.test', 'demo1234')
    })
    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.user).toBeNull()
  })
})
