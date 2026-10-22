import type { BloodPressure, MetricState } from '../domain/telemetry.types'
import { CALIBRATION_VERSION } from '../calibration/calibration-bands'
import { calibrationViewOf, type CalibrationRows } from './calibration-view'
import type { WorkerMetrics } from './telemetry-projector'

// O que se protege: a fase e o dia vêm da linha da calibração (sem ela, a
// partida no dia 1), cada faixa vem com a zona do valor atual e com a origem
// do corte em vigor, e faixa ilegível cai na partida em vez de derrubar a
// leitura.

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
  it('sem linha de calibração devolve a partida, dia 1 de 30', () => {
    const view = calibrationViewOf(metrics({ heartRate: state(170, 'bpm') }), { calibration: null, bands: [] }, 180)
    expect(view).toMatchObject({ version: CALIBRATION_VERSION, phase: 'CALIBRATING', recalibrating: false, day: 1 })
    expect(view.metrics.HEART_RATE).toEqual({ zone: 'FATIGUE', cuts: { excellence: 108, fatigue: 162 }, source: 'START' })
    expect(view.metrics.STEPS).toBeUndefined()
  })

  it('a partida cobre as sete medições de estado e nenhuma de atividade', () => {
    const view = calibrationViewOf(metrics(), { calibration: null, bands: [] }, null)
    expect(Object.keys(view.metrics).sort()).toEqual(
      ['BODY_TEMPERATURE', 'DIASTOLIC', 'EFFORT', 'HEART_RATE', 'OXYGEN_SATURATION', 'SYSTOLIC', 'WEAR'],
    )
    expect(Object.values(view.metrics).every((m) => m.source === 'START' && m.zone === null)).toBe(true)
  })

  it('a partida do batimento segue a máxima por idade', () => {
    expect(calibrationViewOf(metrics(), { calibration: null, bands: [] }, 190).metrics.HEART_RATE?.cuts).toEqual({
      excellence: 114,
      fatigue: 171,
    })
  })

  it('faixa ausente numa calibração gravada cai na partida', () => {
    const rows = { calibration: { version: CALIBRATION_VERSION, validDays: 4, recalibrating: false }, bands: [] }
    expect(calibrationViewOf(metrics(), rows, null).metrics.OXYGEN_SATURATION?.source).toBe('START')
  })

  it('a correção do gestor gravada antes do primeiro recálculo vale por cima da partida', () => {
    const view = calibrationViewOf(
      metrics(),
      rows({
        calibration: null,
        bands: [{ metric: 'SYSTOLIC', learnedCuts: { excellence: 120, fatigue: 140 }, overrideCuts: { excellence: 110, fatigue: 135 } }],
      }),
      null,
    )
    expect(view.day).toBe(1)
    expect(view.metrics.SYSTOLIC).toEqual({ zone: null, cuts: { excellence: 110, fatigue: 135 }, source: 'OVERRIDE' })
  })

  it('enquanto calibra: fase, dia seguinte aos válidos e a versão gravada', () => {
    const view = calibrationViewOf(metrics(), rows({ calibration: { version: 'v-antiga', validDays: 10, recalibrating: true } }), null)
    expect(view).toMatchObject({ version: 'v-antiga', phase: 'CALIBRATING', recalibrating: true, day: 11 })
  })

  it('com 30 dias válidos a calibração fechou e o dia some', () => {
    const view = calibrationViewOf(
      metrics(),
      rows({ calibration: { version: CALIBRATION_VERSION, validDays: 30, recalibrating: false } }),
      null,
    )
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
      null,
    )
    expect(view.metrics).toMatchObject({
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
      null,
    )
    expect(view.metrics.SYSTOLIC?.zone).toBe('FATIGUE')
    expect(view.metrics.DIASTOLIC?.zone).toBe('EXCELLENCE')
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
      null,
    )
    expect(view.metrics.OXYGEN_SATURATION?.zone).toBe('FATIGUE')
    expect(view.metrics.BODY_TEMPERATURE?.zone).toBe('EXCELLENCE')
    expect(view.metrics.MOVEMENT?.zone).toBe('ABOVE')
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
      null,
    )
    expect(view.metrics).toMatchObject({
      STEPS: { zone: null, cuts: { below: 6000, above: 11000 }, source: 'LEARNED' },
      DISTANCE: { zone: null, cuts: { below: 4000, above: 8000 }, source: 'LEARNED' },
      ACTIVE_ENERGY: { zone: null, cuts: { below: 300, above: 600 }, source: 'LEARNED' },
    })
  })

  it('sem valor atual a faixa vem com zona nula', () => {
    const view = calibrationViewOf(
      metrics(),
      rows({ bands: [{ metric: 'HEART_RATE', learnedCuts: { excellence: 70, fatigue: 140 }, overrideCuts: null }] }),
      null,
    )
    expect(view.metrics.HEART_RATE).toEqual({ zone: null, cuts: { excellence: 70, fatigue: 140 }, source: 'LEARNED' })
  })

  it('aprendido ilegível cai na partida, sem a correção; correção ilegível cai no aprendido', () => {
    const view = calibrationViewOf(
      metrics({ heartRate: state(150, 'bpm'), wear: state(20, '%') }),
      rows({
        bands: [
          { metric: 'HEART_RATE', learnedCuts: 'x', overrideCuts: { excellence: 70, fatigue: 140 } },
          { metric: 'WEAR', learnedCuts: { excellence: 30, fatigue: 72 }, overrideCuts: { excellence: 'x' } },
        ],
      }),
      null,
    )
    // Como no motor de condições: sem aprendido legível vale a partida inteira.
    expect(view.metrics.HEART_RATE).toEqual({ zone: 'NORMAL', cuts: { excellence: 108, fatigue: 162 }, source: 'START' })
    expect(view.metrics.WEAR).toEqual({ zone: 'EXCELLENCE', cuts: { excellence: 30, fatigue: 72 }, source: 'LEARNED' })
  })
})
