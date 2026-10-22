// describe/it/expect vêm dos globals do Vitest.
import {
  FIXTURE_NOW,
  condition,
  metric,
  neverReported,
  reporting,
} from '@/test-utils/telemetryFixtures'
import { healthStatusFrom } from './healthStatus'

const MIN = 60_000
const HOUR = 60 * MIN
// Instante tantos ms antes do observedAt da leitura.
const ago = (ms: number) => new Date(Date.parse(FIXTURE_NOW) - ms).toISOString()

const STALE = metric(98, { quality: 'STALE', measuredAt: ago(80 * MIN) })
const healthConnect = (ageMs: number) =>
  metric(98, { quality: 'STALE', source: 'HEALTH_CONNECT', measuredAt: ago(ageMs) })

describe('healthStatusFrom', () => {
  it('batimento atual sem condição é bom', () => {
    expect(healthStatusFrom(reporting())).toBe('good')
  })

  it('condição urgente aberta é urgência', () => {
    const t = { ...reporting(), conditions: [condition('HEALTH'), condition('URGENT')] }
    expect(healthStatusFrom(t)).toBe('low')
  })

  it('condição de saúde sem urgência é risco', () => {
    expect(healthStatusFrom({ ...reporting(), conditions: [condition('HEALTH')] })).toBe('alert')
  })

  // Relógio descarregado não é pessoa em risco.
  it('condição só de aparelho não muda o estado', () => {
    expect(healthStatusFrom({ ...reporting(), conditions: [condition('DEVICE')] })).toBe('good')
  })

  it('sem telemetria, sem batimento ou com batimento velho é neutro', () => {
    expect(healthStatusFrom(null)).toBe('unknown')
    expect(healthStatusFrom(neverReported())).toBe('unknown')
    expect(healthStatusFrom(reporting({ heartRate: STALE }))).toBe('unknown')
  })

  // A cor não afirma o agora com dado velho; a condição segue em Alertas.
  it('condição urgente sem batimento válido fica neutra', () => {
    const t = { ...reporting({ heartRate: STALE }), conditions: [condition('URGENT')] }
    expect(healthStatusFrom(t)).toBe('unknown')
  })
})

describe('healthStatusFrom: batimento válido', () => {
  // O "atual" (até 45 s) quem decide é o backend, na qualidade da métrica.
  it('Apple Watch e Bluetooth só valem atuais', () => {
    for (const source of ['APPLE_WATCH', 'BLUETOOTH_HR'] as const) {
      const current = metric(80, { source, measuredAt: ago(45_000) })
      const stale = metric(80, { source, quality: 'STALE', measuredAt: ago(46_000) })
      expect(healthStatusFrom(reporting({ heartRate: current }))).toBe('good')
      expect(healthStatusFrom(reporting({ heartRate: stale }))).toBe('unknown')
    }
  })

  it('Health Connect vale até 60 min contados da medição', () => {
    expect(healthStatusFrom(reporting({ heartRate: healthConnect(50 * MIN) }))).toBe('good')
    expect(healthStatusFrom(reporting({ heartRate: healthConnect(HOUR) }))).toBe('good')
    expect(healthStatusFrom(reporting({ heartRate: healthConnect(HOUR + 1) }))).toBe('unknown')
  })

  it('Health Connect válido pinta a condição do batimento', () => {
    const t = {
      ...reporting({ heartRate: healthConnect(50 * MIN) }),
      conditions: [condition('URGENT')],
    }
    expect(healthStatusFrom(t)).toBe('low')
  })

  it('batimento sem valor ou sem instante não vale', () => {
    const noValue = metric<number>(0, {
      value: null,
      source: 'HEALTH_CONNECT',
      measuredAt: ago(MIN),
    })
    const noInstant = metric(80, { source: 'HEALTH_CONNECT', quality: 'STALE', measuredAt: null })
    expect(healthStatusFrom(reporting({ heartRate: noValue }))).toBe('unknown')
    expect(healthStatusFrom(reporting({ heartRate: noInstant }))).toBe('unknown')
  })
})

describe('healthStatusFrom: condição vigente', () => {
  const withCondition = (c: ReturnType<typeof condition>) => ({ ...reporting(), conditions: [c] })

  it('batimento e desgaste pintam junto com o batimento, sem prazo próprio', () => {
    const wear = condition('URGENT', { kind: 'WEAR_HIGH', measuredAt: ago(30 * HOUR) })
    const fatigue = condition('HEALTH', { kind: 'HEART_RATE_FATIGUE', measuredAt: null })
    expect(healthStatusFrom(withCondition(wear))).toBe('low')
    expect(healthStatusFrom(withCondition(fatigue))).toBe('alert')
  })

  it('pressão pinta por 6 h contadas da medição', () => {
    const at = (ms: number) =>
      condition('URGENT', { kind: 'BLOOD_PRESSURE_HIGH', measuredAt: ago(ms) })
    expect(healthStatusFrom(withCondition(at(6 * HOUR)))).toBe('low')
    expect(healthStatusFrom(withCondition(at(6 * HOUR + 1)))).toBe('good')
  })

  it('revisar pressão e pressão na faixa de fadiga seguem o mesmo prazo', () => {
    for (const kind of ['BLOOD_PRESSURE_REVIEW', 'BLOOD_PRESSURE_FATIGUE'] as const) {
      const fresh = condition('HEALTH', { kind, measuredAt: ago(5 * HOUR) })
      const old = condition('HEALTH', { kind, measuredAt: ago(7 * HOUR) })
      expect(healthStatusFrom(withCondition(fresh))).toBe('alert')
      expect(healthStatusFrom(withCondition(old))).toBe('good')
    }
  })

  it('oxigenação pinta por 12 h contadas da medição', () => {
    const at = (ms: number) => condition('URGENT', { kind: 'OXYGEN_LOW', measuredAt: ago(ms) })
    expect(healthStatusFrom(withCondition(at(12 * HOUR)))).toBe('low')
    expect(healthStatusFrom(withCondition(at(12 * HOUR + 1)))).toBe('good')
    const fatigue = condition('HEALTH', { kind: 'OXYGEN_FATIGUE', measuredAt: ago(13 * HOUR) })
    expect(healthStatusFrom(withCondition(fatigue))).toBe('good')
  })

  // A pressão de 165 medida uma vez não pinta o dia seguinte inteiro.
  it('medição avulsa vencida não pinta, e a condição que ainda vale decide', () => {
    const t = {
      ...reporting(),
      conditions: [
        condition('URGENT', { kind: 'BLOOD_PRESSURE_HIGH', measuredAt: ago(26 * HOUR) }),
        condition('HEALTH'),
      ],
    }
    expect(healthStatusFrom(t)).toBe('alert')
  })

  // Backend anterior manda a condição sem o instante da medição.
  it('medição avulsa sem instante não pinta', () => {
    const noInstant = condition('URGENT', { kind: 'OXYGEN_LOW', measuredAt: null })
    const absent = condition('URGENT', { kind: 'BLOOD_PRESSURE_HIGH' })
    expect(healthStatusFrom(withCondition(noInstant))).toBe('good')
    expect(healthStatusFrom(withCondition(absent))).toBe('good')
  })
})
