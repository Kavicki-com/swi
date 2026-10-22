// O toggle do cartão do monitoramento pausa os alertas do funcionário (férias,
// afastamento). Ele lê monitoringPausedAt do cadastro, pausa com PUT e retoma
// com DELETE, volta ao estado anterior quando o servidor recusa e fica travado
// para quem não tem a permissão de pausar.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { MonitoringLayout } from './MonitoringLayout'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { monitoringApi } from '@/services/monitoring'
import { telemetryApi } from '@/services/api/telemetry'
import { useAdminTelemetry } from '@/hooks/useAdminTelemetry'
import type { Employee } from '@/services/api/users'
import { adminSummary } from '@/test-utils/telemetryFixtures'

vi.mock('@/services/monitoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/monitoring')>()
  return { ...actual, monitoringApi: { directory: vi.fn(), queue: vi.fn() } }
})
vi.mock('@/services/api/telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/telemetry')>()
  return {
    ...actual,
    telemetryApi: {
      ...actual.telemetryApi,
      pauseMonitoring: vi.fn(),
      resumeMonitoring: vi.fn(),
    },
  }
})
vi.mock('@/services/api/notifications', () => ({
  notificationsApi: { requestPause: vi.fn() },
}))
vi.mock('@/hooks/useAdminTelemetry', () => ({ useAdminTelemetry: vi.fn() }))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: () => () => {},
}))

const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => toast }))

// O nível vem do token; cada teste escolhe o seu sobre a sessão real.
const auth = vi.hoisted(() => ({ level: 'ADMIN' as string }))
vi.mock('@/hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAuth')>()
  return {
    ...actual,
    useAuth: () => {
      const real = actual.useAuth()
      return { ...real, user: real.user ? { ...real.user, level: auth.level } : real.user }
    },
  }
})

const directoryMock = vi.mocked(monitoringApi.directory)
const queueMock = vi.mocked(monitoringApi.queue)
const pauseMock = vi.mocked(telemetryApi.pauseMonitoring)
const resumeMock = vi.mocked(telemetryApi.resumeMonitoring)
const telemetryMock = vi.mocked(useAdminTelemetry)

const PAUSADO_EM = '2026-10-20T09:00:00.000Z'

const pessoa = (id: string, name: string, monitoringPausedAt: string | null): Employee =>
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
    monitoringPausedAt,
  }) as Employee

const POPULACAO = [
  pessoa('u-ativo', 'Ana Monitorada', null),
  pessoa('u-pausado', 'Bruno De Férias', PAUSADO_EM),
]

const toggleDe = (name: string) =>
  screen.getByRole('switch', { name: `Ativar/desativar monitoramento de ${name}` })

// Esta versão do react-native-web não emite aria-checked: o estado on/off do
// Toggle vira a classe atômica do trilho. Mesmo sinal público das listas de
// administradores e funcionários. Ana nasce monitorada e Bruno pausado, então
// a classe de um é a referência do estado do outro.
const classe = (name: string) => toggleDe(name).className

// "Ver Todos" pela URL: sem leitura de telemetria, todos caem fora das abas.
const renderAt = async () => {
  await renderPage(<MonitoringLayout />, { route: '/monitoring/alerts?ver=todos' })
  await act(async () => {})
}

beforeEach(() => {
  directoryMock.mockResolvedValue({
    data: { admins: 1, pendingReports: 0, cameras: 0, employees: POPULACAO },
    error: null,
  })
  queueMock.mockResolvedValue({ data: [], error: null })
  telemetryMock.mockReturnValue({
    workers: { observedAt: '2026-10-22T12:00:00.000Z', workers: [] },
    summary: adminSummary(),
    loading: false,
    failed: false,
    refresh: vi.fn(),
  })
})

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
  auth.level = 'ADMIN'
})

describe('MonitoringLayout: pausa dos alertas pelo toggle do cartão', () => {
  it('o toggle mostra quem está monitorado e quem está com os alertas pausados', async () => {
    await renderAt()
    expect(classe('Ana Monitorada')).not.toBe(classe('Bruno De Férias'))
  })

  it('desligar pausa os alertas no servidor e o cartão fica desativado', async () => {
    pauseMock.mockResolvedValue({
      data: { workerId: 'u-ativo', monitoringPausedAt: '2026-10-22T12:00:00.000Z' },
      error: null,
    })
    await renderAt()
    const desligado = classe('Bruno De Férias')

    fireEvent.click(toggleDe('Ana Monitorada'))
    await act(async () => {})

    expect(pauseMock).toHaveBeenCalledWith('u-ativo')
    expect(resumeMock).not.toHaveBeenCalled()
    expect(classe('Ana Monitorada')).toBe(desligado)
  })

  it('ligar retoma os alertas no servidor', async () => {
    resumeMock.mockResolvedValue({
      data: { workerId: 'u-pausado', monitoringPausedAt: null },
      error: null,
    })
    await renderAt()
    const ligado = classe('Ana Monitorada')

    fireEvent.click(toggleDe('Bruno De Férias'))
    await act(async () => {})

    expect(resumeMock).toHaveBeenCalledWith('u-pausado')
    expect(pauseMock).not.toHaveBeenCalled()
    expect(classe('Bruno De Férias')).toBe(ligado)
  })

  it('o servidor recusou: o toggle volta e o painel avisa o erro', async () => {
    pauseMock.mockResolvedValue({ data: null, error: { message: 'Sem permissão' } })
    await renderAt()
    const antes = classe('Ana Monitorada')

    fireEvent.click(toggleDe('Ana Monitorada'))
    await act(async () => {})

    expect(classe('Ana Monitorada')).toBe(antes)
    expect(toast.show).toHaveBeenCalledWith('Erro', 'Sem permissão')
  })

  it('o supervisor também pausa', async () => {
    auth.level = 'SUPERVISOR'
    pauseMock.mockResolvedValue({
      data: { workerId: 'u-ativo', monitoringPausedAt: '2026-10-22T12:00:00.000Z' },
      error: null,
    })
    await renderAt()

    expect(toggleDe('Ana Monitorada').getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(toggleDe('Ana Monitorada'))
    await act(async () => {})

    expect(pauseMock).toHaveBeenCalledWith('u-ativo')
  })

  it('quem não tem a permissão de pausar vê o estado, mas não altera', async () => {
    auth.level = 'WORKER'
    await renderAt()
    const antes = classe('Ana Monitorada')

    expect(toggleDe('Ana Monitorada').getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(toggleDe('Ana Monitorada'))
    await act(async () => {})

    expect(pauseMock).not.toHaveBeenCalled()
    expect(classe('Ana Monitorada')).toBe(antes)
  })
})
