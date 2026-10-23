// Pedido de ajuda no histórico de condições do perfil. A condição nasce
// encerrada no mesmo instante em que abre (não é medição): a linha mostra quando
// o pedido foi feito, sem "Encerrada" e sem motivo de fechamento, que
// afirmariam um fim que o pedido não teve.
import { vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { ConditionHistory } from './ConditionHistory'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { telemetryApi, type ConditionHistoryItem } from '@/services/api/telemetry'

vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: { workerConditions: vi.fn() },
}))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: vi.fn(() => () => {}),
}))

const conditionsMock = vi.mocked(telemetryApi.workerConditions)

const at = (h: number, m: number): string => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const help: ConditionHistoryItem = {
  id: 'h1',
  origin: 'REAL',
  kind: 'HELP_REQUESTED',
  category: 'URGENT',
  status: 'RECOVERED',
  openedAt: at(10, 15),
  recoveredAt: at(10, 15),
  recoveryReason: null,
  observedValue: null,
  thresholdValue: null,
  receivedAt: null,
  episodeKind: null,
}

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

it('mostra "Pedido de ajuda", urgente, com a hora do pedido e sem fechamento', async () => {
  conditionsMock.mockResolvedValue({ data: { items: [help], nextCursor: null }, error: null })
  await renderPage(<ConditionHistory workerId="w1" />)
  await screen.findByTestId('condition-history')

  const row = within(screen.getByTestId('condition-history-item-h1'))
  expect(row.getByText('Pedido de ajuda')).toBeTruthy()
  expect(row.getByText('Urgente')).toBeTruthy()
  expect(row.getByText('Aberta às 10:15')).toBeTruthy()
  expect(row.queryByText(/^Encerrada/)).toBeNull()
})
