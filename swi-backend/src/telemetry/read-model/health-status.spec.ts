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

  it('condição urgente aberta com o batimento velho fica neutra: a cor não afirma o agora', () => {
    const lido = telemetry(snapshot({ heartRateAt: secondsAgo(6 * 60 * 60) }), [condition('HEART_RATE_HIGH')])
    expect(healthStatusOf(lido)).toBe('unknown')
  })

  it('condição urgente aberta com batimento atual é crítico', () => {
    expect(healthStatusOf(telemetry(snapshot(), [condition('HEART_RATE_HIGH')]))).toBe('low')
  })

  it('condição de saúde aberta é alerta', () => {
    expect(healthStatusOf(telemetry(snapshot(), [condition('WEAR_FATIGUE')]))).toBe('alert')
  })

  it('urgência vence saúde', () => {
    const lido = telemetry(snapshot(), [condition('WEAR_FATIGUE'), condition('HEART_RATE_HIGH')])
    expect(healthStatusOf(lido)).toBe('low')
  })

  describe('batimento válido', () => {
    it('ao vivo vale até 45 s', () => {
      expect(healthStatusOf(telemetry(snapshot({ heartRateAt: secondsAgo(45) })))).toBe('good')
      expect(healthStatusOf(telemetry(snapshot({ heartRateAt: secondsAgo(46) })))).toBe('unknown')
    })

    it('pelo Health Connect vale até 60 min contados do instante medido', () => {
      const hc = (seconds: number) =>
        telemetry(snapshot({ heartRateAt: secondsAgo(seconds), heartRateSource: 'HEALTH_CONNECT' }))
      expect(healthStatusOf(hc(60 * 60))).toBe('good')
      expect(healthStatusOf(hc(60 * 60 + 1))).toBe('unknown')
    })

    it('pelo Bluetooth é ao vivo: parado há 50 min não vale', () => {
      const bt = telemetry(snapshot({ heartRateAt: secondsAgo(50 * 60), heartRateSource: 'BLUETOOTH_HR' }))
      expect(healthStatusOf(bt)).toBe('unknown')
    })

    it('sem fonte gravada (snapshot anterior à coluna) só vale ao vivo', () => {
      const legado = telemetry(snapshot({ heartRateAt: secondsAgo(10 * 60), heartRateSource: null }))
      expect(healthStatusOf(legado)).toBe('unknown')
    })

    it('com batimento do Health Connect de 30 min, condição de batimento pinta', () => {
      const hc = snapshot({ heartRateAt: secondsAgo(30 * 60), heartRateSource: 'HEALTH_CONNECT' })
      expect(healthStatusOf(telemetry(hc, [condition('HEART_RATE_HIGH')]))).toBe('low')
    })
  })

  describe('condição só pinta enquanto o dado que a sustenta vale', () => {
    const HOUR_S = 60 * 60
    const oxygen = (seconds: number) => snapshot({ oxygenSaturationPct: 88, oxygenSaturationAt: secondsAgo(seconds) })
    const pressure = (seconds: number) =>
      snapshot({
        systolicMmHg: 165,
        diastolicMmHg: 100,
        bloodPressureSource: 'EXTERNAL_CUFF',
        bloodPressureAt: secondsAgo(seconds),
      })

    it('oxigenação pinta até 12 h depois da medição', () => {
      expect(healthStatusOf(telemetry(oxygen(12 * HOUR_S), [condition('OXYGEN_LOW')]))).toBe('low')
      expect(healthStatusOf(telemetry(oxygen(12 * HOUR_S + 1), [condition('OXYGEN_LOW')]))).toBe('good')
      expect(healthStatusOf(telemetry(oxygen(12 * HOUR_S + 1), [condition('OXYGEN_FATIGUE')]))).toBe('good')
    })

    it('pressão pinta até 6 h depois da medição', () => {
      expect(healthStatusOf(telemetry(pressure(6 * HOUR_S), [condition('BLOOD_PRESSURE_HIGH')]))).toBe('low')
      expect(healthStatusOf(telemetry(pressure(6 * HOUR_S + 1), [condition('BLOOD_PRESSURE_HIGH')]))).toBe('good')
      expect(healthStatusOf(telemetry(pressure(6 * HOUR_S + 1), [condition('BLOOD_PRESSURE_FATIGUE')]))).toBe('good')
      expect(healthStatusOf(telemetry(pressure(6 * HOUR_S + 1), [condition('BLOOD_PRESSURE_REVIEW')]))).toBe('good')
    })

    it('a condição vencida não tira a cor de outra ainda vigente', () => {
      const lido = telemetry(oxygen(13 * HOUR_S), [condition('OXYGEN_LOW'), condition('WEAR_FATIGUE')])
      expect(healthStatusOf(lido)).toBe('alert')
    })

    it('a condição aberta continua na leitura, com o instante da medição que a sustenta', () => {
      const lido = telemetry(oxygen(13 * HOUR_S), [condition('OXYGEN_LOW')])
      expect(lido.conditions).toEqual([
        expect.objectContaining({ kind: 'OXYGEN_LOW', measuredAt: secondsAgo(13 * HOUR_S) }),
      ])
    })
  })

  it('condição só de aparelho não muda o estado da pessoa', () => {
    expect(healthStatusOf(telemetry(snapshot(), [condition('DEVICE_BATTERY_LOW')]))).toBe('good')
  })
})
