import type { BloodPressure, MetricState } from '../domain/telemetry.types'
import { CALIBRATION_VERSION } from '../calibration/calibration-bands'
import { calibrationViewOf, type CalibrationRows } from './calibration-view'
import type { WorkerMetrics } from './telemetry-projector'

// O que se protege: a fase e o dia vêm da linha da calibração, cada faixa
// vem com a zona do valor atual e com a origem do corte em vigor, e faixa
// ilegível some em silêncio em vez de derrubar a leitura.

const state = <T>(value: T | null, unit = ''): MetricState<T> => ({
  value,
  quality: value === null ? 'UNAVAILABLE' : 'CURRENT',
  measuredAt: value === null ? null : '2026-09-03T12:00:00.000Z',
  source: value === null ? null : 'APPLE_WATCH',
  unit,
})

const metrics = (over: Partial<WorkerMetrics> = {}): WorkerMetrics => ({
  heartRate: state<number>(null, 'bpm'),
  steps: state<number>(null, 'steps'),
  movementPerMinute: state<number>(null, 'mpm'),
  activeEnergy: state<number>(null, 'kcal'),
  energyRatePerHour: { ...state<number>(null, 'kcal/h'), calculating: false },
  battery: state<number>(null, '%'),
  bloodPressure: state<BloodPressure>(null, 'mmHg'),
  effort: state<number>(null, '%'),
  wear: state<number>(null, '%'),
  distance: state<number>(null, 'm'),
  oxygenSaturation: state<number>(null, '%'),
  bodyTemperature: state<number>(null, 'C'),
  fatigueEtaMin: state<number>(null, 'min'),
  ...over,
})

const rows = (over: Partial<CalibrationRows> = {}): CalibrationRows => ({
  calibration: { version: CALIBRATION_VERSION, validDays: 10, recalibrating: false },
  bands: [],
  ...over,
})

describe('calibrationViewOf', () => {
  it('sem linha de calibração não há calibração, mesmo com faixa gravada', () => {
    const view = calibrationViewOf(
      metrics(),
      rows({ calibration: null, bands: [{ metric: 'HEART_RATE', learnedCuts: { excellence: 70, fatigue: 140 }, overrideCuts: null }] }),
    )
    expect(view).toBeNull()
  })

  it('enquanto calibra: fase, dia seguinte aos válidos e a versão gravada', () => {
    const view = calibrationViewOf(metrics(), rows({ calibration: { version: 'v-antiga', validDays: 10, recalibrating: true } }))
    expect(view).toEqual({ version: 'v-antiga', phase: 'CALIBRATING', recalibrating: true, day: 11, metrics: {} })
  })

  it('com 30 dias válidos a calibração fechou e o dia some', () => {
    const view = calibrationViewOf(metrics(), rows({ calibration: { version: CALIBRATION_VERSION, validDays: 30, recalibrating: false } }))
    expect(view).toMatchObject({ phase: 'CALIBRATED', day: null })
  })

  it('cada faixa traz a zona do valor atual e de onde veio o corte', () => {
    const view = calibrationViewOf(
      metrics({ heartRate: state(150, 'bpm'), wear: state(20, '%') }),
      rows({
        bands: [
          { metric: 'HEART_RATE', learnedCuts: { excellence: 70, fatigue: 140 }, overrideCuts: null },
          { metric: 'WEAR', learnedCuts: { excellence: 30, fatigue: 72 }, overrideCuts: { excellence: 25, fatigue: 70 } },
        ],
      }),
    )
    expect(view?.metrics).toEqual({
      HEART_RATE: { zone: 'FATIGUE', cuts: { excellence: 70, fatigue: 140 }, source: 'LEARNED' },
      WEAR: { zone: 'EXCELLENCE', cuts: { excellence: 25, fatigue: 70 }, source: 'OVERRIDE' },
    })
  })

  it('sistólica e diastólica saem separadas, cada uma com a própria zona', () => {
    const view = calibrationViewOf(
      metrics({ bloodPressure: state({ systolic: 150, diastolic: 70 }, 'mmHg') }),
      rows({
        bands: [
          { metric: 'SYSTOLIC', learnedCuts: { excellence: 110, fatigue: 140 }, overrideCuts: null },
          { metric: 'DIASTOLIC', learnedCuts: { excellence: 70, fatigue: 90 }, overrideCuts: null },
        ],
      }),
    )
    expect(view?.metrics.SYSTOLIC?.zone).toBe('FATIGUE')
    expect(view?.metrics.DIASTOLIC?.zone).toBe('EXCELLENCE')
  })

  it('oxigenação, temperatura e movimento por minuto ganham zona do valor atual', () => {
    const view = calibrationViewOf(
      metrics({ oxygenSaturation: state(91, '%'), bodyTemperature: state(36.4, 'C'), movementPerMinute: state(80, 'mpm') }),
      rows({
        bands: [
          { metric: 'OXYGEN_SATURATION', learnedCuts: { excellence: 97, fatigue: 92 }, overrideCuts: null },
          { metric: 'BODY_TEMPERATURE', learnedCuts: { p10: 35.8, p25: 36.1, p75: 36.7, p90: 37.1 }, overrideCuts: null },
          { metric: 'MOVEMENT', learnedCuts: { below: 30, above: 55 }, overrideCuts: null },
        ],
      }),
    )
    expect(view?.metrics.OXYGEN_SATURATION?.zone).toBe('FATIGUE')
    expect(view?.metrics.BODY_TEMPERATURE?.zone).toBe('EXCELLENCE')
    expect(view?.metrics.MOVEMENT?.zone).toBe('ABOVE')
  })

  it('os totais do dia não ganham zona: o dia em andamento não se classifica pelo total', () => {
    const view = calibrationViewOf(
      metrics({ steps: state(20000, 'steps'), distance: state(100, 'm'), activeEnergy: state(5000, 'kcal') }),
      rows({
        bands: [
          { metric: 'STEPS', learnedCuts: { below: 6000, above: 11000 }, overrideCuts: null },
          { metric: 'DISTANCE', learnedCuts: { below: 4000, above: 8000 }, overrideCuts: null },
          { metric: 'ACTIVE_ENERGY', learnedCuts: { below: 300, above: 600 }, overrideCuts: null },
        ],
      }),
    )
    expect(view?.metrics).toEqual({
      STEPS: { zone: null, cuts: { below: 6000, above: 11000 }, source: 'LEARNED' },
      DISTANCE: { zone: null, cuts: { below: 4000, above: 8000 }, source: 'LEARNED' },
      ACTIVE_ENERGY: { zone: null, cuts: { below: 300, above: 600 }, source: 'LEARNED' },
    })
  })

  it('sem valor atual a faixa vem com zona nula', () => {
    const view = calibrationViewOf(
      metrics(),
      rows({ bands: [{ metric: 'HEART_RATE', learnedCuts: { excellence: 70, fatigue: 140 }, overrideCuts: null }] }),
    )
    expect(view?.metrics.HEART_RATE).toEqual({ zone: null, cuts: { excellence: 70, fatigue: 140 }, source: 'LEARNED' })
  })

  it('faixa com aprendido ilegível some; correção ilegível cai no aprendido', () => {
    const view = calibrationViewOf(
      metrics({ heartRate: state(150, 'bpm'), wear: state(20, '%') }),
      rows({
        bands: [
          { metric: 'HEART_RATE', learnedCuts: 'x', overrideCuts: { excellence: 70, fatigue: 140 } },
          { metric: 'WEAR', learnedCuts: { excellence: 30, fatigue: 72 }, overrideCuts: { excellence: 'x' } },
        ],
      }),
    )
    expect(view?.metrics).toEqual({ WEAR: { zone: 'EXCELLENCE', cuts: { excellence: 30, fatigue: 72 }, source: 'LEARNED' } })
  })
})
