// O bloco "Aparelho" por estado: não pareado, código gerado (válido e
// expirado), código pendente após recarga, pareado, e erro. O serviço é dublê;
// o que estes casos protegem é o que o administrador lê e o que cada botão
// dispara. describe/it/expect/afterEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { DeviceSection } from './DeviceSection'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { telemetryDevicesApi } from '@/services/api/telemetryDevices'
import type { WorkerTelemetry } from '@/services/api/telemetry'
import { condition, metric, neverReported, reporting } from '@/test-utils/telemetryFixtures'

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
    // Contato de outro dia leva a data, para não parecer de hoje.
    expect(screen.getByText(/^Último contato em \d{2}\/\d{2} às \d{2}:\d{2}$/)).toBeTruthy()
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

// Leitura de hoje a uma hora fixa, no fuso de quem roda o teste.
const todayAt = (hour: number, minute: number) => {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}
const pairedSeenAt = (lastSeenAt: string) => ({
  data: { device: { ...DEVICE, lastSeenAt }, pendingEnrollment: null },
  error: null,
})
const mountWith = (telemetry: WorkerTelemetry | null, onPairedChange?: (p: boolean) => void) =>
  renderPage(
    <DeviceSection workerId="w1" telemetry={telemetry} onPairedChange={onPairedChange} />,
    { route: '/x', path: '/x' },
  )

// A página troca a leitura a cada releitura da telemetria; o botão faz isso.
function Harness({ first, next }: { first: WorkerTelemetry; next: WorkerTelemetry }) {
  const [telemetry, setTelemetry] = useState(first)
  return (
    <>
      <DeviceSection workerId="w1" telemetry={telemetry} />
      <button onClick={() => setTelemetry(next)}>nova leitura</button>
    </>
  )
}
const mountHarness = () =>
  renderPage(<Harness first={reporting()} next={{ ...reporting(), observedAt: 'depois' }} />, {
    route: '/x',
    path: '/x',
  })

describe('DeviceSection: bateria e condições do relógio', () => {
  it('leitura atual mostra a bateria do relógio', async () => {
    stateOf.mockResolvedValue(PAIRED)
    await mountWith(reporting({ battery: metric(81) }))
    expect(await screen.findByText('Bateria do relógio: 81%')).toBeTruthy()
  })

  it('bateria de leitura que não é atual diz a hora dela', async () => {
    stateOf.mockResolvedValue(PAIRED)
    await mountWith(
      reporting({ battery: metric(81, { quality: 'STALE', measuredAt: todayAt(14, 20) }) }),
    )
    expect(await screen.findByText('Bateria do relógio: 81% às 14:20')).toBeTruthy()
  })

  it('bateria de outro dia diz o dia', async () => {
    stateOf.mockResolvedValue(PAIRED)
    const otherDay = new Date(2025, 9, 3, 14, 20).toISOString()
    await mountWith(reporting({ battery: metric(81, { quality: 'STALE', measuredAt: otherDay }) }))
    expect(await screen.findByText('Bateria do relógio: 81% em 03/10 às 14:20')).toBeTruthy()
  })

  it('sem leitura de bateria, diz isso em vez de mostrar zero', async () => {
    stateOf.mockResolvedValue(PAIRED)
    await mountWith(neverReported())
    expect(await screen.findByText('Bateria do relógio: sem leitura')).toBeTruthy()
  })

  it('sem a telemetria, o bloco não fala da bateria', async () => {
    stateOf.mockResolvedValue(PAIRED)
    await mount()
    await screen.findByTestId('device-section-paired')
    expect(screen.queryByText(/Bateria do relógio/)).toBeNull()
  })

  it('condição de bateria baixa aberta vira tag', async () => {
    stateOf.mockResolvedValue(PAIRED)
    await mountWith({
      ...reporting({ battery: metric(12) }),
      conditions: [condition('DEVICE', { kind: 'DEVICE_BATTERY_LOW', observedValue: 12 })],
    })
    expect(await screen.findByText('Bateria do relógio baixa')).toBeTruthy()
    expect(screen.queryByText('Sem sinal do relógio')).toBeNull()
  })

  it('condição de sem sinal aberta vira tag', async () => {
    stateOf.mockResolvedValue(PAIRED)
    await mountWith({
      ...reporting(),
      conditions: [condition('DEVICE', { kind: 'DEVICE_SIGNAL_LOST' })],
    })
    expect(await screen.findByText('Sem sinal do relógio')).toBeTruthy()
    expect(screen.queryByText('Bateria do relógio baixa')).toBeNull()
  })

  it('condição de saúde não vira tag do aparelho', async () => {
    stateOf.mockResolvedValue(PAIRED)
    await mountWith({ ...reporting(), conditions: [condition('URGENT')] })
    await screen.findByTestId('device-section-paired')
    expect(screen.queryByText('Bateria do relógio baixa')).toBeNull()
    expect(screen.queryByText('Sem sinal do relógio')).toBeNull()
  })

  it('sem aparelho pareado, nada de bateria nem de tag, mesmo com leitura', async () => {
    stateOf.mockResolvedValue(UNPAIRED)
    await mountWith({
      ...reporting({ battery: metric(12) }),
      conditions: [condition('DEVICE', { kind: 'DEVICE_BATTERY_LOW', observedValue: 12 })],
    })
    await screen.findByTestId('device-section-unpaired')
    expect(screen.queryByText(/Bateria do relógio/)).toBeNull()
  })
})

describe('DeviceSection: último contato relido com a telemetria', () => {
  it('contato de hoje diz só a hora', async () => {
    stateOf.mockResolvedValue(pairedSeenAt(todayAt(9, 5)))
    await mount()
    expect(await screen.findByText('Último contato às 09:05')).toBeTruthy()
  })

  it('cada leitura nova da telemetria relê o aparelho e atualiza o último contato', async () => {
    stateOf
      .mockResolvedValueOnce(pairedSeenAt(todayAt(9, 5)))
      .mockResolvedValueOnce(pairedSeenAt(todayAt(9, 6)))
    await mountHarness()
    await screen.findByText('Último contato às 09:05')

    fireEvent.click(screen.getByText('nova leitura'))

    expect(await screen.findByText('Último contato às 09:06')).toBeTruthy()
    expect(stateOf).toHaveBeenCalledTimes(2)
  })

  it('a releitura não desfaz a confirmação de revogação que está aberta', async () => {
    stateOf
      .mockResolvedValueOnce(pairedSeenAt(todayAt(9, 5)))
      .mockResolvedValueOnce(pairedSeenAt(todayAt(9, 6)))
    await mountHarness()
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar o aparelho pareado' }))

    fireEvent.click(screen.getByText('nova leitura'))

    await screen.findByText('Último contato às 09:06')
    expect(screen.getByRole('button', { name: 'Confirmar a revogação do aparelho' })).toBeTruthy()
  })

  it('aparelho revogado em outra sessão: a releitura volta o bloco para não pareado', async () => {
    stateOf.mockResolvedValueOnce(pairedSeenAt(todayAt(9, 5))).mockResolvedValueOnce(UNPAIRED)
    await mountHarness()
    await screen.findByTestId('device-section-paired')

    fireEvent.click(screen.getByText('nova leitura'))

    expect(await screen.findByTestId('device-section-unpaired')).toBeTruthy()
  })

  it('releitura que falha mantém o bloco como está', async () => {
    stateOf
      .mockResolvedValueOnce(pairedSeenAt(todayAt(9, 5)))
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    await mountHarness()
    await screen.findByText('Último contato às 09:05')

    fireEvent.click(screen.getByText('nova leitura'))

    await waitFor(() => expect(stateOf).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Último contato às 09:05')).toBeTruthy()
  })

  it('fora de "Pareado" a leitura nova não relê o aparelho, para não apagar o código na tela', async () => {
    stateOf.mockResolvedValue(UNPAIRED)
    await mountHarness()
    await screen.findByTestId('device-section-unpaired')

    fireEvent.click(screen.getByText('nova leitura'))

    expect(stateOf).toHaveBeenCalledTimes(1)
  })
})

describe('DeviceSection: aviso à página', () => {
  it('avisa que há aparelho pareado', async () => {
    stateOf.mockResolvedValue(PAIRED)
    const onPairedChange = vi.fn()
    await mountWith(null, onPairedChange)
    await waitFor(() => expect(onPairedChange).toHaveBeenLastCalledWith(true))
  })

  it('avisa que não há aparelho pareado', async () => {
    stateOf.mockResolvedValue(UNPAIRED)
    const onPairedChange = vi.fn()
    await mountWith(null, onPairedChange)
    await waitFor(() => expect(onPairedChange).toHaveBeenLastCalledWith(false))
  })

  it('erro ao carregar não afirma nada', async () => {
    stateOf.mockResolvedValue({ data: null, error: { message: 'offline' } })
    const onPairedChange = vi.fn()
    await mountWith(null, onPairedChange)
    await screen.findByTestId('device-section-error')
    expect(onPairedChange).not.toHaveBeenCalled()
  })
})
