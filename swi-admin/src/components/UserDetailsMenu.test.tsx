// O menu do avatar é a superfície onde o painel mais afirmava biometria
// sem fonte: bateria, temperatura e movimentos fixos, e um traçado de pulso
// animado. Estes testes garantem que, sem aparelho, nada disso aparece.
// vitest globals (describe/it/expect) via globals: true.
import { vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderPage, clearSession } from '@/test-utils/renderPage'
import { reporting } from '@/test-utils/telemetryFixtures'
import { UserDetailsMenu } from './UserDetailsMenu'

const adminGetMock = vi.fn()
const stateOfMock = vi.fn()
const currentMock = vi.fn()

vi.mock('@/services/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/users')>()
  return {
    ...actual,
    adminsApi: { ...actual.adminsApi, get: (...a: unknown[]) => adminGetMock(...a) },
  }
})
vi.mock('@/services/api/telemetryDevices', () => ({
  telemetryDevicesApi: { stateOf: (...a: unknown[]) => stateOfMock(...a) },
}))
vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: { workerCurrent: (...a: unknown[]) => currentMock(...a) },
}))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: () => () => {},
}))

const ADMIN = { id: 'u_seed_1', role: 'Coordenadora', specialization: 'Operações' }

beforeEach(() => {
  adminGetMock.mockResolvedValue({ data: ADMIN, error: null })
  stateOfMock.mockResolvedValue({ data: { device: null, pendingEnrollment: null }, error: null })
  currentMock.mockResolvedValue({ data: reporting(), error: null })
})

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('UserDetailsMenu', () => {
  it('sem aparelho diz isso e não afirma nenhum vital', async () => {
    await renderPage(<UserDetailsMenu open onClose={() => {}} />)
    expect(await screen.findByText('Sem aparelho')).toBeInTheDocument()
    expect(await screen.findByText('Coordenadora')).toBeInTheDocument()
    expect(screen.queryByText('78%')).not.toBeInTheDocument()
    expect(screen.queryByText('23 mpm')).not.toBeInTheDocument()
    expect(screen.queryByText(/36,5/)).not.toBeInTheDocument()
    expect(screen.queryByText('Engenheiro hidráulico')).not.toBeInTheDocument()
    // O traçado de pulso é um <canvas>; sem leitura ele não é desenhado.
    expect(document.querySelector('canvas')).toBeNull()
    expect(currentMock).not.toHaveBeenCalled()
  })

  it('com aparelho pareado mostra a leitura do próprio admin', async () => {
    stateOfMock.mockResolvedValue({
      data: {
        device: {
          id: 'd1',
          kind: 'IPHONE',
          model: null,
          pairedAt: '2026-10-01T10:00:00.000Z',
          lastSeenAt: null,
        },
        pendingEnrollment: null,
      },
      error: null,
    })
    await renderPage(<UserDetailsMenu open onClose={() => {}} />)
    expect(await screen.findByText('Monitorando agora')).toBeInTheDocument()
    expect(currentMock).toHaveBeenCalledWith('u_seed_1')
  })

  it('fechado não busca nada', async () => {
    await renderPage(<UserDetailsMenu open={false} onClose={() => {}} />)
    expect(adminGetMock).not.toHaveBeenCalled()
    expect(stateOfMock).not.toHaveBeenCalled()
  })
})
