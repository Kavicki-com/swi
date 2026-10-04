// O monitoramento lê o cadastro real, a telemetria de cada funcionário e a fila
// de alertas. A régua "Filtro de status" navega entre as 3 rotas e a lista TEM
// que ser filtrada pela aba de cada pessoa, que vem das condições abertas e dos
// alertas ainda não triados. Os testes travam o filtro, a expansão inicial, a
// triagem (só muda com a resposta do servidor), a pausa real, a releitura da
// fila quando o socket avisa e os estados de carregando, falha e vazio.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { MonitoringLayout, QUEUE_REFETCH_DEBOUNCE_MS } from './MonitoringLayout'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { monitoringApi } from '@/services/monitoring'
import { telemetryApi, type AlertQueueItem } from '@/services/api/telemetry'
import { notificationsApi } from '@/services/api/notifications'
import { useAdminTelemetry } from '@/hooks/useAdminTelemetry'
import type { Employee } from '@/services/api/users'
import {
  adminSummary,
  adminWorker,
  alertItem,
  condition,
  neverReported,
  reporting,
} from '@/test-utils/telemetryFixtures'

vi.mock('@/services/monitoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/monitoring')>()
  return { ...actual, monitoringApi: { directory: vi.fn(), queue: vi.fn() } }
})
vi.mock('@/services/api/telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/telemetry')>()
  return {
    ...actual,
    telemetryApi: { ...actual.telemetryApi, acknowledgeAlert: vi.fn(), resolveAlert: vi.fn() },
  }
})
vi.mock('@/services/api/notifications', () => ({
  notificationsApi: { requestPause: vi.fn() },
}))
vi.mock('@/hooks/useAdminTelemetry', () => ({ useAdminTelemetry: vi.fn() }))

// O socket é capturado para o teste disparar o aviso de condição na mão.
const socket = vi.hoisted(() => ({
  onCondition: null as null | (() => void),
  unsubscribe: vi.fn(),
}))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: (handlers: { onCondition: () => void }) => {
    socket.onCondition = handlers.onCondition
    return socket.unsubscribe
  },
}))

const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => toast }))

// Espião de navegação (padrão do ChatInbox.test.tsx): o MemoryRouter fica, só o
// useNavigate é observado.
const nav = vi.hoisted(() => ({ spy: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => nav.spy }
})

const directoryMock = vi.mocked(monitoringApi.directory)
const queueMock = vi.mocked(monitoringApi.queue)
const ackMock = vi.mocked(telemetryApi.acknowledgeAlert)
const resolveMock = vi.mocked(telemetryApi.resolveAlert)
const pauseMock = vi.mocked(notificationsApi.requestPause)
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

// 2 em alerta (condição urgente), 1 desgastado (condição de saúde), 2
// excelentes (leitura atual) e 1 sem leitura, que nenhuma aba mostra.
const POPULACAO = [
  pessoa('u-fad-1', 'Fadiga A'),
  pessoa('u-fad-2', 'Fadiga B'),
  pessoa('u-desg-1', 'Desgastado Um'),
  pessoa('u-exc-1', 'Excelente Um'),
  pessoa('u-exc-2', 'Excelente Dois'),
  pessoa('u-none', 'Sem Leitura'),
]

const com = (id: string, name: string, category?: 'URGENT' | 'HEALTH') =>
  adminWorker(id, name, {
    telemetry: { ...reporting({}, 'REAL', id), conditions: category ? [condition(category)] : [] },
  })

const WORKERS = [
  com('u-fad-1', 'Fadiga A', 'URGENT'),
  com('u-fad-2', 'Fadiga B', 'URGENT'),
  com('u-desg-1', 'Desgastado Um', 'HEALTH'),
  com('u-exc-1', 'Excelente Um'),
  com('u-exc-2', 'Excelente Dois'),
  adminWorker('u-none', 'Sem Leitura', { telemetry: neverReported('u-none') }),
]

const alertaDe = (
  alertId: string,
  workerId: string,
  name: string,
  over: Partial<AlertQueueItem> = {},
) => alertItem(alertId, { worker: { id: workerId, name, sector: null }, ...over })

const FILA = [alertaDe('al-1', 'u-fad-1', 'Fadiga A'), alertaDe('al-2', 'u-fad-2', 'Fadiga B')]

const telemetria = (over: Partial<ReturnType<typeof useAdminTelemetry>> = {}) => ({
  workers: { observedAt: '2026-10-01T15:00:00.000Z', workers: WORKERS },
  summary: adminSummary(),
  loading: false,
  failed: false,
  refresh: vi.fn(),
  ...over,
})

const renderAt = async (route: string) => {
  const result = await renderPage(<MonitoringLayout />, { route })
  await act(async () => {})
  return result
}

const nomesVisiveis = () =>
  POPULACAO.filter((p) => screen.queryByText(p.name) !== null).map((p) => p.name)

beforeEach(() => {
  directoryMock.mockResolvedValue({
    data: { admins: 3, pendingReports: 2, cameras: 4, employees: POPULACAO },
    error: null,
  })
  queueMock.mockResolvedValue({ data: FILA, error: null })
  telemetryMock.mockReturnValue(telemetria())
})

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
  vi.useRealTimers()
  socket.onCondition = null
})

describe('MonitoringLayout: abas e lista', () => {
  it('renders without crashing', async () => {
    await expect(
      renderPage(<MonitoringLayout />, { route: '/monitoring/alerts' }),
    ).resolves.toBeDefined()
  })

  it('/monitoring/alerts lista SÓ quem tem condição urgente', async () => {
    await renderAt('/monitoring/alerts')
    expect(nomesVisiveis()).toEqual(['Fadiga A', 'Fadiga B'])
  })

  it('/monitoring/desgastados lista SÓ quem tem condição de saúde', async () => {
    await renderAt('/monitoring/desgastados')
    expect(nomesVisiveis()).toEqual(['Desgastado Um'])
  })

  it('/monitoring/good-conditions lista SÓ quem tem leitura atual e nenhuma condição', async () => {
    await renderAt('/monitoring/good-conditions')
    expect(nomesVisiveis()).toEqual(['Excelente Um', 'Excelente Dois'])
  })

  it('quem não tem leitura não aparece como excelente; só no "Ver Todos"', async () => {
    await renderAt('/monitoring/good-conditions')
    expect(screen.queryByText('Sem Leitura')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Ver todos os funcionários/ }))
    await act(async () => {})

    expect(nomesVisiveis()).toHaveLength(POPULACAO.length)
  })

  it('alerta ainda não triado segura a pessoa na aba de alerta mesmo sem condição aberta', async () => {
    queueMock.mockResolvedValue({
      data: [...FILA, alertaDe('al-9', 'u-exc-1', 'Excelente Um')],
      error: null,
    })
    await renderAt('/monitoring/alerts')
    expect(nomesVisiveis()).toEqual(['Fadiga A', 'Fadiga B', 'Excelente Um'])
  })

  it('abre o primeiro card da aba de alerta com o alerta real', async () => {
    await renderAt('/monitoring/alerts')
    expect(screen.getAllByText('Frequência cardíaca alta')).toHaveLength(1)
    expect(screen.getByText('185 bpm, acima do limite de 167 bpm')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver histórico de exames clínicos' })).toBeTruthy()
  })

  it('a releitura da lista não fecha o card que está aberto', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderAt('/monitoring/alerts')
    fireEvent.click(screen.getByRole('button', { name: /expandir alertas de fadiga b/i }))
    await act(async () => {})

    // Um aviso de condição relê a fila: a lista é recalculada do zero.
    queueMock.mockResolvedValue({ data: [...FILA], error: null })
    act(() => {
      socket.onCondition?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUEUE_REFETCH_DEBOUNCE_MS)
    })

    expect(queueMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: /recolher alertas de fadiga b/i })).toBeTruthy()
  })

  // Mesma regra das listas de funcionários e admins: /chat sem destino abre
  // sempre a conversa mais recente, não a pessoa do card clicado.
  it('ícone de chat abre a conversa da pessoa do card, não /chat solto', async () => {
    await renderAt('/monitoring/alerts')
    fireEvent.click(screen.getByRole('button', { name: /chat com fadiga a/i }))
    // Sessão semeada: u_seed_1 (renderPage). Key ordenada + '#' encodado.
    expect(nav.spy).toHaveBeenCalledWith('/chat/u-fad-1%23u_seed_1')
  })

  it('a busca filtra por nome dentro da aba, sem diferenciar maiúsculas', async () => {
    await renderAt('/monitoring/alerts')
    fireEvent.change(screen.getByPlaceholderText('Pesquisar funcionário'), {
      target: { value: 'fadiga B' },
    })
    await act(async () => {})
    expect(nomesVisiveis()).toEqual(['Fadiga B'])
  })

  it('busca sem correspondência esvazia a lista e diz por quê', async () => {
    await renderAt('/monitoring/alerts')
    fireEvent.change(screen.getByPlaceholderText('Pesquisar funcionário'), {
      target: { value: 'ninguém' },
    })
    await act(async () => {})
    expect(nomesVisiveis()).toEqual([])
    expect(screen.getByTestId('monitoring-empty').textContent).toBe(
      'Nenhum funcionário com esse nome',
    )
  })

  it('o badge conta quem está em alerta agora', async () => {
    await renderAt('/monitoring/alerts')
    expect(screen.getByLabelText('2 alertas de fadiga')).toBeTruthy()
  })

  it('sem ninguém em alerta, o badge some e a aba diz que não há alerta aberto', async () => {
    telemetryMock.mockReturnValue(
      telemetria({
        workers: {
          observedAt: '2026-10-01T15:00:00.000Z',
          workers: [com('u-exc-1', 'Excelente Um')],
        },
      }),
    )
    queueMock.mockResolvedValue({ data: [], error: null })
    await renderAt('/monitoring/alerts')
    expect(screen.queryByLabelText(/alertas de fadiga/)).toBeNull()
    expect(screen.getByTestId('monitoring-empty').textContent).toBe('Nenhum alerta aberto')
  })

  it('pressão e movimentos do KPI vêm do resumo real', async () => {
    await renderAt('/monitoring/alerts')
    expect(screen.getAllByText('124/80').length).toBeGreaterThan(0)
    expect(screen.getAllByText((1840).toLocaleString('pt-BR')).length).toBeGreaterThan(0)
  })

  it('nenhum card abre sozinho fora da aba de alerta', async () => {
    await renderAt('/monitoring/desgastados')
    expect(screen.queryByRole('button', { name: 'Ver histórico de exames clínicos' })).toBeNull()
  })

  it('expandir um card recolhe o que estava aberto', async () => {
    await renderAt('/monitoring/alerts')
    fireEvent.click(screen.getByRole('button', { name: /expandir alertas de fadiga b/i }))
    await act(async () => {})
    expect(screen.getAllByText('Frequência cardíaca alta')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /recolher alertas de fadiga a/i })).toBeNull()
  })

  it('o pino do card leva ao mapa geral e a lupa de exames ao funcionário', async () => {
    await renderAt('/monitoring/alerts')
    fireEvent.click(screen.getByRole('button', { name: /localização de fadiga a/i }))
    expect(nav.spy).toHaveBeenCalledWith('/maps/general')
    fireEvent.click(screen.getByRole('button', { name: 'Ver histórico de exames clínicos' }))
    expect(nav.spy).toHaveBeenCalledWith('/employees/u-fad-1')
  })

  it('trocar de aba pela régua navega para a rota correspondente', async () => {
    await renderAt('/monitoring/alerts')
    fireEvent.click(screen.getByText('Desgastados'))
    expect(nav.spy).toHaveBeenCalledWith('/monitoring/desgastados')
  })

  it('clicar na aba já ativa não renavega', async () => {
    await renderAt('/monitoring/alerts')
    fireEvent.click(screen.getByText('Alertas de Fadiga'))
    expect(nav.spy).not.toHaveBeenCalledWith('/monitoring/alerts')
  })

  it('rota desconhecida cai na aba de alertas', async () => {
    await renderAt('/monitoring')
    expect(nomesVisiveis()).toEqual(['Fadiga A', 'Fadiga B'])
  })

  it('não há selo de dados simulados nem ações que só mostram aviso', async () => {
    await renderAt('/monitoring/alerts')
    expect(screen.queryByTestId('simulated-data-badge')).toBeNull()
    expect(screen.queryByRole('button', { name: /remover fadiga a/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ligar para o funcionário' })).toBeNull()
  })
})

describe('MonitoringLayout: estados', () => {
  it('carregando diz isso em vez de mostrar uma lista vazia', async () => {
    telemetryMock.mockReturnValue(telemetria({ workers: null, summary: null, loading: true }))
    await renderAt('/monitoring/alerts')
    expect(screen.getByTestId('monitoring-status').textContent).toBe('Carregando…')
    expect(screen.queryByTestId('monitoring-empty')).toBeNull()
  })

  it('falha da telemetria diz que a leitura está indisponível', async () => {
    telemetryMock.mockReturnValue(telemetria({ workers: null, summary: null, failed: true }))
    await renderAt('/monitoring/alerts')
    expect(screen.getByTestId('monitoring-status').textContent).toBe(
      'Leitura indisponível no momento',
    )
  })

  it('falha da fila diz isso, sem fingir fila vazia', async () => {
    queueMock.mockResolvedValue({ data: null, error: { message: 'offline' } })
    await renderAt('/monitoring/alerts')
    expect(screen.getByTestId('monitoring-status').textContent).toBe(
      'Não foi possível carregar os alertas',
    )
  })

  it('a lista sobrevive a um cadastro vazio', async () => {
    directoryMock.mockResolvedValue({
      data: { admins: 0, pendingReports: 0, cameras: 0, employees: [] },
      error: null,
    })
    await renderAt('/monitoring/alerts')
    expect(screen.getByTestId('monitoring-layout')).toBeTruthy()
    expect(nomesVisiveis()).toEqual([])
  })
})

describe('MonitoringLayout: triagem', () => {
  it('reconhecer troca o alerta pelo estado que o servidor devolveu, com quem triou', async () => {
    ackMock.mockResolvedValue({
      data: alertaDe('al-1', 'u-fad-1', 'Fadiga A', {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: '2026-10-01T14:20:00.000Z',
        triagedBy: { id: 'adm', name: 'Elisa' },
      }),
      error: null,
    })
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByRole('button', { name: /reconhecer alerta/i }))
    await act(async () => {})

    expect(ackMock).toHaveBeenCalledWith('al-1')
    expect(screen.getByText(/Reconhecido por Elisa às/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /reconhecer alerta/i })).toBeNull()
    expect(screen.getByRole('button', { name: /resolver alerta/i })).toBeTruthy()
  })

  it('resolver tira os botões e mostra quem resolveu', async () => {
    resolveMock.mockResolvedValue({
      data: alertaDe('al-1', 'u-fad-1', 'Fadiga A', {
        status: 'RESOLVED',
        resolvedAt: '2026-10-01T14:30:00.000Z',
        triagedBy: { id: 'adm', name: 'Elisa' },
      }),
      error: null,
    })
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByRole('button', { name: /resolver alerta/i }))
    await act(async () => {})

    expect(resolveMock).toHaveBeenCalledWith('al-1')
    expect(screen.getByText(/Resolvido por Elisa às/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /resolver alerta/i })).toBeNull()
  })

  it('recusa do servidor (409) vira aviso e o alerta fica como estava', async () => {
    ackMock.mockResolvedValue({
      data: null,
      error: { message: 'Alerta já resolvido não pode ser reconhecido' },
    })
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByRole('button', { name: /reconhecer alerta/i }))
    await act(async () => {})

    expect(toast.show).toHaveBeenCalledWith(
      'Não foi possível reconhecer',
      'Alerta já resolvido não pode ser reconhecido',
    )
    expect(screen.getByRole('button', { name: /reconhecer alerta/i })).toBeTruthy()
  })

  it('enquanto o servidor responde, os botões do alerta ficam desligados', async () => {
    let finish: (v: Awaited<ReturnType<typeof telemetryApi.acknowledgeAlert>>) => void = () => {}
    ackMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByRole('button', { name: /reconhecer alerta/i }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /reconhecer alerta/i }))
    fireEvent.click(screen.getByRole('button', { name: /resolver alerta/i }))

    expect(ackMock).toHaveBeenCalledTimes(1)
    expect(resolveMock).not.toHaveBeenCalled()

    await act(async () => {
      finish({ data: FILA[0]!, error: null })
    })
  })
})

describe('MonitoringLayout: pausa e tempo real', () => {
  it('enviar alerta de pausa chama o mesmo pedido real do detalhe', async () => {
    pauseMock.mockResolvedValue({ data: { requested: true }, error: null })
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByRole('button', { name: 'Enviar alerta de pausa' }))
    await act(async () => {})

    expect(pauseMock).toHaveBeenCalledWith('u-fad-1')
    expect(toast.show).toHaveBeenCalledWith(
      'Pausa solicitada',
      'Fadiga A foi notificado para pausar a atividade',
    )
  })

  it('falha na pausa vira aviso com a mensagem do servidor', async () => {
    pauseMock.mockResolvedValue({ data: null, error: { message: 'Worker não encontrado' } })
    await renderAt('/monitoring/alerts')

    fireEvent.click(screen.getByRole('button', { name: 'Enviar alerta de pausa' }))
    await act(async () => {})

    expect(toast.show).toHaveBeenCalledWith('Falha ao solicitar pausa', 'Worker não encontrado')
  })

  it('vários avisos de condição seguidos releem a fila uma vez só', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderAt('/monitoring/alerts')
    expect(queueMock).toHaveBeenCalledTimes(1)

    act(() => {
      socket.onCondition?.()
      socket.onCondition?.()
      socket.onCondition?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUEUE_REFETCH_DEBOUNCE_MS)
    })

    expect(queueMock).toHaveBeenCalledTimes(2)
  })

  it('sair da tela fecha a assinatura do socket', async () => {
    const { unmount } = await renderAt('/monitoring/alerts')
    unmount()
    expect(socket.unsubscribe).toHaveBeenCalled()
  })
})
