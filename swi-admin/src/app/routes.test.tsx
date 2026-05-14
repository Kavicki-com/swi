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

// Paths that App.tsx mounts as real components. Everything else in
// ADMIN_ROUTES is still rendered through the catch-all <Placeholder />.
const REAL_ROUTE_PATHS = new Set<string>([
  '/',
  '/admins',
  '/admins/new',
  '/admins/:id',
  '/employees',
  '/employees/new',
  '/employees/:id',
  '/maps/general',
  '/chat',
  '/monitoring/alerts',
  '/monitoring/good-conditions',
  '/reports',
  '/reports/:id',
  '/reports/new',
  '/modals/responsables',
  '/alerts',
  '/alerts/:employeeId',
  '/alerts/:employeeId/rescue',
  '/alerts/:employeeId/rescue/:rescuerId',
  '/user/settings',
  '/user/profile',
])

describe('Admin router', () => {
  beforeEach(() => {
    window.localStorage.setItem('swi.admin.session', SEED_SESSION)
  })
  afterEach(() => window.localStorage.clear())

  // Iterate only over routes that are still rendered as <Placeholder />.
  // Real components have their own dedicated tests (Dashboard, AdminsList, etc).
  const placeholderRoutes = ADMIN_ROUTES.filter(
    (r) => !PUBLIC_PATHS.has(r.path) && !REAL_ROUTE_PATHS.has(r.path),
  )

  if (placeholderRoutes.length === 0) {
    // Desktop is complete — every protected route now mounts a real component.
    // Keep this assertion so a regression that re-introduces a placeholder
    // (without wiring it into REAL_ROUTE_PATHS) trips here instead of silently
    // shipping a "Em construção" page to production.
    it('has no remaining placeholder routes (desktop fully implemented)', () => {
      expect(placeholderRoutes).toEqual([])
    })
  } else {
    it.each(placeholderRoutes.map((r) => [r.path, r.label]))(
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
  }
})
