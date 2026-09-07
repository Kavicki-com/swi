import { EXPERIMENTAL_PROFILE } from './assessment-profile'
import { samplesOf, simulate, steadyStateWear } from './fatigue-simulator'
import { CONTROLLED_SESSIONS } from './fixtures/controlled-sessions'

// Simulador determinístico: gera a série de amostras de um cenário e corre a
// fórmula em janelas de 15 s, encadeando o estado. Serve para três coisas: as
// propriedades abaixo, os fixtures fixados e a varredura de parâmetros do
// Step 4 do plano. Nada aqui é dado real.

const BASELINE = { kind: 'available' as const, restingBpm: 62, maxBpm: 183.5 }

const finalOf = (name: keyof typeof CONTROLLED_SESSIONS) => {
  const trace = simulate(CONTROLLED_SESSIONS[name].scenario, EXPERIMENTAL_PROFILE, BASELINE)
  return trace[trace.length - 1]
}

// O relógio do simulador tem de andar a duração do trecho, e não só até a
// última amostra que coube nele. Trecho cuja duração não é múltipla da cadência
// comprimia a linha do tempo e deslocava todos os trechos seguintes, então o
// cenário escrito não era o cenário simulado.
describe('samplesOf: o tempo anda a duração do trecho', () => {
  it('trecho de 7 s com cadência 5 empurra o trecho seguinte para 7 s, não para 5 s', () => {
    const samples = samplesOf({
      cadenceSec: 5,
      segments: [
        [7, 140, 60],
        [10, null, null],
      ],
    })

    expect(samples.map((s) => s.atMs)).toEqual([5_000, 12_000, 17_000])
    expect(samples.map((s) => s.heartRateBpm)).toEqual([140, null, null])
  })

  it('trecho menor que a cadência não emite amostra, mas avança o tempo', () => {
    const samples = samplesOf({
      cadenceSec: 5,
      segments: [
        [3, 140, null],
        [10, 150, null],
      ],
    })

    expect(samples.map((s) => s.atMs)).toEqual([8_000, 13_000])
  })
})

describe('simulate: propriedades entre cenários', () => {
  it('desgaste cresce com a intensidade do cenário: repouso < leve < moderado < intenso', () => {
    const rest = finalOf('rest').wearPercent as number
    const light = finalOf('light').wearPercent as number
    const moderate = finalOf('moderate').wearPercent as number
    const intense = finalOf('intense').wearPercent as number
    expect(rest).toBeLessThan(light)
    expect(light).toBeLessThan(moderate)
    expect(moderate).toBeLessThan(intense)
  })

  it('recuperação reduz o desgaste em relação ao fim do trecho intenso', () => {
    const trace = simulate(CONTROLLED_SESSIONS.recovery.scenario, EXPERIMENTAL_PROFILE, BASELINE)
    const peak = Math.max(...trace.map((w) => w.wearPercent ?? 0))
    expect(trace[trace.length - 1].wearPercent as number).toBeLessThan(peak)
  })

  it('perda de sinal deixa esforço indisponível e não aumenta desgaste', () => {
    const trace = simulate(CONTROLLED_SESSIONS.signalLoss.scenario, EXPERIMENTAL_PROFILE, BASELINE)
    const silent = trace.filter((w) => w.unavailableReason === 'no_heart_rate')
    expect(silent.length).toBeGreaterThan(0)
    for (let i = 1; i < trace.length; i++) {
      if (trace[i].unavailableReason === 'no_heart_rate') {
        expect(trace[i].wearPercent as number).toBeLessThanOrEqual(trace[i - 1].wearPercent as number)
      }
    }
  })

  it('backlog não gera avaliação: o cenário produz zero janelas', () => {
    expect(simulate(CONTROLLED_SESSIONS.backlog.scenario, EXPERIMENTAL_PROFILE, BASELINE)).toEqual([])
  })

  it('o mesmo cenário produz a mesma trilha', () => {
    expect(finalOf('moderate')).toEqual(finalOf('moderate'))
  })
})

describe('varredura de parâmetros (Step 4 do plano): não ajustar para produzir alerta', () => {
  it('intensidade constante 1,0 estabiliza perto de 77,7 por cento de desgaste', () => {
    expect(steadyStateWear(1.0, EXPERIMENTAL_PROFILE)).toBeCloseTo(77.7, 0)
  })

  it('80 por cento exige intensidade acima de aproximadamente 1,0445', () => {
    expect(steadyStateWear(1.044, EXPERIMENTAL_PROFILE)).toBeLessThan(80)
    expect(steadyStateWear(1.046, EXPERIMENTAL_PROFILE)).toBeGreaterThan(80)
  })

  it('no teto de intensidade 1,2 o desgaste estabiliza abaixo de 87 por cento', () => {
    expect(steadyStateWear(EXPERIMENTAL_PROFILE.intensityCeiling, EXPERIMENTAL_PROFILE)).toBeLessThan(87)
  })
})

describe('fixtures fixados', () => {
  // Valores gerados uma vez pelo próprio simulador e colados no fixture. Mudar
  // a fórmula ou o perfil quebra aqui de propósito: é a decisão ficando visível.
  it.each(Object.entries(CONTROLLED_SESSIONS))('%s termina como o fixture diz', (_, fixture) => {
    const trace = simulate(fixture.scenario, EXPERIMENTAL_PROFILE, BASELINE)
    const last = trace[trace.length - 1] ?? null
    expect(last === null ? null : { effort: last.effortPercent, wear: last.wearPercent }).toEqual(fixture.expectedFinal)
  })
})
