// O bloco "Aparelho" do celular Android com o relato de prontidão: caminho
// ativo, lista de prontidão com a hora do relato, "não informado pelo app", a
// última falha sem botão, o iPhone sem lista e o link da data de nascimento
// para o cadastro. O serviço é dublê; o que estes casos protegem é o que o
// gestor lê e para onde o link leva. describe/it/expect/afterEach vêm dos
// globals do Vitest.
import { vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { DeviceSection } from './DeviceSection'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import {
  telemetryDevicesApi,
  type ReadinessReport,
  type ReadinessStep,
  type WorkerDevice,
} from '@/services/api/telemetryDevices'

vi.mock('@/services/api/telemetryDevices', () => ({
  telemetryDevicesApi: { stateOf: vi.fn(), createEnrollment: vi.fn(), revoke: vi.fn() },
}))

const auth = vi.hoisted(() => ({ level: 'ADMIN' as 'ADMIN' | 'SUPERVISOR' }))
vi.mock('@/hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAuth')>()
  return { ...actual, useAuth: () => ({ user: { level: auth.level } }) }
})

const stateOf = vi.mocked(telemetryDevicesApi.stateOf)

/** Hoje, na hora local dada, para a legenda sair só com a hora. */
const today = (h: number, m: number): string => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

const REPORT: ReadinessReport = {
  healthConnect: {
    availability: 'AVAILABLE',
    readGranted: true,
    backgroundGranted: false,
    manufacturerPackage: null,
    lastSyncAt: today(9, 0),
    lastFailure: null,
  },
  bluetooth: {
    bandChosen: true,
    listenerState: 'CONNECTED',
    listenerStateSince: today(8, 0),
    lastReadingAt: today(9, 5),
  },
}

const STEPS: ReadinessStep[] = [
  { id: 'PAIR', obrigatorio: true, pendente: false },
  { id: 'HEALTH_CONNECT_INSTALL', obrigatorio: true, pendente: false },
  { id: 'HEALTH_CONNECT_READ', obrigatorio: true, pendente: false },
  { id: 'HEALTH_CONNECT_BACKGROUND', obrigatorio: true, pendente: true },
  { id: 'MANUFACTURER_APP', obrigatorio: false, pendente: true },
  { id: 'BLUETOOTH_BAND', obrigatorio: false, pendente: false },
  { id: 'BIRTH_DATE', obrigatorio: true, pendente: false },
]

const android = (over: Partial<WorkerDevice> = {}): WorkerDevice => ({
  id: 'device-1',
  kind: 'ANDROID_PHONE',
  model: 'Pixel 8',
  pairedAt: '2026-09-14T12:00:00.000Z',
  lastSeenAt: today(9, 0),
  relato: REPORT,
  relatadoEm: today(9, 10),
  caminhosAtivos: ['HEALTH_CONNECT', 'BLUETOOTH'],
  pendencias: STEPS,
  ...over,
})

const withReport = (over: {
  healthConnect?: Partial<ReadinessReport['healthConnect']>
  bluetooth?: Partial<ReadinessReport['bluetooth']>
}): ReadinessReport => ({
  healthConnect: { ...REPORT.healthConnect, ...over.healthConnect },
  bluetooth: { ...REPORT.bluetooth, ...over.bluetooth },
})

const mount = async (device: WorkerDevice) => {
  stateOf.mockResolvedValue({ data: { device, pendingEnrollment: null }, error: null })
  await renderPage(
    <Routes>
      <Route path="/x" element={<DeviceSection workerId="w1" />} />
      <Route path="/employees/:id/edit" element={<p>Edição do cadastro</p>} />
    </Routes>,
    { route: '/x' },
  )
  await screen.findByTestId('device-section-paired')
}

const stepRows = () => screen.getAllByTestId(/^readiness-step-/)

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
  auth.level = 'ADMIN'
})

describe('DeviceSection: caminho ativo', () => {
  it('os dois caminhos', async () => {
    await mount(android())
    expect(screen.getByText('Caminho ativo: Health Connect e Bluetooth')).toBeTruthy()
  })

  it('só o Health Connect', async () => {
    await mount(android({ caminhosAtivos: ['HEALTH_CONNECT'] }))
    expect(screen.getByText('Caminho ativo: Health Connect')).toBeTruthy()
  })

  it('só o Bluetooth', async () => {
    await mount(android({ caminhosAtivos: ['BLUETOOTH'] }))
    expect(screen.getByText('Caminho ativo: Bluetooth')).toBeTruthy()
  })

  it('nenhum', async () => {
    await mount(android({ caminhosAtivos: [] }))
    expect(screen.getByText('Caminho ativo: nenhum')).toBeTruthy()
  })

  it('o tipo do aparelho não afirma mais o caminho', async () => {
    await mount(android({ caminhosAtivos: ['BLUETOOTH'] }))
    expect(screen.getByText('Celular Android com pulseira')).toBeTruthy()
    expect(screen.queryByText(/\(Health Connect\)/)).toBeNull()
  })
})

describe('DeviceSection: lista de prontidão', () => {
  it('passos na ordem da lista, opcionais marcados, com a hora do relato', async () => {
    await mount(android())

    expect(screen.getByText('Lista de prontidão')).toBeTruthy()
    expect(screen.getByText('Informado pelo app às 09:10')).toBeTruthy()
    expect(stepRows().map((row) => row.getAttribute('data-testid'))).toEqual([
      'readiness-step-PAIR',
      'readiness-step-HEALTH_CONNECT_INSTALL',
      'readiness-step-HEALTH_CONNECT_READ',
      'readiness-step-HEALTH_CONNECT_BACKGROUND',
      'readiness-step-MANUFACTURER_APP',
      'readiness-step-BLUETOOTH_BAND',
      'readiness-step-BIRTH_DATE',
    ])
    const background = screen.getByTestId('readiness-step-HEALTH_CONNECT_BACKGROUND')
    expect(within(background).getByText('Permitir a leitura em segundo plano')).toBeTruthy()
    expect(within(background).getByText('Pendente')).toBeTruthy()
    expect(within(background).queryByText('Opcional')).toBeNull()

    const manufacturer = screen.getByTestId('readiness-step-MANUFACTURER_APP')
    expect(within(manufacturer).getByText('Ligar o envio no app do fabricante')).toBeTruthy()
    expect(within(manufacturer).getByText('Opcional')).toBeTruthy()
    expect(within(manufacturer).getByText('Pendente')).toBeTruthy()

    const band = screen.getByTestId('readiness-step-BLUETOOTH_BAND')
    expect(within(band).getByText('Escolher a pulseira por Bluetooth')).toBeTruthy()
    expect(within(band).getByText('Opcional')).toBeTruthy()
    expect(within(band).queryByText('Pendente')).toBeNull()
  })

  it('relato de outro dia leva a data', async () => {
    await mount(android({ relatadoEm: '2026-09-14T15:30:00.000Z' }))
    expect(screen.getByText(/^Informado pelo app em \d{2}\/\d{2} às \d{2}:\d{2}$/)).toBeTruthy()
  })

  it('sem relato, os passos que dependem do app saem "não informado pelo app"', async () => {
    await mount(
      android({
        relato: null,
        relatadoEm: null,
        caminhosAtivos: [],
        pendencias: [
          { id: 'PAIR', obrigatorio: true, pendente: false },
          { id: 'HEALTH_CONNECT_INSTALL', obrigatorio: true, pendente: null },
          { id: 'HEALTH_CONNECT_READ', obrigatorio: true, pendente: null },
          { id: 'HEALTH_CONNECT_BACKGROUND', obrigatorio: true, pendente: null },
          { id: 'MANUFACTURER_APP', obrigatorio: false, pendente: null },
          { id: 'BLUETOOTH_BAND', obrigatorio: false, pendente: null },
          { id: 'BIRTH_DATE', obrigatorio: true, pendente: false },
        ],
      }),
    )

    expect(screen.getByText('O app ainda não informou a prontidão.')).toBeTruthy()
    expect(screen.getAllByText('não informado pelo app')).toHaveLength(5)
    expect(screen.queryByText('Pendente')).toBeNull()
    const pair = screen.getByTestId('readiness-step-PAIR')
    expect(within(pair).queryByText('não informado pelo app')).toBeNull()
  })

  it('sem guia por app do fabricante', async () => {
    await mount(android())
    expect(screen.queryByText(/guia/i)).toBeNull()
  })
})

describe('DeviceSection: data de nascimento', () => {
  const missingBirthDate = STEPS.map((s) => (s.id === 'BIRTH_DATE' ? { ...s, pendente: true } : s))

  it('pendente, o item leva o administrador à edição do cadastro', async () => {
    await mount(android({ pendencias: missingBirthDate }))

    const row = screen.getByTestId('readiness-step-BIRTH_DATE')
    expect(within(row).getByText('Data de nascimento no cadastro')).toBeTruthy()
    fireEvent.click(
      within(row).getByRole('button', { name: 'Preencher a data de nascimento no cadastro' }),
    )

    expect(await screen.findByText('Edição do cadastro')).toBeTruthy()
  })

  it('o supervisor não edita o cadastro: o item diz isso, sem link', async () => {
    auth.level = 'SUPERVISOR'
    await mount(android({ pendencias: missingBirthDate }))

    const row = screen.getByTestId('readiness-step-BIRTH_DATE')
    expect(within(row).queryByRole('button')).toBeNull()
    expect(within(row).getByText('Só o administrador corrige o cadastro.')).toBeTruthy()
  })

  it('cumprida, sem link', async () => {
    await mount(android())
    const row = screen.getByTestId('readiness-step-BIRTH_DATE')
    expect(within(row).queryByRole('button')).toBeNull()
  })
})

describe('DeviceSection: última falha do relato', () => {
  it('sincronização do Health Connect que falhou depois da última com sucesso', async () => {
    await mount(
      android({
        relato: withReport({
          healthConnect: {
            lastSyncAt: today(8, 0),
            lastFailure: { reason: 'PERMISSION_DENIED', at: today(9, 2) },
          },
        }),
      }),
    )

    const failure = screen.getByTestId('device-failure-health-connect')
    expect(within(failure).getByText('Sincronização falhou às 09:02')).toBeTruthy()
    expect(within(failure).getByText('Permissão do Health Connect negada')).toBeTruthy()
    expect(within(failure).queryByRole('button')).toBeNull()
  })

  it('falha sem nenhuma sincronização com sucesso aparece', async () => {
    await mount(
      android({
        relato: withReport({
          healthConnect: { lastSyncAt: null, lastFailure: { reason: 'OTHER', at: today(9, 2) } },
        }),
      }),
    )
    expect(screen.getByText('Sincronização falhou às 09:02')).toBeTruthy()
  })

  it('falha anterior à última sincronização com sucesso não aparece', async () => {
    await mount(
      android({
        relato: withReport({
          healthConnect: {
            lastSyncAt: today(9, 0),
            lastFailure: { reason: 'OTHER', at: today(8, 0) },
          },
        }),
      }),
    )
    expect(screen.queryByText(/Sincronização falhou/)).toBeNull()
  })

  it('pulseira procurando: desconectada desde a mudança de estado', async () => {
    await mount(
      android({
        relato: withReport({
          bluetooth: { listenerState: 'SEARCHING', listenerStateSince: today(8, 45) },
        }),
      }),
    )

    const failure = screen.getByTestId('device-failure-bluetooth')
    expect(within(failure).getByText('Pulseira desconectada desde 08:45')).toBeTruthy()
    expect(within(failure).queryByRole('button')).toBeNull()
  })

  it('Bluetooth desligado no celular também é pulseira desconectada, com o motivo', async () => {
    await mount(
      android({
        relato: withReport({
          bluetooth: { listenerState: 'BLUETOOTH_OFF', listenerStateSince: today(7, 30) },
        }),
      }),
    )

    const failure = screen.getByTestId('device-failure-bluetooth')
    expect(within(failure).getByText('Pulseira desconectada desde 07:30')).toBeTruthy()
    expect(within(failure).getByText('Bluetooth desligado no celular')).toBeTruthy()
  })

  it('desconectada de outro dia leva a data', async () => {
    await mount(
      android({
        relato: withReport({
          bluetooth: { listenerState: 'SEARCHING', listenerStateSince: '2026-09-14T15:30:00.000Z' },
        }),
      }),
    )
    expect(
      screen.getByText(/^Pulseira desconectada desde \d{2}\/\d{2} às \d{2}:\d{2}$/),
    ).toBeTruthy()
  })

  it('escuta encerrada não é falha', async () => {
    await mount(android({ relato: withReport({ bluetooth: { listenerState: 'ENDED' } }) }))
    expect(screen.queryByText(/Pulseira desconectada/)).toBeNull()
  })

  it('escuta conectada não é falha', async () => {
    await mount(android())
    expect(screen.queryByText(/Pulseira desconectada/)).toBeNull()
    expect(screen.queryByText(/Sincronização falhou/)).toBeNull()
  })
})

describe('DeviceSection: iPhone', () => {
  it('não mostra lista de prontidão, caminho nem falha', async () => {
    await mount({
      id: 'device-1',
      kind: 'IPHONE',
      model: 'iPhone 15',
      pairedAt: '2026-09-14T12:00:00.000Z',
      lastSeenAt: today(9, 0),
      relato: null,
      relatadoEm: null,
      caminhosAtivos: null,
      pendencias: null,
    })

    expect(screen.queryByText('Lista de prontidão')).toBeNull()
    expect(screen.queryByText(/Caminho ativo/)).toBeNull()
    expect(screen.queryAllByTestId(/^readiness-step-/)).toHaveLength(0)
  })
})
