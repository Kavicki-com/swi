// src/test-utils/renderPage.tsx
// Shared helper for smoke-testing page components. Wraps the page in the
// providers the app expects at runtime (SwiThemeProvider for tokens,
// AuthProvider for the useAuth() context, MemoryRouter for any
// useNavigate/useParams/useSearchParams calls) and seeds an authed
// session in localStorage so RequireAuth guards don't redirect.
import type { ReactElement } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'

const SEED_SESSION = JSON.stringify({
  id: 'u_seed_1',
  org_id: 'org_seed_1',
  email: 'admin@swi.test',
  full_name: 'Admin Seed',
  role: 'super_admin',
  consent_given_at: null,
  created_at: '',
  bpm: 99,
  pressure: '12/8',
})

export function seedSession() {
  window.localStorage.setItem('swi.admin.session', SEED_SESSION)
}

export function clearSession() {
  window.localStorage.clear()
}

type RenderPageOptions = {
  /** URL path to seed MemoryRouter with. Defaults to `/`. */
  route?: string
  /** When the page reads `:param` via useParams, mount it under a matching
   *  `<Routes><Route path=…>` so the param resolves. */
  path?: string
}

/**
 * Render a page component with all the providers it needs at runtime. By
 * default mounts the page as the only route; pass `path` when the page
 * reads dynamic URL params and you want them resolved from `route`.
 */
export function renderPage(
  ui: ReactElement,
  { route = '/', path }: RenderPageOptions = {},
): RenderResult {
  seedSession()
  return render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          {path ? (
            <Routes>
              <Route path={path} element={ui} />
            </Routes>
          ) : (
            ui
          )}
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
}
