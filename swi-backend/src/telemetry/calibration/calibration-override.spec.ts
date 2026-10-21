import { validateCuts } from './calibration-override'

describe('validateCuts', () => {
  it('aceita a correção em ordem, com corte nulo permitido', () => {
    expect(validateCuts('HEART_RATE', { excellence: 70, fatigue: 150 })).toBeNull()
    expect(validateCuts('HEART_RATE', { excellence: null, fatigue: 150 })).toBeNull()
    expect(validateCuts('OXYGEN_SATURATION', { excellence: 98, fatigue: 94 })).toBeNull()
    expect(validateCuts('STEPS', { below: 3000, above: 9000 })).toBeNull()
    expect(validateCuts('BODY_TEMPERATURE', { p10: 35.8, p25: 36.1, p75: 36.8, p90: 37.1 })).toBeNull()
    expect(validateCuts('BODY_TEMPERATURE', { p10: null, p25: 36.1, p75: null, p90: 37.1 })).toBeNull()
  })

  it('recusa chave ausente, valor não numérico e tudo nulo', () => {
    expect(validateCuts('HEART_RATE', { fatigue: 150 })).toMatch(/incompletos/)
    expect(validateCuts('HEART_RATE', { excellence: '70', fatigue: 150 })).toMatch(/incompletos/)
    expect(validateCuts('HEART_RATE', null)).toMatch(/incompletos/)
    expect(validateCuts('HEART_RATE', { excellence: null, fatigue: null })).toMatch(/ao menos um corte/)
  })

  it('recusa número fora do plausível', () => {
    expect(validateCuts('WEAR', { excellence: 10, fatigue: 120 })).toMatch(/entre 0 e 100/)
    expect(validateCuts('EFFORT', { excellence: -1, fatigue: 50 })).toMatch(/entre 0 e 100/)
    expect(validateCuts('STEPS', { below: -5, above: 100 })).toMatch(/negativos/)
  })

  it('recusa corte invertido: a faixa normal não fica vazia', () => {
    expect(validateCuts('HEART_RATE', { excellence: 150, fatigue: 70 })).toMatch(/excelência deve ficar abaixo/)
    expect(validateCuts('SYSTOLIC', { excellence: 120, fatigue: 120 })).toMatch(/excelência deve ficar abaixo/)
    expect(validateCuts('OXYGEN_SATURATION', { excellence: 94, fatigue: 98 })).toMatch(/fadiga deve ficar abaixo/)
    expect(validateCuts('DISTANCE', { below: 5000, above: 5000 })).toMatch(/abaixo do de acima/)
    expect(validateCuts('BODY_TEMPERATURE', { p10: 36, p25: 36.5, p75: 36.5, p90: 37 })).toMatch(/p10 <= p25 < p75/)
    expect(validateCuts('BODY_TEMPERATURE', { p10: 36.2, p25: 36.1, p75: 36.8, p90: 37 })).toMatch(/p10 <= p25 < p75/)
    expect(validateCuts('BODY_TEMPERATURE', { p10: 36, p25: 36, p75: 36.8, p90: 36.8 })).toBeNull()
  })
})
