import type { TelemetryConditionKind } from '@prisma/client'

import { thresholdsOf, type ThresholdRows } from '../calibration/calibration-thresholds'
import { calibratedPressureDecisions, calibratedWatchDecisions, type WatchReadings } from './calibrated-decisions'
import type { EngineSample, Point } from './condition-engine'

// As duas camadas da origem REAL juntas: Atenção pela faixa da pessoa e travas
// pelo padrão ou pelo valor do admin. Os detalhes de cada decisão estão no
// spec do motor; aqui se prova a fiação de cada régua.

const NOW = 1_000_000_000
const MIN = 60_000

const thresholds = (over: Partial<ThresholdRows> = {}) =>
  thresholdsOf({ calibration: null, bands: [], safety: [], maxBpmByAge: 190, ...over })

const beats = (minutes: number, bpm: number): EngineSample[] =>
  Array.from({ length: (minutes * MIN) / 5_000 + 1 }, (_, i) => ({
    atMs: NOW - i * 5_000,
    heartRateBpm: bpm,
    batteryPercent: null,
  }))

/** Avaliações a cada 20 s: o corte é de 15 s e a próxima nasce no lote seguinte. */
const wearSeries = (minutes: number, percent: number): Point[] =>
  Array.from({ length: (minutes * MIN) / 20_000 + 1 }, (_, i) => ({ atMs: NOW - i * 20_000, value: percent }))

const readings = (over: Partial<WatchReadings> = {}): WatchReadings => ({
  samples: [],
  wear: [],
  latestWear: null,
  battery: null,
  maxBpm: 190,
  fallbackRestingBpm: null,
  nowMs: NOW,
  ...over,
})

const none: ReadonlySet<TelemetryConditionKind> = new Set()
const kinds = (decisions: { kind: string; action: string }[]) => decisions.map((d) => `${d.kind}:${d.action}`)

describe('calibratedWatchDecisions: batimento', () => {
  const band = { metric: 'HEART_RATE' as const, learnedCuts: { excellence: 90, fatigue: 130 }, overrideCuts: null }

  it('10 min acima do corte de fadiga abrem a Atenção pela faixa', () => {
    const decisions = calibratedWatchDecisions(readings({ samples: beats(10, 140) }), thresholds({ bands: [band] }), none)

    expect(decisions).toEqual([
      { kind: 'HEART_RATE_FATIGUE', action: 'OPEN', observedValue: 140, threshold: { value: 130, rule: 'BAND' } },
    ])
  })

  it('a trava padrão abre pela máxima por idade com o rastro de trava padrão', () => {
    const decisions = calibratedWatchDecisions(readings({ samples: beats(1, 175) }), thresholds({ bands: [band] }), none)

    // 90% de 190 = 171. Um minuto não basta para a Atenção.
    expect(decisions).toEqual([
      { kind: 'HEART_RATE_HIGH', action: 'OPEN', observedValue: 175, threshold: { value: 171, rule: 'SAFETY_DEFAULT' } },
    ])
  })

  it('a trava do admin vale no lugar da máxima por idade, e recupera pelo número dele', () => {
    const t = thresholds({ safety: [{ rule: 'HEART_RATE_HIGH', values: { openAt: 150, closeAt: 145 } }] })

    expect(calibratedWatchDecisions(readings({ samples: beats(1, 155) }), t, none)).toContainEqual({
      kind: 'HEART_RATE_HIGH',
      action: 'OPEN',
      observedValue: 155,
      threshold: { value: 150, rule: 'SAFETY_CUSTOM' },
    })
    const active = new Set<TelemetryConditionKind>(['HEART_RATE_HIGH'])
    expect(kinds(calibratedWatchDecisions(readings({ samples: beats(1, 144) }), t, active))).toContain('HEART_RATE_HIGH:RECOVER')
  })

  it('o batimento baixo parte do repouso da calibração antes do repouso dos dias fechados', () => {
    const t = thresholds({ calibration: { validDays: 5, restingBpm: 60 } })
    const decisions = calibratedWatchDecisions(readings({ samples: beats(1, 44), fallbackRestingBpm: 70 }), t, none)

    // 60 - 15 = 45; pelo repouso dos dias fechados seria 55.
    expect(decisions).toContainEqual({
      kind: 'HEART_RATE_LOW',
      action: 'OPEN',
      observedValue: 44,
      threshold: { value: 45, rule: 'SAFETY_DEFAULT' },
    })
  })

  it('sem corte de fadiga (sem nascimento e sem faixa), não há Atenção de batimento', () => {
    const t = thresholds({ maxBpmByAge: null })

    expect(kinds(calibratedWatchDecisions(readings({ samples: beats(10, 175), maxBpm: null }), t, none))).toEqual([])
  })
})

describe('calibratedWatchDecisions: desgaste', () => {
  it('85% por 10 min abrem só a Atenção, pelo corte de partida 80', () => {
    const decisions = calibratedWatchDecisions(readings({ wear: wearSeries(10, 85), latestWear: 85 }), thresholds(), none)

    expect(decisions).toEqual([
      { kind: 'WEAR_FATIGUE', action: 'OPEN', observedValue: 85, threshold: { value: 80, rule: 'BAND' } },
    ])
  })

  it('90% abrem a trava, com uma leitura', () => {
    const decisions = calibratedWatchDecisions(readings({ wear: [{ atMs: NOW, value: 90 }], latestWear: 90 }), thresholds(), none)

    expect(decisions).toEqual([
      { kind: 'WEAR_HIGH', action: 'OPEN', observedValue: 90, threshold: { value: 90, rule: 'SAFETY_DEFAULT' } },
    ])
  })

  it('a trava de desgaste do admin vale no lugar do padrão', () => {
    const t = thresholds({ safety: [{ rule: 'WEAR_HIGH', values: { openAt: 85, closeAt: 75 } }] })

    expect(calibratedWatchDecisions(readings({ latestWear: 86 }), t, none)).toEqual([
      { kind: 'WEAR_HIGH', action: 'OPEN', observedValue: 86, threshold: { value: 85, rule: 'SAFETY_CUSTOM' } },
    ])
  })

  it('Atenção ativa fecha com a avaliação de volta à faixa normal', () => {
    const active = new Set<TelemetryConditionKind>(['WEAR_FATIGUE'])
    const decisions = calibratedWatchDecisions(readings({ wear: [{ atMs: NOW, value: 70 }], latestWear: 70 }), thresholds(), active)

    expect(kinds(decisions)).toEqual(['WEAR_FATIGUE:RECOVER'])
  })
})

describe('calibratedWatchDecisions: bateria', () => {
  it('segue a regra de sempre', () => {
    expect(kinds(calibratedWatchDecisions(readings({ battery: 10 }), thresholds(), none))).toEqual(['DEVICE_BATTERY_LOW:OPEN'])
  })
})

describe('calibratedPressureDecisions', () => {
  it('150 por 95 abre só a Atenção, pela partida 140', () => {
    expect(calibratedPressureDecisions({ systolic: 150, diastolic: 95 }, thresholds(), none)).toEqual([
      { kind: 'BLOOD_PRESSURE_FATIGUE', action: 'OPEN', observedValue: 150, threshold: { value: 140, rule: 'BAND' } },
    ])
  })

  it('185 por 112 abre a Atenção e a trava', () => {
    expect(kinds(calibratedPressureDecisions({ systolic: 185, diastolic: 112 }, thresholds(), none))).toEqual([
      'BLOOD_PRESSURE_FATIGUE:OPEN',
      'BLOOD_PRESSURE_HIGH:OPEN',
    ])
  })

  it('a faixa aprendida e a trava do admin valem no lugar das de partida', () => {
    const t = thresholds({
      bands: [{ metric: 'SYSTOLIC', learnedCuts: { excellence: 110, fatigue: 128 }, overrideCuts: null }],
      safety: [
        {
          rule: 'BLOOD_PRESSURE_HIGH',
          values: { systolicAt: 160, diastolicAt: 100, systolicRecoverBelow: 150, diastolicRecoverBelow: 95 },
        },
      ],
    })

    expect(calibratedPressureDecisions({ systolic: 162, diastolic: 80 }, t, none)).toEqual([
      { kind: 'BLOOD_PRESSURE_FATIGUE', action: 'OPEN', observedValue: 162, threshold: { value: 128, rule: 'BAND' } },
      { kind: 'BLOOD_PRESSURE_HIGH', action: 'OPEN', observedValue: 162, threshold: { value: 160, rule: 'SAFETY_CUSTOM' } },
    ])
  })

  it('sem medição não decide nada', () => {
    expect(calibratedPressureDecisions(null, thresholds(), none)).toEqual([])
  })
})
