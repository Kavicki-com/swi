// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { EmployeeDetails } from './EmployeeDetails'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { employeesApi } from '@/services/api/users'
import { notificationsApi } from '@/services/api/notifications'
import { telemetryApi } from '@/services/api/telemetry'
import { telemetryDevicesApi } from '@/services/api/telemetryDevices'
import { metric, neverReported, reporting } from '@/test-utils/telemetryFixtures'

vi.mock('@/services/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/users')>()
  return { ...actual, employeesApi: { ...actual.employeesApi, get: vi.fn() } }
})
vi.mock('@/services/api/notifications', () => ({
  notificationsApi: { requestPause: vi.fn() },
}))
// O bloco "Aparelho" carrega o estado ao montar; sem o dublê a página tentaria
// falar com o backend. O comportamento do bloco tem suíte própria.
vi.mock('@/services/api/telemetryDevices', () => ({
  telemetryDevicesApi: {
    stateOf: vi
      .fn()
      .mockResolvedValue({ data: { device: null, pendingEnrollment: null }, error: null }),
    createEnrollment: vi.fn(),
    revoke: vi.fn(),
  },
}))

vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: {
    workerCurrent: vi.fn(),
    // O gráfico de gasto calórico tem suíte própria; aqui basta não quebrar.
    workerSeries: vi.fn().mockResolvedValue({ data: null, error: { message: 'sem série' } }),
  },
}))
// Sem o dublê a página abriria um socket de verdade no jsdom.
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: vi.fn(() => () => {}),
}))
// Posições ao vivo têm suíte própria; aqui cada teste escolhe a do minimapa.
const live = vi.hoisted(() => ({ value: null as Array<Record<string, unknown>> | null }))
vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => live.value }))

const getMock = vi.mocked(employeesApi.get)
const pauseMock = vi.mocked(notificationsApi.requestPause)
const currentMock = vi.mocked(telemetryApi.workerCurrent)
const stateOfMock = vi.mocked(telemetryDevicesApi.stateOf)
const UNPAIRED = { data: { device: null, pendingEnrollment: null }, error: null }
const PAIRED = {
  data: {
    device: {
      id: 'device-1',
      kind: 'IPHONE',
      model: 'iPhone 15',
      pairedAt: '2026-09-14T12:00:00.000Z',
      lastSeenAt: '2026-09-14T15:30:00.000Z',
    },
    pendingEnrollment: null,
  },
  error: null,
}

const EMPLOYEE = {
  id: 'w1',
  name: 'Worker Um',
  role: 'Operador',
  specialization: 'Norte',
  sector: 'Norte',
  age: 30,
  bloodType: '—',
  vitalsStatus: 'good',
  avatarUri: undefined,
} as never

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
  live.value = null
})

describe('EmployeeDetails', () => {
  beforeEach(() => {
    currentMock.mockResolvedValue({ data: neverReported(), error: null })
  })

  it('renders without crashing', async () => {
    getMock.mockResolvedValue({ data: null, error: null } as never)
    await expect(
      renderPage(<EmployeeDetails />, { route: '/employees/seed_id', path: '/employees/:id' }),
    ).resolves.toBeDefined()
  })

  // O "Solicitar Pausa" dispara o POST real, que é a notificação de journey pro
  // worker, com o id da rota.
  it('Solicitar Pausa → notificationsApi.requestPause com o id do funcionário', async () => {
    getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
    pauseMock.mockResolvedValue({ data: { requested: true }, error: null })
    await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Solicitar pausa para o funcionário' }),
    )

    await waitFor(() => expect(pauseMock).toHaveBeenCalledWith('w1'))
  })
})

describe('EmployeeDetails: vitais do aparelho', () => {
  // Os vitais abaixo são de quem tem aparelho pareado; sem ele a tela diz
  // "Sem aparelho" (caso no fim deste bloco).
  beforeEach(() => {
    stateOfMock.mockResolvedValue(PAIRED)
  })

  afterEach(() => {
    vi.useRealTimers()
    stateOfMock.mockResolvedValue(UNPAIRED)
  })

  it('lê a telemetria do funcionário da rota e mostra o batimento real', async () => {
    getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
    currentMock.mockResolvedValue({ data: reporting(), error: null })
    await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })

    expect(await screen.findByText('Monitorando agora')).toBeInTheDocument()
    expect(screen.getByText(/^112\s*$/)).toBeInTheDocument()
    expect(currentMock).toHaveBeenCalledWith('w1')
  })

  it('quem nunca reportou aparece sem leitura, não com zero', async () => {
    getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
    currentMock.mockResolvedValue({ data: neverReported(), error: null })
    await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })

    expect(await screen.findByText('Sem leitura do aparelho')).toBeInTheDocument()
    expect(screen.queryByText('0 minutos')).not.toBeInTheDocument()
  })

  it('falha na leitura não derruba a página nem inventa valor', async () => {
    getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
    currentMock.mockResolvedValue({ data: null, error: { message: 'offline' } })
    await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })

    expect(await screen.findByText('Leitura indisponível no momento')).toBeInTheDocument()
  })

  // Até o socket do painel existir, a página relê sozinha para o operador não
  // precisar recarregar.
  it('relê a telemetria a cada 15 segundos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
    currentMock.mockResolvedValue({ data: reporting(), error: null })
    await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })
    await screen.findByText('Monitorando agora')
    const before = currentMock.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    await waitFor(() => expect(currentMock.mock.calls.length).toBe(before + 1))
  })

  it('sem aparelho pareado, os vitais dizem "Sem aparelho" em vez de "sem leitura"', async () => {
    stateOfMock.mockResolvedValue(UNPAIRED)
    getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
    currentMock.mockResolvedValue({ data: neverReported(), error: null })
    await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })

    expect(await screen.findByText('Sem aparelho')).toBeInTheDocument()
    expect(screen.queryByText('Sem leitura do aparelho')).not.toBeInTheDocument()
  })

  it('o bloco Aparelho recebe a leitura da página e mostra a bateria do relógio', async () => {
    getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
    currentMock.mockResolvedValue({ data: reporting({ battery: metric(81) }), error: null })
    await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })

    expect(await screen.findByText('Bateria do relógio: 81%')).toBeInTheDocument()
  })
})

describe('EmployeeDetails: hora da posição', () => {
  const pinAt = (msAgo: number) => ({
    id: 'w1',
    name: 'Worker Um',
    lat: -23.55,
    lng: -46.63,
    status: 'offline',
    avatarUri: '',
    recordedAt: new Date(Date.now() - msAgo).toISOString(),
  })

  beforeEach(() => {
    currentMock.mockResolvedValue({ data: neverReported(), error: null })
    getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
  })

  it('posição com mais de 5 minutos mostra a hora junto do minimapa', async () => {
    live.value = [pinAt(10 * 60_000)]
    await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })
    expect(
      await screen.findByText(/^Última posição (em \d{2}\/\d{2} )?às \d{2}:\d{2}$/),
    ).toBeInTheDocument()
  })

  it('posição atual não ganha texto', async () => {
    live.value = [pinAt(60_000)]
    await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })
    await screen.findByTestId('device-section-unpaired')
    expect(screen.queryByText(/Última posição/)).toBeNull()
  })
})
