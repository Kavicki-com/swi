// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { ChatInbox } from './ChatInbox'
import { clearSession, renderPage } from '@/test-utils/renderPage'

describe('ChatInbox', () => {
  afterEach(clearSession)

  it('renders without crashing', () => {
    expect(() =>
      renderPage(<ChatInbox />, { route: '/chat' }),
    ).not.toThrow()
  })
})
