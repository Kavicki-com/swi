import { calibrationDayOf, thresholdsOf, type ThresholdRows } from './calibration-thresholds'

// O motor lê daqui a régua de cada pessoa. O que se protege: a partida v1.0
// quando não há faixa, a correção do gestor por cima do aprendido, a trava só
// quando legível e o dia da calibração que vira selo na condição.

const rows = (over: Partial<ThresholdRows> = {}): ThresholdRows => ({
  calibration: null,
  bands: [],
  safety: [],
  maxBpmByAge: 180,
  ...over,
})

describe('calibrationDayOf', () => {
  it('sem calibração é o primeiro dia', () => {
    expect(calibrationDayOf(null)).toBe(1)
  })

  it('é o dia seguinte aos dias válidos, até o 30º', () => {
    expect(calibrationDayOf({ validDays: 0 })).toBe(1)
    expect(calibrationDayOf({ validDays: 9 })).toBe(10)
    expect(calibrationDayOf({ validDays: 29 })).toBe(30)
  })

  it('com 30 dias válidos a calibração fechou e o selo some', () => {
    expect(calibrationDayOf({ validDays: 30 })).toBeNull()
    expect(calibrationDayOf({ validDays: 45 })).toBeNull()
  })
})

describe('thresholdsOf', () => {
  it('sem faixa nenhuma vale a partida v1.0, com a máxima por idade no batimento', () => {
    const t = thresholdsOf(rows())

    expect(t.cuts.HEART_RATE).toEqual({ excellence: null, fatigue: 162 })
    expect(t.cuts.SYSTOLIC).toEqual({ excellence: null, fatigue: 140 })
    expect(t.cuts.DIASTOLIC).toEqual({ excellence: null, fatigue: 90 })
    expect(t.cuts.WEAR).toEqual({ excellence: null, fatigue: 80 })
    // Oxigenação não tem partida: Atenção dela só depois do 7º dia válido.
    expect(t.cuts.OXYGEN_SATURATION).toEqual({ excellence: null, fatigue: null })
    expect(t.calibrationDay).toBe(1)
    expect(t.restingBpm).toBeNull()
    expect(t.safety).toEqual({})
  })

  it('sem data de nascimento, o batimento fica sem corte de partida', () => {
    expect(thresholdsOf(rows({ maxBpmByAge: null })).cuts.HEART_RATE.fatigue).toBeNull()
  })

  it('a faixa aprendida vale; a correção do gestor vale por cima dela', () => {
    const t = thresholdsOf(
      rows({
        bands: [
          { metric: 'HEART_RATE', learnedCuts: { excellence: 90, fatigue: 130 }, overrideCuts: null },
          {
            metric: 'WEAR',
            learnedCuts: { excellence: 30, fatigue: 72 },
            overrideCuts: { excellence: 25, fatigue: 70 },
          },
        ],
      }),
    )

    expect(t.cuts.HEART_RATE).toEqual({ excellence: 90, fatigue: 130 })
    expect(t.cuts.WEAR).toEqual({ excellence: 25, fatigue: 70 })
  })

  it('aprendido ilegível cai na partida; correção ilegível cai no aprendido', () => {
    const t = thresholdsOf(
      rows({
        bands: [
          { metric: 'SYSTOLIC', learnedCuts: { fatigue: 150 }, overrideCuts: null },
          { metric: 'DIASTOLIC', learnedCuts: { excellence: 70, fatigue: 88 }, overrideCuts: 'x' },
        ],
      }),
    )

    expect(t.cuts.SYSTOLIC).toEqual({ excellence: null, fatigue: 140 })
    expect(t.cuts.DIASTOLIC).toEqual({ excellence: 70, fatigue: 88 })
  })

  it('só as travas legíveis entram, cada uma com o formato da regra', () => {
    const t = thresholdsOf(
      rows({
        safety: [
          { rule: 'HEART_RATE_HIGH', values: { openAt: 150, closeAt: 140 } },
          { rule: 'OXYGEN_LOW', values: { openAt: 'x', closeAt: 92 } },
          {
            rule: 'BLOOD_PRESSURE_HIGH',
            values: { systolicAt: 170, diastolicAt: 105, systolicRecoverBelow: 150, diastolicRecoverBelow: 95 },
          },
        ],
      }),
    )

    expect(t.safety).toEqual({
      HEART_RATE_HIGH: { openAt: 150, closeAt: 140 },
      BLOOD_PRESSURE_HIGH: { systolicAt: 170, diastolicAt: 105, systolicRecoverBelow: 150, diastolicRecoverBelow: 95 },
    })
  })

  it('o repouso e o dia saem da calibração', () => {
    const t = thresholdsOf(rows({ calibration: { validDays: 9, restingBpm: 58 } }))

    expect(t.restingBpm).toBe(58)
    expect(t.calibrationDay).toBe(10)
  })
})
