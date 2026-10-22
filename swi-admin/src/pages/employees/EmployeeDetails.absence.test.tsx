// Rótulos de ausência no perfil do funcionário: o backend decide, por métrica,
// se ela está aguardando ou se a pulseira não a envia, e o painel diz o mesmo
// que o app. O cartão nunca some por ausência, e "Sem medição" não aparece.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { EmployeeDetails } from './EmployeeDetails'
import { clearSession, renderPage } from '@/test-utils/renderPage'
import { employeesApi } from '@/services/api/users'
import { telemetryApi, type MetricAbsence } from '@/services/api/telemetry'
import { noMetric, reporting, series } from '@/test-utils/telemetryFixtures'

vi.mock('@/services/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/users')>()
  return { ...actual, employeesApi: { ...actual.employeesApi, get: vi.fn() } }
})
vi.mock('@/services/api/notifications', () => ({
  notificationsApi: { requestPause: vi.fn() },
}))
vi.mock('@/services/api/telemetryDevices', () => ({
  telemetryDevicesApi: {
    stateOf: vi.fn().mockResolvedValue({
      data: {
        device: {
          id: 'device-1',
          kind: 'ANDROID_PHONE',
          model: 'Galaxy A54',
          pairedAt: '2026-09-14T12:00:00.000Z',
          lastSeenAt: '2026-09-14T15:30:00.000Z',
        },
        pendingEnrollment: null,
      },
      error: null,
    }),
    createEnrollment: vi.fn(),
    revoke: vi.fn(),
  },
}))
vi.mock('@/services/api/telemetry', () => ({
  telemetryApi: {
    workerCurrent: vi.fn(),
    workerSeries: vi.fn(),
    workerConditions: vi
      .fn()
      .mockResolvedValue({ data: { items: [], nextCursor: null }, error: null }),
  },
}))
vi.mock('@/services/telemetry/telemetrySocket', () => ({
  subscribeTelemetryEvents: vi.fn(() => () => {}),
}))
vi.mock('@/hooks/useLivePositions', () => ({ useLivePositions: () => null }))

const getMock = vi.mocked(employeesApi.get)
const currentMock = vi.mocked(telemetryApi.workerCurrent)
const seriesMock = vi.mocked(telemetryApi.workerSeries)

const EMPLOYEE = {
  id: 'w1',
  name: 'Worker Um',
  role: 'Operador',
  specialization: 'Norte',
  sector: 'Norte',
  age: 30,
  bloodType: 'O+',
  vitalsStatus: 'good',
  avatarUri: undefined,
} as never

/**
 * Leitura de quem tem caminho ativo mas nenhum valor das cinco métricas que
 * levam ausência. `ausencia` undefined imita o backend anterior, sem o campo.
 */
const absentReading = (ausencia: MetricAbsence | null | undefined) => {
  const absent = <T,>(unit: string) =>
    ausencia === undefined ? noMetric<T>(unit) : { ...noMetric<T>(unit), ausencia }
  return reporting({
    heartRate: absent('bpm'),
    steps: absent('steps'),
    activeEnergy: absent('kcal'),
    energyRatePerHour: { ...absent<number>('kcal/h'), calculating: false },
    oxygenSaturation: absent('%'),
    bloodPressure: absent('mmHg'),
  })
}

async function openProfile(ausencia: MetricAbsence | null | undefined) {
  getMock.mockResolvedValue({ data: EMPLOYEE, error: null } as never)
  currentMock.mockResolvedValue({ data: absentReading(ausencia), error: null })
  seriesMock.mockResolvedValue({ data: series([], { period: 'day' }), error: null })
  await renderPage(<EmployeeDetails />, { route: '/employees/w1', path: '/employees/:id' })
  await screen.findByTestId('measurement-oxygen')
  await screen.findByTestId('calories-empty')
}

const vitals = () => screen.getByTestId('vitals-card')
const oxygen = () => screen.getByTestId('measurement-oxygen')
const steps = () => screen.getByTestId('measurement-steps')
const calories = () => screen.getByTestId('calories-empty')

afterEach(() => {
  clearSession()
  vi.clearAllMocks()
})

describe('EmployeeDetails: rótulos de ausência', () => {
  it('aguardando: leitura para batimento, passos e energia; medição para pressão e oxigenação', async () => {
    await openProfile('AWAITING')

    const card = within(vitals())
    expect(card.getByTestId('vitals-heart-rate')).toHaveTextContent('Aguardando leitura')
    expect(card.getByTestId('vitals-pressure')).toHaveTextContent('Aguardando medição')
    expect(oxygen()).toHaveTextContent('Aguardando medição')
    expect(steps()).toHaveTextContent('Aguardando leitura')
    await waitFor(() => expect(calories()).toHaveTextContent('Aguardando leitura'))
  })

  it('não envia: "Esta pulseira não envia <métrica>", com o cartão na tela', async () => {
    await openProfile('NOT_SENT')

    const card = within(vitals())
    expect(card.getByTestId('vitals-heart-rate')).toHaveTextContent(
      'Esta pulseira não envia batimento',
    )
    expect(card.getByTestId('vitals-pressure')).toHaveTextContent('Esta pulseira não envia pressão')
    expect(oxygen()).toHaveTextContent('Oxigenação')
    expect(oxygen()).toHaveTextContent('Esta pulseira não envia oxigenação')
    expect(steps()).toHaveTextContent('Passos')
    expect(steps()).toHaveTextContent('Esta pulseira não envia passos')
    expect(screen.getByText('Gasto calórico')).toBeInTheDocument()
    await waitFor(() => expect(calories()).toHaveTextContent('Esta pulseira não envia energia'))
  })

  // Sem caminho ativo, no iPhone ou com o backend anterior: o painel mantém o
  // traço de sem dado, sem rótulo de ausência.
  it.each([
    ['nula', null],
    ['ausente no backend anterior', undefined],
  ] as const)('ausência %s mantém o traço de sem dado', async (_, ausencia) => {
    await openProfile(ausencia)

    const card = within(vitals())
    expect(card.getByTestId('vitals-heart-rate')).toHaveTextContent(/^--\s*bpm$/)
    expect(card.getByTestId('vitals-pressure')).toHaveTextContent(/^--$/)
    expect(screen.queryByText(/Aguardando|não envia/)).not.toBeInTheDocument()
    await waitFor(() => expect(calories()).toHaveTextContent('Nenhuma leitura neste período'))
  })

  it.each([['AWAITING'], ['NOT_SENT'], [null]] as const)(
    '"Sem medição" não aparece (ausência %s)',
    async (ausencia) => {
      await openProfile(ausencia)

      await waitFor(() => expect(calories()).not.toHaveTextContent('Carregando'))
      expect(document.body).not.toHaveTextContent(/sem medição/i)
    },
  )
})
