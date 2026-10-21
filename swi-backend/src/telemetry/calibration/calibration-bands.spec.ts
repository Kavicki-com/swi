import {
  CUT_KEYS,
  cutsOf,
  effectiveCuts,
  isValidDay,
  nextCut,
  nextCuts,
  personalCuts,
  slowStep,
  startCutsV1,
  wearFatigueCutOf,
} from './calibration-bands'
import { day } from './fixtures/days'

const HOUR = 60 * 60 * 1000

describe('dia válido', () => {
  it('batimento e derivadas pedem 2 h de batimento coberto', () => {
    expect(isValidDay('HEART_RATE', day())).toBe(true)
    expect(isValidDay('HEART_RATE', day({ heartRateCoveredMs: 2 * HOUR - 1 }))).toBe(false)
    expect(isValidDay('HEART_RATE', day({ heartRateCoveredMs: null }))).toBe(false)
    expect(isValidDay('STEPS', day({ heartRateCoveredMs: HOUR }))).toBe(false)
    expect(isValidDay('WEAR', day({ wearMax: null }))).toBe(false)
  })
  it('pressão basta uma medição, sem exigir batimento', () => {
    expect(isValidDay('SYSTOLIC', day({ heartRateCoveredMs: 0, bloodPressureCount: 1, systolicAvg: 120 }))).toBe(true)
    expect(isValidDay('DIASTOLIC', day({ heartRateCoveredMs: 0, bloodPressureCount: 1, diastolicAvg: 80 }))).toBe(true)
    expect(isValidDay('SYSTOLIC', day({ bloodPressureCount: 0, systolicAvg: 120 }))).toBe(false)
    expect(isValidDay('SYSTOLIC', day({ bloodPressureCount: null, systolicAvg: 120 }))).toBe(false)
  })
  it('oxigenação e temperatura pedem 3 medições', () => {
    const oxy = { oxygenSaturationP10: 95, oxygenSaturationP50: 97 }
    expect(isValidDay('OXYGEN_SATURATION', day({ ...oxy, oxygenSaturationCount: 3 }))).toBe(true)
    expect(isValidDay('OXYGEN_SATURATION', day({ ...oxy, oxygenSaturationCount: 2 }))).toBe(false)
    const temp = { bodyTemperatureP10: 33, bodyTemperatureP25: 33.5, bodyTemperatureP75: 34.5, bodyTemperatureP90: 35 }
    expect(isValidDay('BODY_TEMPERATURE', day({ ...temp, bodyTemperatureCount: 3 }))).toBe(true)
    expect(isValidDay('BODY_TEMPERATURE', day({ ...temp, bodyTemperatureCount: null }))).toBe(false)
  })
  it('sem a estatística da medição, o dia não vale para ela', () => {
    expect(isValidDay('OXYGEN_SATURATION', day({ oxygenSaturationCount: 5 }))).toBe(false)
    expect(isValidDay('EFFORT', day({ effortP90: null }))).toBe(false)
    expect(isValidDay('DISTANCE', day({ distanceTotalM: null }))).toBe(false)
    expect(isValidDay('ACTIVE_ENERGY', day({ activeEnergyKcalTotal: null }))).toBe(false)
    expect(isValidDay('MOVEMENT', day({ movementPerMinuteMedian: null }))).toBe(false)
  })
})

describe('valor pessoal', () => {
  it('batimento: mediana dos p25 e dos p90', () => {
    const days = [
      day({ heartRateP25: 70, heartRateP90: 110 }),
      day({ heartRateP25: 80, heartRateP90: 130 }),
      day({ heartRateP25: 74, heartRateP90: 120 }),
    ]
    expect(personalCuts('HEART_RATE', days)).toEqual({ excellence: 74, fatigue: 120 })
  })
  it('oxigenação: excelência pela mediana dos p50, fadiga pela dos p10', () => {
    const days = [day({ oxygenSaturationP10: 94, oxygenSaturationP50: 97 }), day({ oxygenSaturationP10: 95, oxygenSaturationP50: 98 })]
    expect(personalCuts('OXYGEN_SATURATION', days)).toEqual({ excellence: 97.5, fatigue: 94.5 })
  })
  it('desgaste e pressão: percentil entre dias, não mediana de percentis', () => {
    const days = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((w) => day({ wearMax: w }))
    expect(personalCuts('WEAR', days)).toEqual({ excellence: 30, fatigue: 90 })
    const bp = [110, 120, 130, 140].map((s, i) => day({ systolicAvg: s, diastolicAvg: 70 + i * 5 }))
    expect(personalCuts('SYSTOLIC', bp)).toEqual({ excellence: 110, fatigue: 140 })
    expect(personalCuts('DIASTOLIC', bp)).toEqual({ excellence: 70, fatigue: 85 })
  })
  it('esforço: mediana dos p25 e dos p90', () => {
    const days = [day({ effortP25: 10, effortP90: 50 }), day({ effortP25: 20, effortP90: 70 })]
    expect(personalCuts('EFFORT', days)).toEqual({ excellence: 15, fatigue: 60 })
  })
  it('atividade: p25 e p75 dos totais', () => {
    const days = [4000, 8000, 9000, 11000].map((s) => day({ stepsTotal: s }))
    expect(personalCuts('STEPS', days)).toEqual({ below: 4000, above: 9000 })
    expect(personalCuts('DISTANCE', [day({ distanceTotalM: 5000 })])).toEqual({ below: 5000, above: 5000 })
    expect(personalCuts('ACTIVE_ENERGY', [day({ activeEnergyKcalTotal: 300 })])).toEqual({ below: 300, above: 300 })
    expect(personalCuts('MOVEMENT', [day({ movementPerMinuteMedian: 35 })])).toEqual({ below: 35, above: 35 })
  })
  it('temperatura: quatro cortes', () => {
    const t = { bodyTemperatureP10: 33, bodyTemperatureP25: 33.5, bodyTemperatureP75: 34.5, bodyTemperatureP90: 35, bodyTemperatureCount: 3 }
    expect(personalCuts('BODY_TEMPERATURE', [day(t)])).toEqual({ p10: 33, p25: 33.5, p75: 34.5, p90: 35 })
  })
  it('janela vazia dá cortes nulos', () => {
    expect(personalCuts('HEART_RATE', [])).toEqual({ excellence: null, fatigue: null })
  })
})

describe('partida v1.0', () => {
  it('só batimento, pressão e desgaste têm partida, e só no corte de fadiga', () => {
    expect(startCutsV1('HEART_RATE', 183.5).fatigue).toBeCloseTo(165.15)
    expect(startCutsV1('HEART_RATE', null)).toEqual({ excellence: null, fatigue: null })
    expect(startCutsV1('SYSTOLIC', null)).toEqual({ excellence: null, fatigue: 140 })
    expect(startCutsV1('DIASTOLIC', null)).toEqual({ excellence: null, fatigue: 90 })
    expect(startCutsV1('WEAR', null)).toEqual({ excellence: null, fatigue: 80 })
    expect(startCutsV1('OXYGEN_SATURATION', null)).toEqual({ excellence: null, fatigue: null })
    for (const k of CUT_KEYS.STEPS) expect(startCutsV1('STEPS', null)[k]).toBeNull()
  })
})

describe('mistura', () => {
  it('com partida: só a partida até o 2º dia, peso dias/30 do 3º ao 29º', () => {
    expect(nextCut(0, 128, 165, null)).toBe(165)
    expect(nextCut(2, 128, 165, null)).toBe(165)
    expect(nextCut(10, 128, 165, null)).toBeCloseTo(152.67, 2)
    expect(nextCut(20, 128, 165, null)).toBeCloseTo(140.33, 2)
  })
  it('com partida e sem valor pessoal, fica a partida', () => {
    expect(nextCut(10, null, 165, null)).toBe(165)
  })
  it('é o exemplo aprovado pelo cliente (165, 153, 140, 128)', () => {
    expect(Math.round(nextCut(10, 128, 165, null)!)).toBe(153)
    expect(Math.round(nextCut(20, 128, 165, null)!)).toBe(140)
    expect(nextCut(30, 128, 165, null)).toBe(128)
  })
  it('sem partida: nada até o 6º dia, só o pessoal do 7º ao 29º', () => {
    expect(nextCut(6, 97, null, null)).toBeNull()
    expect(nextCut(7, 97, null, null)).toBe(97)
  })
  it('depois do dia 30, passo de no máximo 0,5% na direção do alvo', () => {
    expect(slowStep(100, 90)).toBeCloseTo(99.5)
    expect(slowStep(100, 120)).toBeCloseTo(100.5)
    expect(slowStep(100, 100.2)).toBeCloseTo(100.2)
    expect(slowStep(null, 90)).toBe(90)
    expect(nextCut(31, 90, 165, 100)).toBeCloseTo(99.5)
  })
  it('sem valor pessoal no dia 30 ou depois, segura o anterior', () => {
    expect(nextCut(31, null, 165, 130)).toBe(130)
  })
})

describe('ordem dos cortes', () => {
  it('excelência que cruza a fadiga ainda não vale', () => {
    // 7º dia: excelência só pessoal (164); fadiga misturada 7/30 entre 160 e 165, cerca de 163,8.
    const out = nextCuts('HEART_RATE', 7, { excellence: 164, fatigue: 160 }, { excellence: null, fatigue: 165 }, null)
    expect(out.excellence).toBeNull()
    expect(out.fatigue).toBeCloseTo(163.83, 2)
  })
  it('excelência do lado certo da fadiga vale', () => {
    expect(nextCuts('HEART_RATE', 7, { excellence: 74, fatigue: 160 }, { excellence: null, fatigue: 165 }, null).excellence).toBe(74)
  })
  it('na oxigenação, excelência abaixo da fadiga não vale', () => {
    expect(nextCuts('OXYGEN_SATURATION', 7, { excellence: 94, fatigue: 95 }, { excellence: null, fatigue: null }, null).excellence).toBeNull()
    expect(nextCuts('OXYGEN_SATURATION', 7, { excellence: 97, fatigue: 94 }, { excellence: null, fatigue: null }, null)).toEqual({
      excellence: 97,
      fatigue: 94,
    })
  })
  it('temperatura fora de ordem zera os quatro cortes', () => {
    const out = nextCuts('BODY_TEMPERATURE', 7, { p10: 34, p25: 33, p75: 35, p90: 36 }, { p10: null, p25: null, p75: null, p90: null }, null)
    expect(Object.values(out).every((v) => v === null)).toBe(true)
  })
  it('temperatura em ordem passa inteira', () => {
    const cuts = { p10: 33, p25: 33.5, p75: 34.5, p90: 35 }
    expect(nextCuts('BODY_TEMPERATURE', 7, cuts, { p10: null, p25: null, p75: null, p90: null }, null)).toEqual(cuts)
  })
  it('atividade com os limites trocados é desvirada', () => {
    const none = { below: null, above: null }
    expect(nextCuts('STEPS', 7, { below: 9000, above: 4000 }, none, null)).toEqual({ below: 4000, above: 9000 })
    expect(nextCuts('STEPS', 7, { below: 4000, above: 9000 }, none, null)).toEqual({ below: 4000, above: 9000 })
  })
  it('usa o aprendido anterior depois do dia 30', () => {
    const out = nextCuts('WEAR', 31, { excellence: 20, fatigue: 60 }, { excellence: null, fatigue: 80 }, { excellence: 30, fatigue: 70 })
    expect(out.excellence).toBeCloseTo(29.85)
    expect(out.fatigue).toBeCloseTo(69.65)
  })
})

describe('corte efetivo', () => {
  it('a correção do gestor vence o aprendido', () => {
    expect(effectiveCuts({ excellence: 30, fatigue: 72 }, { excellence: 25, fatigue: 85 })).toEqual({ excellence: 25, fatigue: 85 })
    expect(effectiveCuts({ excellence: 30, fatigue: 72 }, null)).toEqual({ excellence: 30, fatigue: 72 })
  })
  it('a previsão de fadiga mira o corte de fadiga do desgaste da pessoa', () => {
    expect(wearFatigueCutOf(null)).toBe(80)
    expect(wearFatigueCutOf({ learned: { excellence: 30, fatigue: 72 }, override: null })).toBe(72)
    expect(wearFatigueCutOf({ learned: { excellence: 30, fatigue: 72 }, override: { excellence: 30, fatigue: 85 } })).toBe(85)
    expect(wearFatigueCutOf({ learned: { excellence: null, fatigue: null }, override: null })).toBe(80)
  })
})

describe('cutsOf', () => {
  it('lê o JSON gravado e recusa o que estiver torto', () => {
    expect(cutsOf('WEAR', { excellence: 30, fatigue: 90 })).toEqual({ excellence: 30, fatigue: 90 })
    expect(cutsOf('WEAR', { excellence: null, fatigue: 80 })).toEqual({ excellence: null, fatigue: 80 })
    expect(cutsOf('WEAR', { fatigue: 80 })).toBeNull()
    expect(cutsOf('WEAR', { excellence: 'x', fatigue: 80 })).toBeNull()
    expect(cutsOf('WEAR', { excellence: Number.NaN, fatigue: 80 })).toBeNull()
    expect(cutsOf('WEAR', null)).toBeNull()
    expect(cutsOf('WEAR', 42)).toBeNull()
    expect(cutsOf('WEAR', [1, 2])).toBeNull()
  })
  it('só devolve as chaves da medição', () => {
    expect(cutsOf('STEPS', { below: 4000, above: 9000, extra: 1 })).toEqual({ below: 4000, above: 9000 })
  })
})
