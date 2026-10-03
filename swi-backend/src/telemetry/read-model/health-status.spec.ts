import { healthStatusOf } from './health-status'
import { projectWorker, type ProjectionCondition, type ProjectionSnapshot } from './telemetry-projector'

// A régua de estado de saúde é a mesma do painel (healthStatus.ts do site) e do
// app: quem decide é a condição aberta, e "bom" exige batimento atual.

const NOW = new Date('2026-10-03T12:00:00.000Z')
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString()

const snapshot = (over: Partial<ProjectionSnapshot> = {}): ProjectionSnapshot => ({
  origin: 'REAL',
  sessionId: 's1',
  heartRateBpm: 88,
  heartRateAt: secondsAgo(5),
  batteryPercent: 70,
  batteryAt: secondsAgo(60),
  systolicMmHg: null,
  diastolicMmHg: null,
  bloodPressureSource: null,
  bloodPressureAt: null,
  oxygenSaturationPct: null,
  oxygenSaturationAt: null,
  bodyTemperatureC: null,
  bodyTemperatureSource: null,
  bodyTemperatureAt: null,
  ...over,
})

const condition = (kind: ProjectionCondition['kind']): ProjectionCondition => ({
  kind,
  origin: 'REAL',
  firstSeenAt: secondsAgo(120),
  observedValue: null,
  thresholdValue: null,
})

const telemetry = (snap: ProjectionSnapshot | null, conditions: ProjectionCondition[] = []) =>
  projectWorker(
    {
      workerId: 'w1',
      snapshot: snap,
      windowSamples: [],
      dayTotals: { steps: null, activeEnergy: null, distance: null },
      assessment: null,
      conditions,
    },
    NOW,
  )

describe('healthStatusOf', () => {
  it('quem nunca reportou fica sem estado', () => {
    expect(healthStatusOf(telemetry(null))).toBe('unknown')
  })

  it('batimento atual e nenhuma condição aberta é bom', () => {
    expect(healthStatusOf(telemetry(snapshot()))).toBe('good')
  })

  it('batimento velho não confirma que a pessoa está bem', () => {
    expect(healthStatusOf(telemetry(snapshot({ heartRateAt: secondsAgo(6 * 60 * 60) })))).toBe('unknown')
  })

  it('condição urgente aberta é crítico, mesmo com a leitura velha', () => {
    const lido = telemetry(snapshot({ heartRateAt: secondsAgo(6 * 60 * 60) }), [condition('HEART_RATE_HIGH')])
    expect(healthStatusOf(lido)).toBe('low')
  })

  it('condição de saúde aberta é alerta', () => {
    expect(healthStatusOf(telemetry(snapshot(), [condition('WEAR_HIGH')]))).toBe('alert')
  })

  it('urgência vence saúde', () => {
    const lido = telemetry(snapshot(), [condition('WEAR_HIGH'), condition('HEART_RATE_HIGH')])
    expect(healthStatusOf(lido)).toBe('low')
  })

  it('condição só de aparelho não muda o estado da pessoa', () => {
    expect(healthStatusOf(telemetry(snapshot(), [condition('DEVICE_BATTERY_LOW')]))).toBe('good')
  })
})
