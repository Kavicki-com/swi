import { assessSparseDay } from './fatigue-formula-sparse'
import { SPARSE_FORMULA_VERSION, SPARSE_PROFILE } from './sparse-profile'
import type { Baseline } from './fatigue-formula'

const MIN = 60_000
const T0 = Date.parse('2026-10-20T12:00:00.000Z')
// Repouso 60 e máxima 180: reserva de 120, e 120 bpm é exatamente HRR 0,5.
const baseline: Baseline = { kind: 'available', restingBpm: 60, maxBpm: 180 }
const at = (minutes: number, bpm: number) => ({ atMs: T0 + minutes * MIN, bpm })

describe('assessSparseDay', () => {
  it('fixa a versão literal: mudar coeficiente sem mudar versão é proibido', () => {
    expect(SPARSE_FORMULA_VERSION).toBe('swi-fatigue-sparse-1')
    expect(SPARSE_PROFILE.gapMaxMs).toBe(10 * MIN)
  })

  it('sem leitura no dia, indisponível por falta de batimento', () => {
    const r = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: [] })
    expect(r).toMatchObject({
      effortPercent: null,
      wearPercent: null,
      fatigueEtaMin: null,
      measuredUntilMs: null,
      unavailableReason: 'no_heart_rate',
    })
  })

  it('sem linha de base, indisponível pelo motivo dela, mas diz até quando mediu', () => {
    const r = assessSparseDay({
      profile: SPARSE_PROFILE,
      baseline: { kind: 'unavailable', reason: 'no_birth_date' },
      samples: [at(0, 120), at(5, 120)],
    })
    expect(r.effortPercent).toBeNull()
    expect(r.wearPercent).toBeNull()
    expect(r.unavailableReason).toBe('no_birth_date')
    expect(r.measuredUntilMs).toBe(T0 + 5 * MIN)
  })

  it('intensidade constante dá esforço igual a ela', () => {
    const r = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: [at(0, 120), at(5, 120), at(10, 120)] })
    expect(r.effortPercent).toBe(50)
  })

  it('dose de um intervalo: 0,5^1,6 por 5 minutos', () => {
    // dose = 0,5^1,6 × 5 = 1,6494; desgaste = 100 × (1 − e^(−1,6494/120)) = 1,37 → 1
    const r = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: [at(0, 120), at(5, 120)] })
    expect(r.wearPercent).toBe(1)
  })

  it('lacuna acima de dez minutos não vira dose, e é contada', () => {
    const r = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: [at(0, 170), at(30, 170)] })
    expect(r.wearPercent).toBe(0)
    expect(r.gapsOverMax).toBe(1)
  })

  it('a dose decai entre leituras pelo tempo real, mesmo na lacuna', () => {
    const dense = Array.from({ length: 25 }, (_, i) => at(i * 5, 170)) // 2 h de esforço alto
    const loaded = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: dense })
    const rested = assessSparseDay({
      profile: SPARSE_PROFILE,
      baseline,
      samples: [...dense, at(120 + 180, 60)], // 3 h depois, em repouso
    })
    expect(rested.wearPercent!).toBeLessThan(loaded.wearPercent!)
    expect(rested.wearPercent!).toBeGreaterThan(0)
  })

  it('nunca projeta minutos até a fadiga: o dado descreve um momento que já passou', () => {
    const dense = Array.from({ length: 49 }, (_, i) => at(i * 5, 175))
    expect(assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: dense }).fatigueEtaMin).toBeNull()
  })

  it('o resultado vale na última leitura', () => {
    const r = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: [at(0, 100), at(7, 110)] })
    expect(r.measuredUntilMs).toBe(T0 + 7 * MIN)
  })
})
