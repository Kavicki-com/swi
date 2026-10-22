import type { ReadinessColumns } from '../devices/readiness'
import {
  absenceFactsOf,
  absenceOf,
  NOT_SENT_AFTER_MS,
  withAbsence,
  type AbsenceDeviceRow,
  type AbsenceFacts,
  type AbsenceMetric,
} from './metric-absence'

// Bordas da ausência por métrica que a rota não fixa: 24 h exatas, o aparelho
// que não é Android e o caminho não informado. O caminho feliz e a volta a
// valor moram no e2e (test/telemetry-metric-absence.e2e-spec.ts).

const NOW = new Date('2026-10-22T13:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const nenhumaPrimeira: Record<AbsenceMetric, string | null> = {
  heartRate: null,
  steps: null,
  activeEnergy: null,
  oxygenSaturation: null,
  bloodPressure: null,
}

const fatos = (over: Partial<AbsenceFacts> = {}): AbsenceFacts => ({
  deviceKind: 'ANDROID_PHONE',
  activePaths: ['HEALTH_CONNECT'],
  // Batimento chegou há exatamente 24 h; pressão, nunca.
  firstReceivedAt: { ...nenhumaPrimeira, heartRate: ago(NOT_SENT_AFTER_MS) },
  ...over,
})

describe('absenceOf', () => {
  it('24 h exatas depois da primeira sincronização sem nenhuma desta: não envia', () => {
    expect(absenceOf(fatos(), 'bloodPressure', NOW)).toBe('NOT_SENT')
  })

  it('um milissegundo antes das 24 h: aguardando', () => {
    const quaseUmDia = fatos({ firstReceivedAt: { ...nenhumaPrimeira, heartRate: ago(NOT_SENT_AFTER_MS - 1) } })
    expect(absenceOf(quaseUmDia, 'bloodPressure', NOW)).toBe('AWAITING')
  })

  it('a primeira sincronização é a mais antiga entre as métricas que já chegaram', () => {
    const duas = fatos({
      firstReceivedAt: { ...nenhumaPrimeira, heartRate: ago(60_000), steps: ago(NOT_SENT_AFTER_MS) },
    })
    expect(absenceOf(duas, 'bloodPressure', NOW)).toBe('NOT_SENT')
  })

  it('métrica que já chegou alguma vez nunca é não envia: some e volta a aguardando', () => {
    expect(absenceOf(fatos(), 'heartRate', NOW)).toBe('AWAITING')
  })

  it('sem nenhuma sincronização com métrica, aguardando enquanto há caminho', () => {
    expect(absenceOf(fatos({ firstReceivedAt: nenhumaPrimeira }), 'bloodPressure', NOW)).toBe('AWAITING')
  })

  it('pelo Bluetooth também é caminho ativo', () => {
    expect(absenceOf(fatos({ activePaths: ['BLUETOOTH'] }), 'steps', NOW)).toBe('NOT_SENT')
  })

  it.each<[string, AbsenceFacts | null]>([
    ['sem celular', null],
    ['iPhone', fatos({ deviceKind: 'IPHONE' })],
    ['Android sem caminho ativo, mesmo depois das 24 h', fatos({ activePaths: [] })],
  ])('%s: nulo', (_caso, facts) => {
    expect(absenceOf(facts, 'bloodPressure', NOW)).toBeNull()
    expect(absenceOf(facts, 'heartRate', NOW)).toBeNull()
  })
})

describe('withAbsence', () => {
  const vazio = { value: null, quality: 'UNAVAILABLE' as const, measuredAt: null, source: null, unit: 'mmHg' }

  it('métrica com valor não tem ausência, nem quando a regra diria não envia', () => {
    const comValor = { ...vazio, value: 120, quality: 'STALE' as const, measuredAt: ago(1) }
    expect(withAbsence(comValor, fatos(), 'bloodPressure', NOW).ausencia).toBeNull()
  })

  it('métrica sem valor leva a ausência da regra e preserva o resto do estado', () => {
    expect(withAbsence(vazio, fatos(), 'bloodPressure', NOW)).toEqual({ ...vazio, ausencia: 'NOT_SENT' })
  })
})

describe('absenceFactsOf', () => {
  const semRelato: ReadinessColumns = {
    readinessReportedAt: null,
    healthConnectAvailability: null,
    healthConnectReadGranted: null,
    healthConnectBackgroundGranted: null,
    healthConnectPackage: null,
    healthConnectLastSyncAt: null,
    healthConnectFailureReason: null,
    healthConnectFailureAt: null,
    bluetoothBandChosen: null,
    bluetoothListenerState: null,
    bluetoothListenerStateSince: null,
    bluetoothLastReadingAt: null,
  }
  const aparelho = (over: Partial<AbsenceDeviceRow> = {}): AbsenceDeviceRow => ({
    kind: 'ANDROID_PHONE',
    ...semRelato,
    heartRateFirstReceivedAt: null,
    stepsFirstReceivedAt: null,
    activeEnergyFirstReceivedAt: null,
    oxygenSaturationFirstReceivedAt: null,
    bloodPressureFirstReceivedAt: null,
    ...over,
  })

  it('sem celular não há fatos', () => {
    expect(absenceFactsOf(null)).toBeNull()
  })

  it('o caminho ativo sai do relato e as primeiras chegadas viram ISO', () => {
    const facts = absenceFactsOf(
      aparelho({
        readinessReportedAt: NOW,
        healthConnectReadGranted: true,
        healthConnectLastSyncAt: NOW,
        stepsFirstReceivedAt: NOW,
      }),
    )
    expect(facts).toEqual({
      deviceKind: 'ANDROID_PHONE',
      activePaths: ['HEALTH_CONNECT'],
      firstReceivedAt: { ...nenhumaPrimeira, steps: NOW.toISOString() },
    })
  })

  it('sem relato não há caminho ativo', () => {
    expect(absenceFactsOf(aparelho())?.activePaths).toEqual([])
  })

  it('o relato do iPhone não conta: a lista de prontidão não existe nele', () => {
    const iphone = absenceFactsOf(
      aparelho({ kind: 'IPHONE', readinessReportedAt: NOW, healthConnectReadGranted: true, healthConnectLastSyncAt: NOW }),
    )
    expect(iphone?.activePaths).toEqual([])
  })
})
