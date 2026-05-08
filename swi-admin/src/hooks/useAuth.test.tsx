import { renderHook, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './useAuth'

describe('useAuth', () => {
  it('starts with user=null', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    expect(result.current.user).toBeNull()
  })

  it('signs in with seed credentials', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await act(async () => {
      await result.current.signIn('admin@swi.test', 'demo1234')
    })
    expect(result.current.user?.email).toBe('admin@swi.test')
  })
})
