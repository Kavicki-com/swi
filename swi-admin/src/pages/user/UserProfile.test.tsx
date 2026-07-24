// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { UserProfile } from './UserProfile'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { adminsApi } from '@/services/api/users'

describe('UserProfile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    clearSession()
  })

  it('renders without crashing', () => {
    expect(() => renderPage(<UserProfile />, { route: '/user/profile' })).not.toThrow()
  })

  // QA C3 (2026-07-24): o perfil era hardcoded em 'admin-01' (era mock) — 404
  // pra todo usuário real. Deve buscar o id do usuário LOGADO (sessão).
  it('busca o perfil do usuário da sessão, não o id mock admin-01', async () => {
    const spy = vi.spyOn(adminsApi, 'get').mockResolvedValue({ data: null, error: null } as any)
    renderPage(<UserProfile />, { route: '/user/profile' })
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith('u_seed_1') // id do seedSession
    expect(spy).not.toHaveBeenCalledWith('admin-01')
  })
})
