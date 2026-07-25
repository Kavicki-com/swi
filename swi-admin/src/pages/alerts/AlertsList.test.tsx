// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { AlertsList } from './AlertsList'
import { clearSession, renderPage } from '@/test-utils/renderPage'

// Posições live têm suite própria (useLivePositions.test); o smoke não deve
// abrir fetch/socket reais no jsdom.
vi.mock('@/hooks/useLivePositions', () => ({
  useLivePositions: () => [
    { id: 'w1', name: 'A', lat: -23.55, lng: -46.63, status: 'good', avatarUri: '' },
  ],
}))

describe('AlertsList', () => {
  afterEach(clearSession)

  it('renders without crashing', () => {
    expect(() => renderPage(<AlertsList />, { route: '/alerts' })).not.toThrow()
  })
})
