// "Voltar" do detalhe do funcionário. O administrador volta para a lista de
// funcionários; o supervisor não tem essa lista (o AdminOnly o mandava para a
// home), então volta para a tela de onde veio, ou para o monitoramento quando
// abriu o detalhe direto pelo endereço.
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { clearSession, seedSession } from '@/test-utils/renderPage'
import { employeesApi } from '@/services/api/users'
import { telemetryApi } from '@/services/api/telemetry'
import { neverReported } from '@/test-utils/telemetryFixtures'
import { EmployeeDetails } from './EmployeeDetails'

vi.mock('@/services/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/users')>()
  return { ...actual, employeesApi: { ...actual.employeesApi, get: vi.fn() } }
})
vi.mock('@/services/api/notifications', () => ({ notificationsApi: { requestPause: vi.fn() } }))
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
    workerSeries: vi.fn().mockResolvedValue({ data: null, error: { message: 'sem série' } }),
  },
}))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: vi.fn(() => () => {}),
}))
vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => null }))

const nav = vi.hoisted(() => ({ spy: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => nav.spy }
})
// O nível vem do token; aqui cada teste escolhe o seu, sobre a sessão real.
const auth = vi.hoisted(() => ({ level: 'ADMIN' as 'ADMIN' | 'SUPERVISOR' }))
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

const EMPLOYEE = {
  id: 'w1',
  name: 'Worker Um',
  role: 'Operador',
  specialization: 'Norte',
  sector: 'Norte',
  age: 30,
  bloodType: 'A+',
  vitalsStatus: 'good',
  avatarUri: undefined,
} as never

async function renderWith(entries: string[], ui: ReactElement = <EmployeeDetails />) {
  seedSession()
  render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
          <Routes>
            <Route path="/employees/:id" element={ui} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )
  await act(async () => {})
}

beforeEach(() => {
  vi.mocked(employeesApi.get).mockResolvedValue({ data: EMPLOYEE, error: null } as never)
  vi.mocked(telemetryApi.workerCurrent).mockResolvedValue({ data: neverReported(), error: null })
})

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
  auth.level = 'ADMIN'
})

const clickBack = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /^Voltar/ }))
}

describe('EmployeeDetails: Voltar', () => {
  it('o administrador volta para a lista de funcionários', async () => {
    await renderWith(['/employees/w1'])
    await clickBack()
    expect(nav.spy).toHaveBeenCalledWith('/employees')
  })

  it('o supervisor que abriu o detalhe direto volta para o monitoramento, não para a home', async () => {
    auth.level = 'SUPERVISOR'
    await renderWith(['/employees/w1'])
    await clickBack()
    expect(nav.spy).toHaveBeenCalledWith('/monitoring/alerts')
    expect(nav.spy).not.toHaveBeenCalledWith('/employees')
  })

  it('o supervisor que veio de outra tela volta para ela', async () => {
    auth.level = 'SUPERVISOR'
    await renderWith(['/maps/general', '/employees/w1'])
    await clickBack()
    expect(nav.spy).toHaveBeenCalledWith(-1)
  })
})
