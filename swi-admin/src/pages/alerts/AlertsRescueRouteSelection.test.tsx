// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { AlertsRescueRouteSelection } from './AlertsRescueRouteSelection'
import { clearSession, renderPage } from '@/test-utils/renderPage'

describe('AlertsRescueRouteSelection', () => {
  afterEach(clearSession)

  it('renders without crashing', () => {
    expect(() =>
      renderPage(<AlertsRescueRouteSelection />, { route: '/alerts/e1/rescue', path: '/alerts/:employeeId/rescue' }),
    ).not.toThrow()
  })
})
