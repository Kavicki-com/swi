// describe/it/expect vêm dos globals do Vitest; importar de 'vitest' duplica a instância.
import type { WorkerCalibration } from '@/services/api/telemetry'
import {
  calibrationBadgeOf,
  calibrationLineOf,
  calibratingLabel,
  limitsLabelOf,
  pressureLimitsLabel,
  pressureLineOf,
  recalibratingLabel,
  worseStateZone,
  zoneTagOf,
} from './calibrationView'

const calibration = (over: Partial<WorkerCalibration> = {}): WorkerCalibration => ({
  version: 'cal-v1',
  phase: 'CALIBRATING',
  recalibrating: false,
  day: 12,
  metrics: {},
  ...over,
})

describe('zoneTagOf', () => {
  it('cada zona vira um selo com rótulo e status do DS', () => {
    expect(zoneTagOf('EXCELLENCE')).toEqual({ label: 'Excelência', status: 'accept' })
    expect(zoneTagOf('NORMAL')).toEqual({ label: 'Normal', status: 'info' })
    expect(zoneTagOf('FATIGUE')).toEqual({ label: 'Fadiga', status: 'canceled' })
    expect(zoneTagOf('BELOW')).toEqual({ label: 'Abaixo do habitual', status: 'info' })
    expect(zoneTagOf('USUAL')).toEqual({ label: 'Habitual', status: 'info' })
    expect(zoneTagOf('ABOVE')).toEqual({ label: 'Acima do habitual', status: 'info' })
  })

  it('sem zona, sem selo', () => {
    expect(zoneTagOf(null)).toBeNull()
  })
})

describe('limitsLabelOf', () => {
  it('batimento: bpm arredondado', () => {
    expect(limitsLabelOf('HEART_RATE', { excellence: 68.4, fatigue: 127.6 })).toBe(
      'excelência até 68, fadiga a partir de 128',
    )
  })

  it('batimento com um lado só', () => {
    expect(limitsLabelOf('HEART_RATE', { excellence: null, fatigue: 128 })).toBe(
      'fadiga a partir de 128',
    )
    expect(limitsLabelOf('HEART_RATE', { excellence: 68, fatigue: null })).toBe('excelência até 68')
  })

  it('oxigenação: excelência por cima, fadiga por baixo', () => {
    expect(limitsLabelOf('OXYGEN_SATURATION', { excellence: 97, fatigue: 94 })).toBe(
      'excelência a partir de 97%, fadiga abaixo de 94%',
    )
    expect(limitsLabelOf('OXYGEN_SATURATION', { excellence: 96.5, fatigue: null })).toBe(
      'excelência a partir de 96,5%',
    )
  })

  it('temperatura: o habitual é p25 a p75, com vírgula', () => {
    expect(limitsLabelOf('BODY_TEMPERATURE', { p10: 33.1, p25: 33.5, p75: 34.5, p90: 34.9 })).toBe(
      'habitual de 33,5 a 34,5 °C',
    )
  })

  it('temperatura sem p25 ou p75 cai para p10 ou p90 daquele lado', () => {
    expect(limitsLabelOf('BODY_TEMPERATURE', { p10: 33.1, p25: null, p75: 34.5, p90: 34.9 })).toBe(
      'habitual de 33,1 a 34,5 °C',
    )
    expect(limitsLabelOf('BODY_TEMPERATURE', { p10: null, p25: null, p75: 34.5, p90: null })).toBe(
      'habitual até 34,5 °C',
    )
    expect(limitsLabelOf('BODY_TEMPERATURE', { p10: 33.1, p25: null, p75: null, p90: null })).toBe(
      'habitual a partir de 33,1 °C',
    )
  })

  it('esforço e desgaste em porcentagem', () => {
    expect(limitsLabelOf('EFFORT', { excellence: 25, fatigue: 70 })).toBe(
      'excelência até 25%, fadiga a partir de 70%',
    )
    expect(limitsLabelOf('WEAR', { excellence: 25.25, fatigue: 70 })).toBe(
      'excelência até 25,3%, fadiga a partir de 70%',
    )
  })

  it('passos: milhar como "mil", abaixo de mil o número cheio', () => {
    expect(limitsLabelOf('STEPS', { below: 8000, above: 11000 })).toBe(
      'habitual: 8 a 11 mil passos',
    )
    expect(limitsLabelOf('STEPS', { below: 8000, above: 10500 })).toBe(
      'habitual: 8 a 10,5 mil passos',
    )
    expect(limitsLabelOf('STEPS', { below: 800, above: 11000 })).toBe(
      'habitual: 800 a 11 mil passos',
    )
    expect(limitsLabelOf('STEPS', { below: 300, above: 900 })).toBe('habitual: 300 a 900 passos')
  })

  it('passos com um lado só', () => {
    expect(limitsLabelOf('STEPS', { below: 8000, above: null })).toBe(
      'habitual: a partir de 8 mil passos',
    )
    expect(limitsLabelOf('STEPS', { below: null, above: 11000 })).toBe(
      'habitual: até 11 mil passos',
    )
  })

  it('distância chega em metros e sai em km', () => {
    expect(limitsLabelOf('DISTANCE', { below: 5200, above: 7800 })).toBe('habitual: 5,2 a 7,8 km')
  })

  it('calorias e movimento', () => {
    expect(limitsLabelOf('ACTIVE_ENERGY', { below: 350, above: 520 })).toBe(
      'habitual: 350 a 520 kcal',
    )
    expect(limitsLabelOf('ACTIVE_ENERGY', { below: 1200, above: 1650.4 })).toBe(
      'habitual: 1.200 a 1.650 kcal',
    )
    expect(limitsLabelOf('MOVEMENT', { below: 30, above: 52 })).toBe('habitual: 30 a 52/min')
  })

  it('tudo nulo ou corte ausente: sem frase', () => {
    expect(limitsLabelOf('HEART_RATE', { excellence: null, fatigue: null })).toBeNull()
    expect(limitsLabelOf('STEPS', {})).toBeNull()
    expect(
      limitsLabelOf('BODY_TEMPERATURE', { p10: null, p25: null, p75: null, p90: null }),
    ).toBeNull()
  })
})

describe('pressureLimitsLabel', () => {
  it('sistólica e diastólica juntas, excelência e fadiga como no batimento', () => {
    expect(
      pressureLimitsLabel({ excellence: 118, fatigue: 135 }, { excellence: 76, fatigue: 88 }),
    ).toBe('excelência até 118/76, fadiga a partir de 135/88')
  })

  it('um lado faltando: só o que existe, com o nome', () => {
    expect(pressureLimitsLabel({ excellence: 118, fatigue: 135 }, null)).toBe(
      'excelência até sistólica 118, fadiga a partir de sistólica 135',
    )
    expect(pressureLimitsLabel({ fatigue: null }, { fatigue: 88 })).toBe(
      'fadiga a partir de diastólica 88',
    )
  })

  it('cada corte decide sozinho: só excelência ainda vira frase', () => {
    expect(pressureLimitsLabel({ excellence: 118, fatigue: null }, { fatigue: null })).toBe(
      'excelência até sistólica 118',
    )
  })

  it('nenhum corte: sem frase', () => {
    expect(pressureLimitsLabel(null, null)).toBeNull()
    expect(pressureLimitsLabel({ fatigue: null }, { excellence: null })).toBeNull()
  })
})

describe('worseStateZone', () => {
  it('fadiga vence normal, que vence excelência; nulo não conta', () => {
    expect(worseStateZone('EXCELLENCE', 'FATIGUE')).toBe('FATIGUE')
    expect(worseStateZone('NORMAL', 'EXCELLENCE')).toBe('NORMAL')
    expect(worseStateZone(null, 'EXCELLENCE')).toBe('EXCELLENCE')
    expect(worseStateZone(null, null)).toBeNull()
  })
})

describe('calibrationLineOf e pressureLineOf', () => {
  const cal = calibration({
    metrics: {
      HEART_RATE: { zone: 'NORMAL', cuts: { excellence: 68, fatigue: 128 }, source: 'LEARNED' },
      STEPS: { zone: 'USUAL', cuts: { below: 8000, above: 11000 }, source: 'LEARNED' },
      SYSTOLIC: { zone: 'EXCELLENCE', cuts: { excellence: 118, fatigue: 135 }, source: 'LEARNED' },
      DIASTOLIC: { zone: 'FATIGUE', cuts: { excellence: 76, fatigue: 88 }, source: 'OVERRIDE' },
    },
  })

  it('zona e frase da medição', () => {
    expect(calibrationLineOf(cal, 'HEART_RATE')).toEqual({
      zone: { label: 'Normal', status: 'info' },
      limits: 'excelência até 68, fadiga a partir de 128',
    })
  })

  it('total do dia só leva a faixa, nunca a zona', () => {
    expect(calibrationLineOf(cal, 'STEPS', { withZone: false })).toEqual({
      zone: null,
      limits: 'habitual: 8 a 11 mil passos',
    })
  })

  it('sem calibração ou sem a medição: linha vazia', () => {
    expect(calibrationLineOf(null, 'HEART_RATE')).toEqual({ zone: null, limits: null })
    expect(calibrationLineOf(undefined, 'HEART_RATE')).toEqual({ zone: null, limits: null })
    expect(calibrationLineOf(cal, 'WEAR')).toEqual({ zone: null, limits: null })
  })

  it('pressão usa a pior das duas zonas e a frase conjunta', () => {
    expect(pressureLineOf(cal)).toEqual({
      zone: { label: 'Fadiga', status: 'canceled' },
      limits: 'excelência até 118/76, fadiga a partir de 135/88',
    })
    expect(pressureLineOf(null)).toEqual({ zone: null, limits: null })
  })
})

describe('selo da calibração', () => {
  it('frases de calibrando e recalibrando', () => {
    expect(calibratingLabel(12)).toBe('Calibrando, dia 12 de 30')
    expect(recalibratingLabel(3)).toBe('Recalibrando: novo aparelho, dia 3 de 30')
  })

  it('calibrando, recalibrando e calibrado', () => {
    expect(calibrationBadgeOf(calibration())).toBe('Calibrando, dia 12 de 30')
    expect(calibrationBadgeOf(calibration({ recalibrating: true, day: 3 }))).toBe(
      'Recalibrando: novo aparelho, dia 3 de 30',
    )
    expect(calibrationBadgeOf(calibration({ phase: 'CALIBRATED', day: null }))).toBeNull()
  })

  it('sem calibração, sem selo', () => {
    expect(calibrationBadgeOf(null)).toBeNull()
    expect(calibrationBadgeOf(undefined)).toBeNull()
  })
})
