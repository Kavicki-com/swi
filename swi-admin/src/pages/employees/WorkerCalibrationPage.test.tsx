// describe/it/expect/vi vêm dos globals do Vitest.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { calibrationDetail, heartRateBand } from '@/test-utils/calibrationFixtures'
import { calibrationApi } from '@/services/api/calibration'
import { employeesApi } from '@/services/api/users'
import { WorkerCalibrationPage } from './WorkerCalibrationPage'

vi.mock('@/services/api/calibration', () => ({
  calibrationApi: {
    detail: vi.fn(),
    history: vi.fn(),
    setBand: vi.fn(),
    revertBand: vi.fn(),
    setSafety: vi.fn(),
    revertSafety: vi.fn(),
  },
}))
vi.mock('@/services/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/users')>()
  return { ...actual, employeesApi: { ...actual.employeesApi, get: vi.fn() } }
})
vi.mock('@/lib/demoToast', () => ({ useDemoToast: () => ({ show: vi.fn() }) }))
// O nível vem do token; aqui cada teste escolhe o seu.
const auth = vi.hoisted(() => ({ level: 'ADMIN' as 'ADMIN' | 'SUPERVISOR' }))
vi.mock('@/hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAuth')>()
  return { ...actual, useAuth: () => ({ user: { level: auth.level } }) }
})
const nav = vi.hoisted(() => ({ spy: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => nav.spy }
})

const detailMock = vi.mocked(calibrationApi.detail)
const historyMock = vi.mocked(calibrationApi.history)
const setBandMock = vi.mocked(calibrationApi.setBand)
const getMock = vi.mocked(employeesApi.get)

const renderAt = (route = '/employees/w1/faixas') =>
  renderPage(<WorkerCalibrationPage />, { route, path: '/employees/:id/faixas' })

beforeEach(() => {
  auth.level = 'ADMIN'
  detailMock.mockResolvedValue({ data: calibrationDetail(), error: null })
  historyMock.mockResolvedValue({ data: { items: [], nextCursor: null }, error: null })
  getMock.mockResolvedValue({ data: { id: 'w1', name: 'João Silva' } as never, error: null })
})
afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('WorkerCalibrationPage', () => {
  it('abre nas faixas, com o nome e a fase do funcionário', async () => {
    await renderAt()
    expect(await screen.findByText('João Silva')).toBeInTheDocument()
    expect(screen.getByText('Calibrando, dia 12 de 30')).toBeInTheDocument()
    expect(await screen.findByTestId('band-row-HEART_RATE')).toBeInTheDocument()
    expect(detailMock).toHaveBeenCalledWith('w1')
  })

  it('volta ao perfil', async () => {
    await renderAt()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para o perfil do funcionário' }))
    expect(nav.spy).toHaveBeenCalledWith('/employees/w1')
  })

  it('a aba mora na URL: ?aba=travas abre as travas', async () => {
    await renderAt('/employees/w1/faixas?aba=travas')
    expect(await screen.findByTestId('safety-row-OXYGEN_LOW')).toBeInTheDocument()
    expect(screen.getByTestId('safety-OXYGEN_LOW-openAt')).toBeInTheDocument()
  })

  it('o supervisor vê as travas sem editar', async () => {
    auth.level = 'SUPERVISOR'
    await renderAt('/employees/w1/faixas?aba=travas')
    expect(await screen.findByText('Só o administrador ajusta as travas.')).toBeInTheDocument()
    expect(screen.queryByTestId('safety-OXYGEN_LOW-openAt')).not.toBeInTheDocument()
  })

  it('trocar de aba mostra o histórico', async () => {
    await renderAt()
    await screen.findByTestId('band-row-HEART_RATE')
    fireEvent.click(screen.getByText('Histórico'))
    expect(await screen.findByText('Nenhuma mudança registrada.')).toBeInTheDocument()
    expect(historyMock).toHaveBeenCalledWith('w1')
  })

  it('salvar uma faixa troca o detalhe pelo que o servidor devolve', async () => {
    const corrected = heartRateBand({
      override: { excellence: 110, fatigue: 146 },
      effective: { excellence: 110, fatigue: 146 },
      source: 'OVERRIDE',
    })
    setBandMock.mockResolvedValue({
      data: calibrationDetail({ metrics: [corrected] }),
      error: null,
    })
    await renderAt()
    const field = (await screen.findByTestId('band-HEART_RATE-excellence')) as HTMLInputElement
    fireEvent.change(field, { target: { value: '110' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar faixa de Batimento cardíaco' }))
    await waitFor(() =>
      expect(setBandMock).toHaveBeenCalledWith('w1', 'HEART_RATE', {
        excellence: 110,
        fatigue: 146,
      }),
    )
    expect(
      await screen.findByRole('button', { name: 'Voltar ao aprendido: Batimento cardíaco' }),
    ).toBeInTheDocument()
  })

  it('falha ao carregar mostra a frase e tenta de novo', async () => {
    detailMock
      .mockResolvedValueOnce({ data: null, error: { message: 'Falha ao carregar a calibração' } })
      .mockResolvedValueOnce({ data: calibrationDetail(), error: null })
    await renderAt()
    expect(await screen.findByText('Falha ao carregar a calibração')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByTestId('band-row-HEART_RATE')).toBeInTheDocument()
  })
})
