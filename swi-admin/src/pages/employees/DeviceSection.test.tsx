// O bloco "Aparelho" por estado: não pareado, código gerado (válido e
// expirado), código pendente após recarga, pareado, e erro. O serviço é dublê;
// o que estes casos protegem é o que o administrador lê e o que cada botão
// dispara. describe/it/expect/afterEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DeviceSection } from './DeviceSection'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { telemetryDevicesApi } from '@/services/api/telemetryDevices'

vi.mock('@/services/api/telemetryDevices', () => ({
  telemetryDevicesApi: { stateOf: vi.fn(), createEnrollment: vi.fn(), revoke: vi.fn() },
}))

const stateOf = vi.mocked(telemetryDevicesApi.stateOf)
const createEnrollment = vi.mocked(telemetryDevicesApi.createEnrollment)
const revoke = vi.mocked(telemetryDevicesApi.revoke)

const UNPAIRED = { data: { device: null, pendingEnrollment: null }, error: null }
const DEVICE = {
  id: 'device-1',
  kind: 'IPHONE',
  model: 'iPhone 15',
  pairedAt: '2026-09-14T12:00:00.000Z',
  lastSeenAt: '2026-09-14T15:30:00.000Z',
}
const PAIRED = { data: { device: DEVICE, pendingEnrollment: null }, error: null }
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

const mount = () => renderPage(<DeviceSection workerId="w1" />, { route: '/x', path: '/x' })

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('DeviceSection: não pareado', () => {
  it('diz "Não pareado" e oferece Parear', async () => {
    stateOf.mockResolvedValue(UNPAIRED)
    await mount()

    expect(await screen.findByTestId('device-section-unpaired')).toBeTruthy()
    expect(screen.getByText('Não pareado')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gerar código de pareamento' })).toBeTruthy()
    expect(stateOf).toHaveBeenCalledWith('w1')
  })

  it('Parear gera o código para o funcionário da página e mostra os seis dígitos com a validade', async () => {
    stateOf.mockResolvedValue(UNPAIRED)
    createEnrollment.mockResolvedValue({
      data: { enrollmentId: 'e1', code: '123456', expiresAt: inMinutes(10) },
      error: null,
    })
    await mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Gerar código de pareamento' }))

    expect(await screen.findByTestId('device-section-code')).toBeTruthy()
    expect(createEnrollment).toHaveBeenCalledWith('w1')
    expect(screen.getByTestId('device-code').textContent).toBe('123456')
    expect(screen.getByText('Aguardando o funcionário')).toBeTruthy()
    expect(screen.getByTestId('device-code-expires')).toBeTruthy()
  })

  it('código já expirado vira "Código expirado" com Gerar outro', async () => {
    // A validade é comparada ao relógio local: um código cujo prazo já passou
    // não pode ser lido para o funcionário como se valesse.
    stateOf.mockResolvedValue(UNPAIRED)
    createEnrollment.mockResolvedValue({
      data: { enrollmentId: 'e1', code: '123456', expiresAt: inMinutes(-1) },
      error: null,
    })
    await mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Gerar código de pareamento' }))

    expect(await screen.findByTestId('device-section-code-expired')).toBeTruthy()
    expect(screen.getByText('Código expirado')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gerar outro código de pareamento' })).toBeTruthy()
    expect(screen.queryByText('123456')).toBeNull()
  })

  it('falha ao gerar mantém o bloco em não pareado', async () => {
    stateOf.mockResolvedValue(UNPAIRED)
    createEnrollment.mockResolvedValue({ data: null, error: { message: 'Too Many Requests' } })
    await mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Gerar código de pareamento' }))

    await waitFor(() => expect(createEnrollment).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('device-section-unpaired')).toBeTruthy()
  })
})

describe('DeviceSection: código pendente após recarga', () => {
  it('diz até quando o código vale, sem mostrá-lo, e oferece Gerar outro', async () => {
    stateOf.mockResolvedValue({
      data: { device: null, pendingEnrollment: { expiresAt: inMinutes(7) } },
      error: null,
    })
    await mount()

    expect(await screen.findByTestId('device-section-unpaired')).toBeTruthy()
    expect(screen.getByText(/Há um código válido até/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gerar código de pareamento' }).textContent).toBe(
      'Gerar outro',
    )
  })
})

describe('DeviceSection: pareado', () => {
  it('mostra Pareado, desde quando, o modelo e o último contato', async () => {
    stateOf.mockResolvedValue(PAIRED)
    await mount()

    expect(await screen.findByTestId('device-section-paired')).toBeTruthy()
    expect(screen.getByText('Pareado')).toBeTruthy()
    expect(screen.getByText(/^Desde .*iPhone 15$/)).toBeTruthy()
    expect(screen.getByText(/Último contato às/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Revogar o aparelho pareado' })).toBeTruthy()
  })

  it('Revogar exige confirmação, e Cancelar volta atrás sem chamar o backend', async () => {
    stateOf.mockResolvedValue(PAIRED)
    await mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Revogar o aparelho pareado' }))
    expect(screen.getByRole('button', { name: 'Confirmar a revogação do aparelho' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar a revogação' }))

    expect(revoke).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Revogar o aparelho pareado' })).toBeTruthy()
  })

  it('confirmar revoga o aparelho e o bloco volta a não pareado', async () => {
    stateOf.mockResolvedValueOnce(PAIRED).mockResolvedValueOnce(UNPAIRED)
    revoke.mockResolvedValue({ data: null, error: null })
    await mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Revogar o aparelho pareado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar a revogação do aparelho' }))

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('device-1'))
    expect(await screen.findByTestId('device-section-unpaired')).toBeTruthy()
  })

  it('falha ao revogar mantém o aparelho pareado', async () => {
    stateOf.mockResolvedValue(PAIRED)
    revoke.mockResolvedValue({ data: null, error: { message: 'Dispositivo não encontrado' } })
    await mount()

    fireEvent.click(await screen.findByRole('button', { name: 'Revogar o aparelho pareado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar a revogação do aparelho' }))

    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: 'Revogar o aparelho pareado' })).toBeTruthy()
  })
})

describe('DeviceSection: erro ao carregar', () => {
  it('diz que não carregou e oferece tentar de novo', async () => {
    stateOf.mockResolvedValueOnce({ data: null, error: { message: 'offline' } }).mockResolvedValueOnce(UNPAIRED)
    await mount()

    expect(await screen.findByTestId('device-section-error')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar carregar o aparelho de novo' }))

    expect(await screen.findByTestId('device-section-unpaired')).toBeTruthy()
  })
})
