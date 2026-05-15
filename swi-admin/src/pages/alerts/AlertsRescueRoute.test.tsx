// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { AlertsRescueRoute } from './AlertsRescueRoute'
import { clearSession, renderPage } from '@/test-utils/renderPage'

describe('AlertsRescueRoute', () => {
  afterEach(clearSession)

  it('renders without crashing', () => {
    expect(() =>
      renderPage(<AlertsRescueRoute />, { route: '/alerts/e1/rescue/r1', path: '/alerts/:employeeId/rescue/:rescuerId' }),
    ).not.toThrow()
  })
})
