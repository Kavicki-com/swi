import type { CalibrationDeviceFamily } from '@prisma/client'
import { startCuts, type CalibrationDay } from './calibration-bands'
import { day } from './fixtures/days'
import { recalculate, type StoredCalibration } from './recalculate'

const HOUR = 60 * 60 * 1000
const at = (n: number) => new Date(Date.UTC(2026, 9, n))

/** `count` dias seguidos, o mais recente em `last`, mais recente primeiro. */
const series = (count: number, over: Partial<CalibrationDay> = {}, family: CalibrationDeviceFamily = 'WATCH', last = 30) =>
  Array.from({ length: count }, (_, i) => day({ day: at(last - i), deviceFamily: family, ...over }))

const MAX_35_YEARS = 183.5

const stored = (over: Partial<StoredCalibration> = {}): StoredCalibration => ({
  deviceFamily: 'WATCH',
  phaseStartedAt: at(1),
  recalibrating: false,
  peakBpm: 170,
  peakStartBpm: MAX_35_YEARS,
  bands: {},
  ...over,
})

describe('recalculate', () => {
  it('sem calibração e sem dia com família, não há nada a gravar', () => {
    expect(recalculate({ previous: null, days: [], maxBpmByAge: MAX_35_YEARS })).toBeNull()
    const noHeartRate = day({ deviceFamily: null, heartRateP25: null, heartRateP90: null, heartRateCoveredMs: 0 })
    expect(recalculate({ previous: null, days: [noHeartRate], maxBpmByAge: MAX_35_YEARS })).toBeNull()
  })

  it('a família é a do dia válido de batimento mais recente', () => {
    const days = [day({ day: at(30), deviceFamily: 'BAND', heartRateCoveredMs: HOUR }), ...series(5, {}, 'WATCH', 29)]
    expect(recalculate({ previous: null, days, maxBpmByAge: MAX_35_YEARS })!.deviceFamily).toBe('WATCH')
  })

  it('sem dia válido de batimento, a família do dia mais recente que tem uma', () => {
    const days = series(3, { heartRateCoveredMs: HOUR }, 'BAND')
    const out = recalculate({ previous: null, days, maxBpmByAge: MAX_35_YEARS })!
    expect(out.deviceFamily).toBe('BAND')
    expect(out.validDays).toBe(0)
  })

  it('primeira calibração: fase no começo do trecho mais recente da família, partida mínima', () => {
    const days = [...series(5, {}, 'WATCH', 30), ...series(5, {}, 'BAND', 25)]
    const out = recalculate({ previous: null, days, maxBpmByAge: MAX_35_YEARS })!
    expect(out.phaseStartedAt).toEqual(at(26))
    expect(out.recalibrating).toBe(false)
    expect(out.deviceChanged).toBe(false)
    expect(out.validDays).toBe(5)
    expect(out.peakStartBpm).toBe(MAX_35_YEARS)
    expect(out.bands.HEART_RATE.start).toEqual(startCuts('HEART_RATE', MAX_35_YEARS))
    expect(out.bands.WEAR.start).toEqual({ excellence: 40, fatigue: 80 })
  })

  it('dia sem família não interrompe o trecho e conta para a pressão', () => {
    const pressureOnly = day({
      day: at(28),
      deviceFamily: null,
      heartRateCoveredMs: 0,
      heartRateP25: null,
      heartRateP90: null,
      bloodPressureCount: 1,
      systolicAvg: 125,
      diastolicAvg: 82,
    })
    const days = [...series(2, {}, 'WATCH', 30), pressureOnly, ...series(2, {}, 'WATCH', 27)]
    const out = recalculate({ previous: null, days, maxBpmByAge: MAX_35_YEARS })!
    expect(out.phaseStartedAt).toEqual(at(26))
    expect(out.validDays).toBe(4)
    expect(out.bands.SYSTOLIC.validDays).toBe(1)
  })

  it('cada medição conta os próprios dias válidos', () => {
    const oxy = { oxygenSaturationP10: 95, oxygenSaturationP50: 97, oxygenSaturationCount: 4 }
    const days = [...series(3, oxy), ...series(7, {}, 'WATCH', 27)]
    const out = recalculate({ previous: null, days, maxBpmByAge: MAX_35_YEARS })!
    expect(out.validDays).toBe(10)
    expect(out.bands.OXYGEN_SATURATION.validDays).toBe(3)
    // 3º dia válido da oxigenação: 3/30 do pessoal (97 e 95) com 27/30 da partida (95 e 92).
    expect(out.bands.OXYGEN_SATURATION.learned.excellence).toBeCloseTo(95.2)
    expect(out.bands.OXYGEN_SATURATION.learned.fatigue).toBeCloseTo(92.3)
  })

  it('é o exemplo aprovado pelo cliente: 35 anos e pessoal 128 dão 153, 140 e 128', () => {
    const fatigueAt = (n: number) =>
      recalculate({ previous: null, days: series(n, { heartRateP90: 128 }), maxBpmByAge: MAX_35_YEARS })!.bands.HEART_RATE.learned
        .fatigue!
    expect(Math.round(fatigueAt(10))).toBe(153)
    expect(Math.round(fatigueAt(20))).toBe(140)
    expect(fatigueAt(30)).toBe(128)
  })

  it('sem data de nascimento, o batimento parte da máxima de 180 e o pico só vem do 3º dia válido', () => {
    const two = recalculate({ previous: null, days: series(2, { heartRateP90: 128 }), maxBpmByAge: null })!
    expect(two.bands.HEART_RATE.learned.fatigue).toBe(162)
    expect(two.peakBpm).toBeNull()
    const three = recalculate({ previous: null, days: series(3, { heartRateP90: 128 }), maxBpmByAge: null })!
    expect(three.bands.HEART_RATE.learned.fatigue).toBeCloseTo(0.1 * 128 + 0.9 * 162)
    expect(three.peakBpm).toBe(150)
  })

  it('repouso pela mediana dos mínimos e pico pelo p95 dos máximos da janela', () => {
    const days = [58, 60, 62].map((min, i) => day({ day: at(30 - i), heartRateMin: min, heartRateMax: 140 + i * 10 }))
    const out = recalculate({ previous: null, days, maxBpmByAge: MAX_35_YEARS })!
    expect(out.restingBpm).toBe(60)
    expect(out.peakPersonalBpm).toBe(160)
    // 3º dia válido: 3/30 do pessoal com 27/30 da máxima por idade.
    expect(out.peakBpm).toBeCloseTo(0.1 * 160 + 0.9 * MAX_35_YEARS)
  })

  it('sem dia válido de batimento, repouso e pico pessoal nulos', () => {
    const out = recalculate({ previous: null, days: series(2, { heartRateCoveredMs: HOUR }), maxBpmByAge: MAX_35_YEARS })!
    expect(out.restingBpm).toBeNull()
    expect(out.peakPersonalBpm).toBeNull()
    expect(out.peakBpm).toBe(MAX_35_YEARS)
  })

  it('a janela é dos 30 dias válidos mais recentes', () => {
    const days = [...series(30, { heartRateP90: 128 }), ...series(10, { heartRateP90: 999 }, 'WATCH', 0)]
    const out = recalculate({ previous: null, days, maxBpmByAge: MAX_35_YEARS })!
    expect(out.validDays).toBe(40)
    expect(out.bands.HEART_RATE.learned.fatigue).toBe(128)
  })

  it('mesma família: mantém fase e recalibração, e parte do aprendido anterior', () => {
    const previous = stored({
      phaseStartedAt: at(1),
      bands: { HEART_RATE: { validDays: 30, start: { excellence: null, fatigue: 165.15 }, learned: { excellence: 75, fatigue: 128 } } },
    })
    const out = recalculate({ previous, days: series(30, { heartRateP90: 200 }), maxBpmByAge: MAX_35_YEARS })!
    expect(out.phaseStartedAt).toEqual(at(1))
    expect(out.deviceChanged).toBe(false)
    // Depois de 30 dias, o p90 muito mais alto move a fadiga só 0,5%.
    expect(out.bands.HEART_RATE.learned.fatigue).toBeCloseTo(128 * 1.005)
  })

  it('mesma família numa fase de recalibração: as partidas guardadas valem', () => {
    const previous = stored({
      deviceFamily: 'BAND',
      recalibrating: true,
      phaseStartedAt: at(21),
      peakStartBpm: 172,
      bands: { HEART_RATE: { validDays: 9, start: { excellence: 70, fatigue: 130 }, learned: { excellence: 72, fatigue: 131 } } },
    })
    const out = recalculate({ previous, days: series(10, { heartRateP90: 140 }, 'BAND'), maxBpmByAge: MAX_35_YEARS })!
    expect(out.recalibrating).toBe(true)
    expect(out.phaseStartedAt).toEqual(at(21))
    expect(out.bands.HEART_RATE.start).toEqual({ excellence: 70, fatigue: 130 })
    expect(out.bands.HEART_RATE.learned.fatigue).toBeCloseTo((10 / 30) * 140 + (20 / 30) * 130)
    expect(out.peakStartBpm).toBe(172)
    // Medição sem linha guardada parte da partida mínima.
    expect(out.bands.WEAR.start).toEqual({ excellence: 40, fatigue: 80 })
  })

  it('mesma família fora da recalibração: partida pela idade de hoje', () => {
    const previous = stored({
      peakStartBpm: null,
      bands: { HEART_RATE: { validDays: 2, start: { excellence: null, fatigue: null }, learned: { excellence: null, fatigue: null } } },
    })
    const out = recalculate({ previous, days: series(3), maxBpmByAge: MAX_35_YEARS })!
    expect(out.bands.HEART_RATE.start).toEqual(startCuts('HEART_RATE', MAX_35_YEARS))
    expect(out.peakStartBpm).toBe(MAX_35_YEARS)
  })

  it('troca de família: fase nova, partida nas faixas aprendidas, peso do zero', () => {
    const previous = stored({
      peakBpm: 168,
      bands: {
        HEART_RATE: { validDays: 30, start: { excellence: null, fatigue: 165.15 }, learned: { excellence: 74, fatigue: 128 } },
        OXYGEN_SATURATION: { validDays: 30, start: { excellence: null, fatigue: null }, learned: { excellence: 97, fatigue: 94 } },
      },
    })
    const days = [...series(3, { heartRateP90: 140 }, 'BAND', 30), ...series(10, {}, 'WATCH', 27)]
    const out = recalculate({ previous, days, maxBpmByAge: MAX_35_YEARS })!
    expect(out.deviceFamily).toBe('BAND')
    expect(out.phaseStartedAt).toEqual(at(28))
    expect(out.recalibrating).toBe(true)
    expect(out.deviceChanged).toBe(true)
    expect(out.validDays).toBe(3)
    expect(out.peakStartBpm).toBe(168)
    expect(out.bands.HEART_RATE.start).toEqual({ excellence: 74, fatigue: 128 })
    expect(out.bands.OXYGEN_SATURATION.start).toEqual({ excellence: 97, fatigue: 94 })
    expect(out.bands.HEART_RATE.learned.fatigue).toBeCloseTo(0.1 * 140 + 0.9 * 128)
    expect(out.bands.HEART_RATE.learned.excellence).toBeCloseTo(0.1 * 75 + 0.9 * 74)
    // Medição sem faixa antes da troca parte da partida mínima.
    expect(out.bands.WEAR.start).toEqual({ excellence: 40, fatigue: 80 })
  })

  it('troca de família sem pico anterior parte da máxima por idade', () => {
    const previous = stored({ peakBpm: null })
    const out = recalculate({ previous, days: series(1, {}, 'BAND'), maxBpmByAge: MAX_35_YEARS })!
    expect(out.peakStartBpm).toBe(MAX_35_YEARS)
  })

  it('com calibração e sem dia com família, segue a família da calibração', () => {
    const out = recalculate({ previous: stored({ deviceFamily: 'BAND' }), days: [], maxBpmByAge: MAX_35_YEARS })!
    expect(out.deviceFamily).toBe('BAND')
    expect(out.deviceChanged).toBe(false)
    expect(out.validDays).toBe(0)
  })

  it('só contam os dias da fase: nem os de antes, nem os da outra família', () => {
    const previous = stored({ phaseStartedAt: at(26) })
    const days = [...series(5, {}, 'WATCH', 30), ...series(5, {}, 'WATCH', 25)]
    expect(recalculate({ previous, days, maxBpmByAge: MAX_35_YEARS })!.validDays).toBe(5)
  })
})
