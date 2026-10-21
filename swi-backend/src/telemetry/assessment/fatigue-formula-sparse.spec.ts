import { percentile } from '../calibration/percentile'
import { assessSparseDay, dayStatsOf } from './fatigue-formula-sparse'
import { isSparseFormula, SPARSE_FORMULA_VERSION, SPARSE_PROFILE } from './sparse-profile'
import type { Baseline } from './fatigue-formula'

const MIN = 60_000
const T0 = Date.parse('2026-10-20T12:00:00.000Z')
// Repouso 60 e máxima 180: reserva de 120, e 120 bpm é exatamente HRR 0,5.
const baseline: Baseline = { kind: 'available', restingBpm: 60, maxBpm: 180 }
const at = (minutes: number, bpm: number) => ({ atMs: T0 + minutes * MIN, bpm })

describe('assessSparseDay', () => {
  it('fixa a versão literal: mudar coeficiente sem mudar versão é proibido', () => {
    expect(SPARSE_FORMULA_VERSION).toBe('swi-fatigue-sparse-2')
    expect(SPARSE_PROFILE.gapMaxMs).toBe(10 * MIN)
  })

  it('reconhece a esparsa de qualquer versão pelo prefixo, e só ela', () => {
    expect(isSparseFormula('swi-fatigue-sparse-1')).toBe(true)
    expect(isSparseFormula(SPARSE_FORMULA_VERSION)).toBe(true)
    expect(isSparseFormula('swi-fatigue-calibrated-1')).toBe(false)
    expect(isSparseFormula('swi-fatigue-experimental-1')).toBe(false)
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

describe('assessSparseDay: estatísticas do dia e série', () => {
  // Sobe a 170 por 1 h e volta ao repouso por 3 h: o desgaste do fim é menor
  // que o pico, e é o pico que o Resumo precisa guardar.
  const day = [
    ...Array.from({ length: 13 }, (_, i) => at(i * 5, 170)),
    ...Array.from({ length: 36 }, (_, i) => at(65 + i * 5, 60)),
  ]

  it('um ponto por batimento, em ordem, e o último é o resultado final', () => {
    const r = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: day })
    expect(r.points).toHaveLength(day.length)
    expect(r.points.map((p) => p.atMs)).toEqual(day.map((s) => s.atMs))
    const last = r.points[r.points.length - 1]
    expect(last.effortPercent).toBe(r.effortPercent)
    expect(last.wearPercent).toBe(r.wearPercent)
  })

  it('o desgaste máximo do dia é o pico da série, não o do fim', () => {
    const r = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: day })
    const peak = Math.max(...r.points.map((p) => p.wearPercent))
    expect(r.dayStats.wearMax).toBe(peak)
    expect(r.dayStats.wearMax!).toBeGreaterThan(r.wearPercent!)
  })

  it('p25 e p90 do esforço saem dos esforços de cada batimento', () => {
    const r = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: day })
    const efforts = r.points.map((p) => p.effortPercent)
    expect(r.dayStats.effortP25).toBe(percentile(efforts, 25))
    expect(r.dayStats.effortP90).toBe(percentile(efforts, 90))
  })

  it('sem batimento ou sem linha de base, estatísticas nulas e série vazia', () => {
    const none = { wearMax: null, effortP25: null, effortP90: null }
    const empty = assessSparseDay({ profile: SPARSE_PROFILE, baseline, samples: [] })
    expect(empty.dayStats).toEqual(none)
    expect(empty.points).toEqual([])
    const noBaseline = assessSparseDay({
      profile: SPARSE_PROFILE,
      baseline: { kind: 'unavailable', reason: 'no_birth_date' },
      samples: [at(0, 120)],
    })
    expect(noBaseline.dayStats).toEqual(none)
    expect(noBaseline.points).toEqual([])
  })
})

describe('dayStatsOf', () => {
  it('lê as estatísticas gravadas em inputs.dayStats', () => {
    expect(dayStatsOf({ dayStats: { wearMax: 40, effortP25: 12, effortP90: null } })).toEqual({
      wearMax: 40,
      effortP25: 12,
      effortP90: null,
    })
  })

  it('nulo sem inputs, sem dayStats ou com campo torto', () => {
    expect(dayStatsOf(null)).toBeNull()
    expect(dayStatsOf({ window: {} })).toBeNull()
    expect(dayStatsOf({ dayStats: { wearMax: '40', effortP25: 12, effortP90: 70 } })).toBeNull()
    expect(dayStatsOf({ dayStats: { wearMax: 40 } })).toBeNull()
    expect(dayStatsOf([1, 2])).toBeNull()
  })
})
