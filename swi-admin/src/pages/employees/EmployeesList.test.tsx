// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { EmployeesList } from './EmployeesList'
import { clearSession, renderPage } from '@/test-utils/renderPage'

describe('EmployeesList', () => {
  afterEach(clearSession)

  it('renders without crashing', () => {
    expect(() =>
      renderPage(<EmployeesList />, { route: '/employees' }),
    ).not.toThrow()
  })
})
