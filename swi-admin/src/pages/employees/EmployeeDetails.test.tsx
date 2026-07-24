// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { EmployeeDetails } from './EmployeeDetails'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { employeesApi } from '@/services/api/users'
import { notificationsApi } from '@/services/api/notifications'

vi.mock('@/services/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/users')>()
  return { ...actual, employeesApi: { ...actual.employeesApi, get: vi.fn() } }
})
vi.mock('@/services/api/notifications', () => ({
  notificationsApi: { requestPause: vi.fn() },
}))

const getMock = vi.mocked(employeesApi.get)
const pauseMock = vi.mocked(notificationsApi.requestPause)

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
  it('renders without crashing', () => {
    getMock.mockResolvedValue({ data: null, error: null } as never)
    expect(() =>
      renderPage(<EmployeeDetails />, { route: '/employees/seed_id', path: '/employees/:id' }),
    ).not.toThrow()
  })

  // QA F (2026-07-24): o "Solicitar Pausa" era toast fake. Agora dispara o
  // POST real (notificação de journey pro worker) com o id da rota.
  it('Solicitar Pausa → notificationsApi.requestPause com o id do funcionário', async () => {
    getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
    pauseMock.mockResolvedValue({ data: { requested: true }, error: null })
    renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })

    fireEvent.click(
      await screen.findByRole('button', { name: 'Solicitar pausa para o funcionário' }),
    )

    await waitFor(() => expect(pauseMock).toHaveBeenCalledWith('w1'))
  })
})
