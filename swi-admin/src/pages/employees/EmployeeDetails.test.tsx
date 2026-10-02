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
import { neverReported, reporting } from '@/test-utils/telemetryFixtures'

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
  telemetryApi: { workerCurrent: vi.fn() },
}))

const getMock = vi.mocked(employeesApi.get)
const pauseMock = vi.mocked(notificationsApi.requestPause)
const currentMock = vi.mocked(telemetryApi.workerCurrent)

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
  afterEach(() => {
    vi.useRealTimers()
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
})
