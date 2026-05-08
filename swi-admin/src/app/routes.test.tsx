// src/app/routes.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ADMIN_ROUTES, PUBLIC_PATHS } from './routes'
import { App } from './App'

const SEED_SESSION = JSON.stringify({
  id: 'u_seed_1',
  org_id: 'org_seed_1',
  email: 'admin@swi.test',
  full_name: 'Admin Seed',
  role: 'super_admin',
  consent_given_at: null,
  created_at: '',
})

describe('Admin router', () => {
  beforeEach(() => {
    window.localStorage.setItem('swi.admin.session', SEED_SESSION)
  })
  afterEach(() => window.localStorage.clear())

  // Public auth routes redirect to "/" when authed; covered by GuestOnly tests.
  // "/" is now the real Dashboard (not a Placeholder); covered by Dashboard tests.
  // Iterate only over protected placeholder routes here.
  const protectedRoutes = ADMIN_ROUTES.filter(
    (r) => !PUBLIC_PATHS.has(r.path) && r.path !== '/',
  )

  it.each(protectedRoutes.map((r) => [r.path, r.label]))(
    'renders placeholder for %s',
    async (path, label) => {
      const concretePath = path.replace(':id', 'seed_id')
      render(
        <MemoryRouter initialEntries={[concretePath]}>
          <App />
        </MemoryRouter>,
      )
      await waitFor(() => {
        expect(screen.getByTestId(`placeholder-${label}`)).toBeInTheDocument()
      })
    },
  )
})
