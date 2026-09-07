import { EXPERIMENTAL_PROFILE, FORMULA_VERSION } from './assessment-profile'
import {
  assessWindow,
  type Baseline,
  type FormulaSample,
  type FormulaState,
} from './fatigue-formula'

// O que estes casos protegem é a fórmula como função pura: mesmo estado, mesmas
// amostras e mesmo perfil dão o mesmo esforço e o mesmo desgaste, sempre. Nada
// aqui toca relógio nem banco. Os números de referência vêm da pesquisa de
// 2026-08-28; os desvios (intervalo real, média móvel por intervalo, lacuna que
// não acrescenta dose) estão no desenho de 2026-09-04.

const T0 = Date.parse('2026-09-03T12:00:00.000Z')
const sec = (s: number) => T0 + s * 1000

const BASELINE: Baseline = { kind: 'available', restingBpm: 62, maxBpm: 183.5 }

const sample = (atSec: number, heartRateBpm: number | null, motionCount: number | null = null): FormulaSample => ({
  atMs: sec(atSec),
  heartRateBpm,
  motionCount,
})

/** Uma janela de 15 s com uma leitura a cada 5 s. */
const steady = (bpm: number, from = 0): FormulaSample[] => [
  sample(from + 5, bpm),
  sample(from + 10, bpm),
  sample(from + 15, bpm),
]

const run = (over: Partial<Parameters<typeof assessWindow>[0]> = {}) =>
  assessWindow({
    profile: EXPERIMENTAL_PROFILE,
    previous: null,
    baseline: BASELINE,
    samples: steady(118),
    window: { startMs: sec(0), endMs: sec(15) },
    ...over,
  })

/** Corre N janelas seguidas de 15 s, encadeando o estado. */
const chain = (windows: number, bpm: number, motion: number | null = null) => {
  let state: FormulaState | null = null
  let last = run()
  for (let i = 0; i < windows; i++) {
    const from = i * 15
    last = run({
      previous: state,
      samples: [
        sample(from + 5, bpm, motion),
        sample(from + 10, bpm, motion),
        sample(from + 15, bpm, motion),
      ],
      window: { startMs: sec(from), endMs: sec(from + 15) },
    })
    state = last.nextState
  }
  return last
}

describe('assessWindow: perfil', () => {
  it('a versão do perfil é a experimental, fixada por literal para mudar ser decisão', () => {
    expect(FORMULA_VERSION).toBe('swi-fatigue-experimental-1')
    expect(EXPERIMENTAL_PROFILE.version).toBe(FORMULA_VERSION)
  })

  it('os coeficientes da pesquisa estão no perfil, e a lacuna e o reaproveitamento vêm do domínio', () => {
    expect(EXPERIMENTAL_PROFILE).toMatchObject({
      hrrWeight: 0.75,
      motionWeight: 0.25,
      peaksPerMinuteScale: 90,
      intensityCeiling: 1.2,
      emaAlphaPer15s: 0.35,
      decayMinutes: 180,
      doseExponent: 1.6,
      doseScale: 120,
      restingDays: 14,
      gapMaxMs: 120_000,
      heartRateReuseMs: 45_000,
      chainLookbackMs: 120_000,
    })
    expect(Object.isFrozen(EXPERIMENTAL_PROFILE)).toBe(true)
  })
})

describe('assessWindow: invariantes', () => {
  it('saída finita entre 0 e 100', () => {
    for (const bpm of [20, 62, 118, 183, 300]) {
      const r = chain(40, bpm)
      expect(Number.isFinite(r.effortPercent)).toBe(true)
      expect(Number.isFinite(r.wearPercent)).toBe(true)
      expect(r.effortPercent).toBeGreaterThanOrEqual(0)
      expect(r.effortPercent).toBeLessThanOrEqual(100)
      expect(r.wearPercent).toBeGreaterThanOrEqual(0)
      expect(r.wearPercent).toBeLessThanOrEqual(100)
    }
  })

  it('mesmo input e mesma versão produzem o mesmo resultado', () => {
    expect(run()).toEqual(run())
    expect(chain(10, 130, 54)).toEqual(chain(10, 130, 54))
  })

  it('reproduz o exemplo calculado da pesquisa: 118 bpm, 54 picos por minuto, dose anterior 38', () => {
    // hrr = (118-62)/(183.5-62) = 0.461; motionIndex = 54/90 = 0.6;
    // intensidade = 0.75*0.461 + 0.25*0.6 = 0.496; esforço ~ 50.
    // Uma amostra só, 15 s depois do estado, com 13.5 picos (54/min * 0.25 min).
    const r = run({
      previous: { strainDose: 38, effortEma: null, lastHeartRate: null, lastSampleAtMs: sec(0) },
      samples: [sample(15, 118, 13.5)],
    })
    expect(r.effortPercent).toBe(50)
    // dose = 38*exp(-0.25/180) + 0.496^1.6 * 0.25 ~ 38.03; desgaste = 100*(1-exp(-38.03/120)) ~ 27
    expect(r.wearPercent).toBe(27)
    expect(r.motionAvailable).toBe(true)
  })

  it('ausência de BPM na janela devolve esforço indisponível, e o desgaste só decai', () => {
    // O silêncio começa 50 s depois da última leitura real, fora dos 45 s de
    // reaproveitamento: é a janela sem BPM aproveitável, não uma falha isolada.
    const before = chain(20, 140)
    const r = run({
      previous: before.nextState,
      samples: [sample(350, null), sample(355, null), sample(360, null)],
      window: { startMs: sec(345), endMs: sec(360) },
    })
    expect(r.effortPercent).toBeNull()
    expect(r.unavailableReason).toBe('no_heart_rate')
    expect(r.wearPercent).not.toBeNull()
    expect(r.wearPercent as number).toBeLessThanOrEqual(before.wearPercent as number)
  })

  it('BPM ausente com leitura anterior de até 45 s é reaproveitado, e fica registrado', () => {
    const before = run({ samples: [sample(15, 120)] })
    const r = run({
      previous: before.nextState,
      samples: [sample(30, null)],
      window: { startMs: sec(15), endMs: sec(30) },
    })
    expect(r.effortPercent).not.toBeNull()
    expect(r.reusedHeartRate).toBe(true)
  })

  it('BPM ausente com leitura anterior de mais de 45 s não é reaproveitado', () => {
    const before = run({ samples: [sample(15, 120)] })
    const r = run({
      previous: before.nextState,
      samples: [sample(61, null)],
      window: { startMs: sec(15), endMs: sec(61) },
    })
    expect(r.effortPercent).toBeNull()
    expect(r.reusedHeartRate).toBe(false)
  })

  it('aumento sustentado de HRR não reduz esforço', () => {
    const low = chain(20, 100)
    const high = chain(20, 150)
    expect(high.effortPercent as number).toBeGreaterThanOrEqual(low.effortPercent as number)
    expect(high.wearPercent as number).toBeGreaterThanOrEqual(low.wearPercent as number)
  })

  it('aumento sustentado de movimento não reduz esforço', () => {
    const still = chain(20, 118, 0)
    const moving = chain(20, 118, 20)
    expect(moving.effortPercent as number).toBeGreaterThanOrEqual(still.effortPercent as number)
  })

  it('sem movimento a intensidade é só HRR, e a linha diz que movimento não estava disponível', () => {
    const r = chain(4, 118, null)
    expect(r.motionAvailable).toBe(false)
    // 0.461 de HRR vira ~46, e não 0.75*0.461 = ~35: o peso é reponderado, não zerado.
    expect(r.effortPercent).toBe(46)
  })

  it('lacuna sem dado não aumenta desgaste: 20 minutos de silêncio só decaem', () => {
    // Quinze minutos a 165 bpm acumulam dose suficiente para os 20 minutos de
    // silêncio moverem o percentual inteiro, e não só a dose por baixo dele.
    const before = chain(60, 165)
    const r = run({
      previous: before.nextState,
      samples: [sample(900 + 20 * 60, 165)],
      window: { startMs: sec(900), endMs: sec(900 + 20 * 60) },
    })
    expect(r.wearPercent as number).toBeLessThan(before.wearPercent as number)
  })

  it('lacuna de até 120 s acrescenta dose; acima disso, não', () => {
    const before = chain(20, 150)
    const within = run({
      previous: before.nextState,
      samples: [sample(300 + 120, 150)],
      window: { startMs: sec(300), endMs: sec(420) },
    })
    const beyond = run({
      previous: before.nextState,
      samples: [sample(300 + 121, 150)],
      window: { startMs: sec(300), endMs: sec(421) },
    })
    expect(within.nextState.strainDose).toBeGreaterThan(beyond.nextState.strainDose)
  })

  it('repouso observado indisponível devolve tudo nulo com o motivo, sem apagar o estado', () => {
    const before = chain(5, 130)
    const r = run({
      previous: before.nextState,
      baseline: { kind: 'unavailable', reason: 'no_resting_baseline' },
      samples: steady(130, 75),
      window: { startMs: sec(75), endMs: sec(90) },
    })
    expect(r.effortPercent).toBeNull()
    expect(r.wearPercent).toBeNull()
    expect(r.unavailableReason).toBe('no_resting_baseline')
    expect(r.nextState.strainDose).toBeLessThanOrEqual(before.nextState.strainDose)
  })

  it('data de nascimento ausente é motivo próprio', () => {
    const r = run({ baseline: { kind: 'unavailable', reason: 'no_birth_date' } })
    expect(r.unavailableReason).toBe('no_birth_date')
  })

  it('zero fisiológico nunca representa ausência: BPM zero não é tratado como nulo', () => {
    // A faixa aceita pela ingestão começa em 20, então zero nunca chega aqui.
    // Se chegasse, a fórmula o trataria como leitura, e o esforço seria zero
    // com reason nulo, e não indisponível.
    const r = run({ samples: [sample(15, 0)] })
    expect(r.unavailableReason).toBeNull()
    expect(r.effortPercent).toBe(0)
  })

  it('a média móvel pesa pelo intervalo: dez leituras em 15 s não valem dez vezes uma', () => {
    const one = run({ samples: [sample(15, 150)] })
    const ten = run({
      samples: Array.from({ length: 10 }, (_, i) => sample(1.5 * (i + 1), 150)),
    })
    // Com alfa por amostra fixo, dez amostras levariam a média a ~99% de 150 bpm
    // e uma amostra a 35%. Com alfa por intervalo, as duas convergem.
    expect(Math.abs((one.effortPercent as number) - (ten.effortPercent as number))).toBeLessThanOrEqual(2)
  })

  it('o estado devolvido carrega o que a próxima janela precisa', () => {
    const r = run({ samples: [sample(5, 100), sample(15, 110, 3)] })
    expect(r.nextState).toEqual({
      strainDose: expect.any(Number),
      effortEma: expect.any(Number),
      lastHeartRate: { bpm: 110, atMs: sec(15) },
      lastSampleAtMs: sec(15),
    })
  })
})
