// A aba do card no monitoramento pela tabela do estado de saúde: sem batimento
// válido o estado é neutro, e uma condição só pinta enquanto o dado dela vale.
// O alerta ainda não triado da fila segura o card na aba dele mesmo com o
// estado neutro, porque é trabalho pendente do gestor.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { MonitoringLayout } from './MonitoringLayout'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { monitoringApi } from '@/services/monitoring'
import { useAdminTelemetry } from '@/hooks/useAdminTelemetry'
import type { AdminWorkerEntry, AlertQueueItem } from '@/services/api/telemetry'
import type { Employee } from '@/services/api/users'
import {
  FIXTURE_NOW,
  adminSummary,
  adminWorker,
  alertItem,
  condition,
  metric,
  reporting,
} from '@/test-utils/telemetryFixtures'

vi.mock('@/services/monitoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/monitoring')>()
  return { ...actual, monitoringApi: { directory: vi.fn(), queue: vi.fn() } }
})
vi.mock('@/hooks/useAdminTelemetry', () => ({ useAdminTelemetry: vi.fn() }))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: () => () => {},
}))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => ({ show: vi.fn() }) }))

const directoryMock = vi.mocked(monitoringApi.directory)
const queueMock = vi.mocked(monitoringApi.queue)
const telemetryMock = vi.mocked(useAdminTelemetry)

const pessoa = (id: string, name: string): Employee =>
  ({
    id,
    name,
    age: 32,
    bloodType: 'A+',
    role: 'Operador',
    specialization: 'Setor Leste',
    sector: 'Setor Leste',
    avatarUri: '',
    vitalsStatus: 'good',
    active: true,
  }) as Employee

const STALE_HEART = metric(150, { quality: 'STALE', measuredAt: '2026-10-01T13:00:00.000Z' })

// Condição urgente aberta com o batimento parado há 2 h: estado neutro.
const neutroComCondicao = (id: string, name: string) =>
  adminWorker(id, name, {
    telemetry: {
      ...reporting({ heartRate: STALE_HEART }, 'REAL', id),
      conditions: [condition('URGENT')],
    },
  })

const POPULACAO = [
  pessoa('u-pend', 'Pendente Neutro'),
  pessoa('u-sem', 'Neutro Sem Fila'),
  pessoa('u-hc', 'Lote Health Connect'),
  pessoa('u-bp', 'Pressão Antiga'),
]

const WORKERS: AdminWorkerEntry[] = [
  neutroComCondicao('u-pend', 'Pendente Neutro'),
  neutroComCondicao('u-sem', 'Neutro Sem Fila'),
  adminWorker('u-hc', 'Lote Health Connect', {
    telemetry: {
      ...reporting(
        {
          heartRate: metric(150, {
            quality: 'STALE',
            source: 'HEALTH_CONNECT',
            measuredAt: '2026-10-01T14:10:00.000Z',
          }),
        },
        'REAL',
        'u-hc',
      ),
      conditions: [condition('URGENT')],
    },
  }),
  adminWorker('u-bp', 'Pressão Antiga', {
    telemetry: {
      ...reporting({}, 'REAL', 'u-bp'),
      conditions: [
        condition('URGENT', {
          kind: 'BLOOD_PRESSURE_HIGH',
          measuredAt: '2026-09-30T14:00:00.000Z',
        }),
      ],
    },
  }),
]

const FILA: AlertQueueItem[] = [
  alertItem('al-1', {
    status: 'ACKNOWLEDGED',
    worker: { id: 'u-pend', name: 'Pendente Neutro', sector: null },
  }),
]

const renderAt = async (route: string) => {
  await renderPage(<MonitoringLayout />, { route })
  await act(async () => {})
}

const nomesVisiveis = () =>
  POPULACAO.filter((p) => screen.queryByText(p.name) !== null).map((p) => p.name)

beforeEach(() => {
  directoryMock.mockResolvedValue({
    data: { admins: 1, pendingReports: 0, cameras: 0, employees: POPULACAO },
    error: null,
  })
  queueMock.mockResolvedValue({ data: FILA, error: null })
  telemetryMock.mockReturnValue({
    workers: { observedAt: FIXTURE_NOW, workers: WORKERS },
    summary: adminSummary(),
    loading: false,
    failed: false,
    refresh: vi.fn(),
  })
})

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('MonitoringLayout: aba do card pela tabela do batimento válido', () => {
  it('na aba de alertas fica quem a tabela pinta ou quem tem alerta pendente', async () => {
    await renderAt('/monitoring/alerts')
    expect(nomesVisiveis()).toEqual(['Pendente Neutro', 'Lote Health Connect'])
    expect(screen.getByLabelText('2 alertas de fadiga')).toBeTruthy()
  })

  // Pressão de ontem não pinta mais; o batimento atual sem outra condição é bom.
  it('medição avulsa vencida devolve o card à aba de excelentes', async () => {
    await renderAt('/monitoring/good-conditions')
    expect(nomesVisiveis()).toEqual(['Pressão Antiga'])
  })

  // Neutro sem alerta na fila não cabe em aba nenhuma.
  it('condição aberta sem batimento válido e sem alerta pendente fica fora das abas', async () => {
    for (const route of [
      '/monitoring/alerts',
      '/monitoring/desgastados',
      '/monitoring/good-conditions',
    ]) {
      await renderAt(route)
      expect(screen.queryByText('Neutro Sem Fila')).toBeNull()
      clearSession()
    }
  })
})
