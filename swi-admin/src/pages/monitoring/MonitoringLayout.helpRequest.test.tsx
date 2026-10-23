// Fila de /monitoring/alerts e o pedido de ajuda: atendido (socorrista
// despachado ou reconhecido em outra tela) e fechado (resgate encerrado) só
// chegam pelo aviso help-request.changed, sem condição nova. A fila relê na
// hora, sem a espera dos avisos de condição, para a linha do pedido não ficar
// com "Reconhecer" depois de o socorro já ter saído.
import { vi } from 'vitest'
import { act } from '@testing-library/react'
import { MonitoringLayout } from './MonitoringLayout'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { monitoringApi } from '@/services/monitoring'
import { useAdminTelemetry } from '@/hooks/useAdminTelemetry'
import type { Employee } from '@/services/api/users'
import type { HelpRequestChanged } from '@/services/telemetry/telemetrySocket'
import { adminSummary, adminWorker, alertItem, FIXTURE_AT } from '@/test-utils/telemetryFixtures'

vi.mock('@/services/monitoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/monitoring')>()
  return { ...actual, monitoringApi: { directory: vi.fn(), queue: vi.fn() } }
})
vi.mock('@/hooks/useAdminTelemetry', () => ({ useAdminTelemetry: vi.fn() }))

const socket = vi.hoisted(() => ({
  onHelpRequest: null as null | ((e: HelpRequestChanged) => void),
  unsubscribe: vi.fn(),
}))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: (handlers: { onHelpRequest?: (e: HelpRequestChanged) => void }) => {
    socket.onHelpRequest = handlers.onHelpRequest ?? null
    return socket.unsubscribe
  },
}))

const directoryMock = vi.mocked(monitoringApi.directory)
const queueMock = vi.mocked(monitoringApi.queue)
const telemetryMock = vi.mocked(useAdminTelemetry)

const ANA = {
  id: 'w1',
  name: 'Ana Souza',
  age: 30,
  bloodType: 'O+',
  role: 'Operadora',
  specialization: 'Setor Leste',
  sector: 'Setor Leste',
  avatarUri: '',
  vitalsStatus: 'good',
  active: true,
} as Employee

const pedido = alertItem('a-help', {
  condition: {
    kind: 'HELP_REQUESTED',
    category: 'URGENT',
    observedValue: null,
    thresholdValue: null,
    openedAt: FIXTURE_AT,
    recoveredAt: FIXTURE_AT,
    recoveryReason: null,
  },
})

beforeEach(() => {
  directoryMock.mockResolvedValue({
    data: { admins: 1, pendingReports: 0, cameras: 0, employees: [ANA] },
    error: null,
  })
  queueMock.mockResolvedValue({ data: [pedido], error: null })
  telemetryMock.mockReturnValue({
    workers: { observedAt: FIXTURE_AT, workers: [adminWorker('w1', 'Ana Souza')] },
    summary: adminSummary(),
    loading: false,
    failed: false,
    refresh: vi.fn(),
  })
})

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
  socket.onHelpRequest = null
})

it('pedido de ajuda atendido relê a fila na hora', async () => {
  await renderPage(<MonitoringLayout />, { route: '/monitoring/alerts' })
  await act(async () => {})
  expect(queueMock).toHaveBeenCalledTimes(1)
  expect(socket.onHelpRequest).toBeTypeOf('function')

  queueMock.mockResolvedValue({
    data: [{ ...pedido, status: 'ACKNOWLEDGED', acknowledgedAt: FIXTURE_AT }],
    error: null,
  })
  await act(async () => {
    socket.onHelpRequest?.({ workerId: 'w1', helpRequestId: 'a-help', status: 'ATTENDED', at: 'x' })
  })
  expect(queueMock).toHaveBeenCalledTimes(2)
})

it('pedido fechado também relê, e sair da tela solta o socket', async () => {
  const { unmount } = await renderPage(<MonitoringLayout />, { route: '/monitoring/alerts' })
  await act(async () => {})
  await act(async () => {
    socket.onHelpRequest?.({ workerId: 'w1', helpRequestId: 'a-help', status: 'CLOSED', at: 'y' })
  })
  expect(queueMock).toHaveBeenCalledTimes(2)
  unmount()
  expect(socket.unsubscribe).toHaveBeenCalled()
})
