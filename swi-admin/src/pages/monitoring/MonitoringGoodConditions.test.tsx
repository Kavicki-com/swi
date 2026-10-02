// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { screen } from '@testing-library/react'
import { MonitoringGoodConditions } from './MonitoringGoodConditions'
import type { MonitoringOutletContext } from './monitoringContext'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { adminSummary } from '@/test-utils/telemetryFixtures'

// O layout entrega o resumo pelo Outlet; aqui o hook do contexto é o dublê.
const ctx = vi.hoisted(() => ({
  value: { summary: null, failed: false } as MonitoringOutletContext,
}))
vi.mock('./monitoringContext', () => ({ useMonitoringContext: () => ctx.value }))

describe('MonitoringGoodConditions', () => {
  afterEach(() => {
    clearSession()
    ctx.value = { summary: null, failed: false }
  })

  it('renders without crashing', async () => {
    await expect(
      renderPage(<MonitoringGoodConditions />, { route: '/monitoring/good-conditions' }),
    ).resolves.toBeDefined()
  })

  it('sem resumo, os donuts mostram ausência e a legenda diz por quê', async () => {
    await renderPage(<MonitoringGoodConditions />, { route: '/monitoring/good-conditions' })
    expect(screen.getAllByText('--')).toHaveLength(4)
    expect(screen.getAllByText('Sem dados atuais')).toHaveLength(4)
  })

  it('falha na leitura diz que ela está indisponível', async () => {
    ctx.value = { summary: null, failed: true }
    await renderPage(<MonitoringGoodConditions />, { route: '/monitoring/good-conditions' })
    expect(screen.getAllByText('Leitura indisponível no momento')).toHaveLength(4)
  })

  it('com o resumo do layout, os números e as legendas vêm do backend', async () => {
    ctx.value = { summary: adminSummary(), failed: false }
    await renderPage(<MonitoringGoodConditions />, { route: '/monitoring/good-conditions' })
    expect(screen.getByText('96')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.queryByText('--')).not.toBeInTheDocument()
  })
})
