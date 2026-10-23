import { vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { alertItem } from '@/test-utils/telemetryFixtures'
import { simulateReconnect } from '@/test-utils/simulateReconnect'

const h = vi.hoisted(() => ({
  alerts: vi.fn(),
  stopTelemetry: vi.fn(),
  onCondition: null as ((e: unknown) => void) | null,
  onHelpRequest: null as ((e: unknown) => void) | null,
  show: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@/services/api/telemetry', () => ({ telemetryApi: { alerts: h.alerts } }))
// O provider assina duas vezes: condições e, à parte, o pedido de ajuda.
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: (handlers: {
    onCondition: (e: unknown) => void
    onHelpRequest?: (e: unknown) => void
  }) => {
    if (handlers.onHelpRequest) h.onHelpRequest = handlers.onHelpRequest
    else h.onCondition = handlers.onCondition
    return h.stopTelemetry
  },
}))
vi.mock('@/services/browserNotifications/browserNotifications', () => ({
  showUrgentBrowserNotice: h.show,
}))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
}))

import { UrgentAlertsProvider, useUrgentAlerts } from './UrgentAlertsProvider'
import { URGENT_REFETCH_DEBOUNCE_MS } from './urgentAlertsStore'

const page = (ids: string[]) => ({
  data: { items: ids.map((id) => alertItem(id)), nextCursor: null },
  error: null,
})

function Probe() {
  const view = useUrgentAlerts()
  if (!view) return <span>sem provider</span>
  return <span>{view.visible.map((a) => a.id).join(',') || 'nenhum'}</span>
}

const mount = () =>
  render(
    <MemoryRouter>
      <UrgentAlertsProvider>
        <Probe />
      </UrgentAlertsProvider>
    </MemoryRouter>,
  )

const flush = () => act(async () => {})

beforeEach(() => {
  h.alerts.mockReset().mockResolvedValue(page(['a']))
  h.stopTelemetry.mockReset()
  h.show.mockReset()
  h.navigate.mockReset()
  h.onCondition = null
  h.onHelpRequest = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('UrgentAlertsProvider', () => {
  it('lê ao montar e mostra os urgentes abertos', async () => {
    mount()
    await flush()
    expect(screen.getByText('a')).toBeTruthy()
  })

  it('alerta novo vira notificação do navegador, e o clique leva ao monitoramento', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mount()
    await flush()
    h.alerts.mockResolvedValue(page(['b', 'a']))
    await act(async () => {
      h.onCondition!({ kind: 'HEART_RATE_HIGH', change: 'OPENED' })
      await vi.advanceTimersByTimeAsync(URGENT_REFETCH_DEBOUNCE_MS)
    })
    expect(h.show).toHaveBeenCalledTimes(1)
    expect(h.show.mock.calls[0]![0]).toEqual(['b'])
    const open = h.show.mock.calls[0]![1] as () => void
    open()
    expect(h.navigate).toHaveBeenCalledWith('/monitoring/alerts')
  })

  it('pedido de ajuda atendido tira o aviso na hora, sem esperar a releitura', async () => {
    mount()
    await flush()
    expect(screen.getByText('a')).toBeTruthy()
    h.alerts.mockResolvedValue(page([]))
    await act(async () => {
      h.onHelpRequest!({ workerId: 'w1', helpRequestId: 'a', status: 'ATTENDED', at: 'x' })
    })
    expect(screen.getByText('nenhum')).toBeTruthy()
  })

  it('relê quando a conexão volta', async () => {
    mount()
    await flush()
    await act(async () => simulateReconnect())
    expect(h.alerts).toHaveBeenCalledTimes(2)
  })

  it('relê quando a aba volta a ficar visível', async () => {
    mount()
    await flush()
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(h.alerts).toHaveBeenCalledTimes(2)
  })

  it('desmontado, solta o socket da telemetria', async () => {
    const { unmount } = mount()
    await flush()
    unmount()
    expect(h.stopTelemetry).toHaveBeenCalled()
  })

  it('fora do provider, o hook devolve null', () => {
    render(<Probe />)
    expect(screen.getByText('sem provider')).toBeTruthy()
  })
})
