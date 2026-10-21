import { CALIBRATED_ALERT_PROFILE, EXPERIMENTAL_ALERT_PROFILE as PROFILE } from './alert-profile'
import {
  decideAttention,
  decideBandPressure,
  decideBattery,
  decideBloodPressure,
  decideHeartRate,
  decideOxygenAttention,
  decideOxygenLow,
  decidePressureCrisis,
  decideWear,
  decideWearSafety,
  episodesOf,
  heartRateLimits,
  type EngineSample,
  type Point,
} from './condition-engine'

// O motor é puro: recebe amostras, limites e um instante, e devolve decisões.
// Nada aqui lê banco nem relógio, e é isso que deixa regra temporal com
// histerese ser provada em instante fixo.

describe('heartRateLimits: cada regra cai no piso pela sua própria falta', () => {
  it('com máxima e repouso, as duas regras são personalizadas', () => {
    const limits = heartRateLimits(PROFILE, { maxBpm: 190, restingBpm: 62 })

    expect(limits.high).toEqual({ value: 171, rule: 'PERSONALIZED' })
    expect(limits.low).toEqual({ value: 47, rule: 'PERSONALIZED' })
  })

  it('sem máxima, BPM alto cai no piso e BPM baixo continua personalizado', () => {
    const limits = heartRateLimits(PROFILE, { maxBpm: null, restingBpm: 62 })

    expect(limits.high).toEqual({ value: 180, rule: 'FLOOR' })
    expect(limits.low).toEqual({ value: 47, rule: 'PERSONALIZED' })
  })

  it('sem repouso, BPM baixo cai no piso e BPM alto continua personalizado', () => {
    const limits = heartRateLimits(PROFILE, { maxBpm: 190, restingBpm: null })

    expect(limits.high).toEqual({ value: 171, rule: 'PERSONALIZED' })
    expect(limits.low).toEqual({ value: 40, rule: 'FLOOR' })
  })

  it('repouso com meio bpm produz limite inteiro: a mediana de dias pares tem casa decimal', () => {
    // restingFromDailyMinima devolve a média dos dois centrais quando o número
    // de dias fechados é par, então 62,5 é repouso possível. Sem arredondar, o
    // limite baixo sairia 47,5 e essa casa decimal iria para a coluna da
    // condição e para a tela. O limite alto já é arredondado; os dois têm de
    // se comportar igual.
    expect(heartRateLimits(PROFILE, { maxBpm: 190, restingBpm: 62.5 }).low).toEqual({
      value: 48,
      rule: 'PERSONALIZED',
    })
  })

  it('o piso é rede de segurança para quem não tem dado, e segura repouso absurdo', () => {
    // Máxima de alguém de 80 anos é 152; 90% dá 137, abaixo do piso de 180, e
    // fica: o piso não é teto para quem tem dado. Já repouso observado de 40
    // daria BPM baixo em 25, abaixo do piso de 40, e aí o piso segura.
    expect(heartRateLimits(PROFILE, { maxBpm: 152, restingBpm: 40 })).toEqual({
      high: { value: 137, rule: 'PERSONALIZED' },
      low: { value: 40, rule: 'FLOOR' },
    })
  })

  it('repouso que cruza a máxima por idade cai no piso: o limite baixo nunca alcança o alto', () => {
    // Repouso observado de 190 daria limite baixo 175 contra limite alto 165, e
    // um único 170 bpm satisfaria os dois predicados ao mesmo tempo, abrindo BPM
    // alto e BPM baixo juntos, com dois alertas que se contradizem sobre o mesmo
    // funcionário. Repouso acima da máxima por idade é dado poluído, não
    // fisiologia, então a personalização é descartada e o piso assume.
    const limits = heartRateLimits(PROFILE, { maxBpm: 183.5, restingBpm: 190 })

    expect(limits.high).toEqual({ value: 165, rule: 'PERSONALIZED' })
    expect(limits.low).toEqual({ value: 40, rule: 'FLOOR' })
  })

  it('limite baixo que empata com o alto também cai no piso', () => {
    // Empate é tão ruim quanto cruzamento: os dois predicados são fechados, então
    // um BPM exatamente no valor abriria as duas condições.
    expect(heartRateLimits(PROFILE, { maxBpm: 200, restingBpm: 195 }).low).toEqual({ value: 40, rule: 'FLOOR' })
  })
})

const NOW = Date.parse('2026-09-07T12:00:00.000Z')
const secondsAgo = (s: number) => NOW - s * 1000

/** Série a cada 5 s cobrindo os últimos `seconds`, com o BPM dado. */
const series = (seconds: number, bpm: number | ((i: number) => number)): EngineSample[] =>
  Array.from({ length: seconds / 5 + 1 }, (_, i) => ({
    atMs: secondsAgo(seconds - i * 5),
    heartRateBpm: typeof bpm === 'function' ? bpm(i) : bpm,
    batteryPercent: null,
  }))

const HIGH = { value: 171, rule: 'PERSONALIZED' as const }

describe('decideHeartRate: abre só com persistência coberta', () => {
  it('limite cruzado uma vez não abre', () => {
    const samples = series(60, (i) => (i === 6 ? 185 : 120))

    expect(decideHeartRate('HEART_RATE_HIGH', samples, HIGH, false, PROFILE, NOW)).toBeNull()
  })

  it('60 s acima do limite abrem, com o valor observado e a regra', () => {
    expect(decideHeartRate('HEART_RATE_HIGH', series(60, 185), HIGH, false, PROFILE, NOW)).toEqual({
      kind: 'HEART_RATE_HIGH',
      action: 'OPEN',
      observedValue: 185,
      threshold: HIGH,
    })
  })

  it('cobertura curta por lacuna não abre, mesmo com toda amostra acima', () => {
    // Duas amostras, 10 s de cobertura: a janela não está preenchida.
    const samples: EngineSample[] = [
      { atMs: secondsAgo(10), heartRateBpm: 185, batteryPercent: null },
      { atMs: secondsAgo(0), heartRateBpm: 185, batteryPercent: null },
    ]

    expect(decideHeartRate('HEART_RATE_HIGH', samples, HIGH, false, PROFILE, NOW)).toBeNull()
  })

  it('duas amostras nas pontas da janela não provam nada: o vão entre elas é grande demais', () => {
    // O intervalo entre a primeira e a última é 45 s e cumpre o mínimo, mas
    // entre as duas não há dado nenhum. Medir só as pontas deixava isto abrir:
    // duas amostras a 45 s de distância não provam 45 s de nada, pela mesma
    // razão que duas a 5 s não provam um minuto. É preciso um teto de vão
    // entre amostras consecutivas, e não só o comprimento do trecho.
    const samples: EngineSample[] = [
      { atMs: secondsAgo(50), heartRateBpm: 185, batteryPercent: null },
      { atMs: secondsAgo(5), heartRateBpm: 185, batteryPercent: null },
    ]

    expect(decideHeartRate('HEART_RATE_HIGH', samples, HIGH, false, PROFILE, NOW)).toBeNull()
  })

  it('vão de uma cadência perdida ainda abre: o teto tolera falha, não silêncio', () => {
    // Cadência de 5 s com duas amostras faltando no meio: vão de 15 s, no teto.
    const samples = series(60, 185).filter((_, i) => i !== 5 && i !== 6)

    expect(decideHeartRate('HEART_RATE_HIGH', samples, HIGH, false, PROFILE, NOW)?.action).toBe('OPEN')
  })

  it('amostra sem BPM não conta nem contra nem a favor', () => {
    const samples = series(60, 185).map((s, i) => (i % 2 === 0 ? { ...s, heartRateBpm: null } : s))

    // Sobram 6 amostras de 185 espaçadas de 10 s, cobrindo 50 s: abre.
    expect(decideHeartRate('HEART_RATE_HIGH', samples, HIGH, false, PROFILE, NOW)?.action).toBe('OPEN')
  })

  it('amostra fora da janela é ignorada', () => {
    const samples = [
      { atMs: secondsAgo(90), heartRateBpm: 40, batteryPercent: null },
      ...series(60, 185),
    ]

    expect(decideHeartRate('HEART_RATE_HIGH', samples, HIGH, false, PROFILE, NOW)?.action).toBe('OPEN')
  })
})

describe('decideHeartRate: histerese e recuperação', () => {
  it('ativa, BPM entre o limite e a banda não recupera', () => {
    // Limite 171, banda 10: 165 está abaixo do limite mas dentro da banda.
    expect(decideHeartRate('HEART_RATE_HIGH', series(60, 165), HIGH, true, PROFILE, NOW)).toBeNull()
  })

  it('ativa, 60 s abaixo do limite menos a banda recuperam', () => {
    expect(decideHeartRate('HEART_RATE_HIGH', series(60, 150), HIGH, true, PROFILE, NOW)).toEqual({
      kind: 'HEART_RATE_HIGH',
      action: 'RECOVER',
      observedValue: 150,
      threshold: HIGH,
    })
  })

  it('ativa, cobertura curta abaixo da banda não recupera ainda', () => {
    const samples: EngineSample[] = [
      { atMs: secondsAgo(10), heartRateBpm: 150, batteryPercent: null },
      { atMs: secondsAgo(0), heartRateBpm: 150, batteryPercent: null },
    ]

    expect(decideHeartRate('HEART_RATE_HIGH', samples, HIGH, true, PROFILE, NOW)).toBeNull()
  })

  it('ativa e ainda acima do limite: mantém, sem decisão', () => {
    expect(decideHeartRate('HEART_RATE_HIGH', series(60, 185), HIGH, true, PROFILE, NOW)).toBeNull()
  })

  it('BPM baixo é o espelho: abre abaixo, recupera acima do limite mais a banda', () => {
    const LOW = { value: 47, rule: 'PERSONALIZED' as const }

    expect(decideHeartRate('HEART_RATE_LOW', series(60, 42), LOW, false, PROFILE, NOW)?.action).toBe('OPEN')
    expect(decideHeartRate('HEART_RATE_LOW', series(60, 52), LOW, true, PROFILE, NOW)).toBeNull()
    expect(decideHeartRate('HEART_RATE_LOW', series(60, 60), LOW, true, PROFILE, NOW)?.action).toBe('RECOVER')
  })

  it('trava do admin: recupera pela recuperação gravada, não pela banda do perfil', () => {
    const CUSTOM = { value: 150, rule: 'SAFETY_CUSTOM' as const }

    // Banda do perfil daria 140; a trava gravada recupera abaixo de 145.
    expect(decideHeartRate('HEART_RATE_HIGH', series(60, 144), CUSTOM, true, PROFILE, NOW, 145)?.action).toBe('RECOVER')
    expect(decideHeartRate('HEART_RATE_HIGH', series(60, 146), CUSTOM, true, PROFILE, NOW, 145)).toBeNull()
  })
})

describe('decideBattery: uma leitura basta, banda de dez pontos', () => {
  it('abre em 15% com uma leitura', () => {
    expect(decideBattery(15, false, PROFILE)).toEqual({
      kind: 'DEVICE_BATTERY_LOW',
      action: 'OPEN',
      observedValue: 15,
      threshold: { value: 15, rule: 'FLOOR' },
    })
  })

  it('não abre em 16%', () => {
    expect(decideBattery(16, false, PROFILE)).toBeNull()
  })

  it('ativa, 20% não recupera: está dentro da banda', () => {
    expect(decideBattery(20, true, PROFILE)).toBeNull()
  })

  it('ativa, 26% recupera', () => {
    expect(decideBattery(26, true, PROFILE)?.action).toBe('RECOVER')
  })

  it('sem leitura de bateria não decide nada', () => {
    expect(decideBattery(null, false, PROFILE)).toBeNull()
    expect(decideBattery(null, true, PROFILE)).toBeNull()
  })
})

describe('decideWear: uma leitura da avaliação basta, banda de dez pontos', () => {
  it('abre em 80% com a régua de piso e o valor observado', () => {
    expect(decideWear(80, false, PROFILE)).toEqual({
      kind: 'WEAR_HIGH',
      action: 'OPEN',
      observedValue: 80,
      threshold: { value: 80, rule: 'FLOOR' },
    })
  })

  it('não abre em 79%', () => {
    expect(decideWear(79, false, PROFILE)).toBeNull()
  })

  it('ativa, 75% não recupera: está dentro da banda', () => {
    expect(decideWear(75, true, PROFILE)).toBeNull()
  })

  it('ativa, 69% recupera', () => {
    expect(decideWear(69, true, PROFILE)?.action).toBe('RECOVER')
  })

  it('sem avaliação com desgaste não decide nada', () => {
    expect(decideWear(null, false, PROFILE)).toBeNull()
    expect(decideWear(null, true, PROFILE)).toBeNull()
  })
})

describe('decideWearSafety: trava de desgaste do perfil calibrado', () => {
  const defaults = { openAt: 90, closeAt: 80 }

  it('abre em 90% com o rastro da trava; 89% não abre', () => {
    expect(decideWearSafety(90, defaults, false, 'SAFETY_DEFAULT')).toEqual({
      kind: 'WEAR_HIGH',
      action: 'OPEN',
      observedValue: 90,
      threshold: { value: 90, rule: 'SAFETY_DEFAULT' },
    })
    expect(decideWearSafety(89, defaults, false, 'SAFETY_DEFAULT')).toBeNull()
  })

  it('ativa, 80% mantém e 79% recupera', () => {
    expect(decideWearSafety(80, defaults, true, 'SAFETY_DEFAULT')).toBeNull()
    expect(decideWearSafety(79, defaults, true, 'SAFETY_CUSTOM')?.action).toBe('RECOVER')
  })

  it('sem avaliação com desgaste não decide nada', () => {
    expect(decideWearSafety(null, defaults, true, 'SAFETY_DEFAULT')).toBeNull()
  })
})

describe('decideBloodPressure: abre em 140 ou 90, recupera abaixo de 130 e 85', () => {
  it('sistólica 140 abre a revisão, e a régua gravada é a que cruzou', () => {
    // A régua não é nula: a coluna existe para a auditoria saber com que número
    // a condição abriu sem ter que recuperá-lo pela versão do perfil. Pressão
    // não se personaliza, então a regra é sempre FLOOR.
    expect(decideBloodPressure({ systolic: 140, diastolic: 80 }, false, PROFILE)).toEqual({
      kind: 'BLOOD_PRESSURE_REVIEW',
      action: 'OPEN',
      observedValue: 140,
      threshold: { value: 140, rule: 'FLOOR' },
    })
  })

  it('diastólica 90 abre, e o valor observado e a régua são os da que cruzou', () => {
    const decision = decideBloodPressure({ systolic: 120, diastolic: 90 }, false, PROFILE)

    expect(decision?.observedValue).toBe(90)
    expect(decision?.threshold).toEqual({ value: 90, rule: 'FLOOR' })
  })

  it('139 por 89 não abre', () => {
    expect(decideBloodPressure({ systolic: 139, diastolic: 89 }, false, PROFILE)).toBeNull()
  })

  it('ativa, 135 por 80 não recupera: sistólica ainda na banda', () => {
    expect(decideBloodPressure({ systolic: 135, diastolic: 80 }, true, PROFILE)).toBeNull()
  })

  it('ativa, 129 por 84 recupera', () => {
    expect(decideBloodPressure({ systolic: 129, diastolic: 84 }, true, PROFILE)?.action).toBe('RECOVER')
  })

  it('sem medição não decide nada', () => {
    expect(decideBloodPressure(null, true, PROFILE)).toBeNull()
  })
})

// Camada de Atenção (perfil calibrado): a faixa de fadiga da própria pessoa,
// com 10 min seguidos no relógio. Os pontos são genéricos (instante e valor)
// porque a mesma máquina serve ao batimento e ao desgaste.

const ATTENTION = CALIBRATED_ALERT_PROFILE.attention
const MIN = 60_000

/** Pontos de `fromMs` a `toMs` inclusive, a cada `stepMs`, todos com `value`. */
function pointSeries(fromMs: number, toMs: number, stepMs: number, value: number): Point[] {
  const out: Point[] = []
  for (let atMs = fromMs; atMs <= toMs; atMs += stepMs) out.push({ atMs, value })
  return out
}

describe('decideAttention: abre com a janela inteira na faixa, fecha na primeira leitura de volta', () => {
  const NOW = 100 * MIN

  it('10 min seguidos acima do corte abrem, com a régua da faixa e a última leitura', () => {
    const points = [...pointSeries(NOW - 10 * MIN, NOW - 5_000, 5_000, 130), { atMs: NOW, value: 135 }]

    expect(decideAttention('HEART_RATE_FATIGUE', points, 120, 'HIGHER_IS_WORSE', false, ATTENTION, NOW)).toEqual({
      kind: 'HEART_RATE_FATIGUE',
      action: 'OPEN',
      observedValue: 135,
      threshold: { value: 120, rule: 'BAND' },
    })
  })

  it('9 min na faixa não abrem: falta tempo', () => {
    const points = pointSeries(NOW - 9 * MIN, NOW, 5_000, 130)

    expect(decideAttention('HEART_RATE_FATIGUE', points, 120, 'HIGHER_IS_WORSE', false, ATTENTION, NOW)).toBeNull()
  })

  it('uma leitura fora da faixa no meio da janela zera a evidência', () => {
    const points = pointSeries(NOW - 10 * MIN, NOW, 5_000, 130).map((p) => (p.atMs === NOW - 5 * MIN ? { ...p, value: 110 } : p))

    expect(decideAttention('HEART_RATE_FATIGUE', points, 120, 'HIGHER_IS_WORSE', false, ATTENTION, NOW)).toBeNull()
  })

  it('vão maior que o permitido zera, mesmo com as pontas cobrindo a janela', () => {
    const points = pointSeries(NOW - 10 * MIN, NOW, 5_000, 130).filter(
      (p) => p.atMs < NOW - 5 * MIN || p.atMs > NOW - 5 * MIN + 15_000,
    )

    expect(decideAttention('HEART_RATE_FATIGUE', points, 120, 'HIGHER_IS_WORSE', false, ATTENTION, NOW)).toBeNull()
  })

  it('o corte faz parte da faixa de fadiga quando mais é pior', () => {
    const points = pointSeries(NOW - 10 * MIN, NOW, 5_000, 120)

    expect(decideAttention('WEAR_FATIGUE', points, 120, 'HIGHER_IS_WORSE', false, ATTENTION, NOW)?.action).toBe('OPEN')
  })

  it('quando menos é pior, abre abaixo do corte e o corte não faz parte da faixa', () => {
    expect(
      decideAttention('OXYGEN_FATIGUE', pointSeries(NOW - 10 * MIN, NOW, 5_000, 93), 94, 'LOWER_IS_WORSE', false, ATTENTION, NOW)
        ?.action,
    ).toBe('OPEN')
    expect(
      decideAttention('OXYGEN_FATIGUE', pointSeries(NOW - 10 * MIN, NOW, 5_000, 94), 94, 'LOWER_IS_WORSE', false, ATTENTION, NOW),
    ).toBeNull()
  })

  it('ativa, a primeira leitura de volta fecha, sem esperar janela', () => {
    const points = [...pointSeries(NOW - 10 * MIN, NOW - 5_000, 5_000, 130), { atMs: NOW, value: 110 }]

    expect(decideAttention('HEART_RATE_FATIGUE', points, 120, 'HIGHER_IS_WORSE', true, ATTENTION, NOW)).toEqual({
      kind: 'HEART_RATE_FATIGUE',
      action: 'RECOVER',
      observedValue: 110,
      threshold: { value: 120, rule: 'BAND' },
    })
  })

  it('ativa, com a última leitura ainda na faixa, mantém', () => {
    const points = [{ atMs: NOW - 5_000, value: 110 }, { atMs: NOW, value: 125 }]

    expect(decideAttention('HEART_RATE_FATIGUE', points, 120, 'HIGHER_IS_WORSE', true, ATTENTION, NOW)).toBeNull()
  })

  it('leitura depois do instante avaliado não conta', () => {
    const points = [{ atMs: NOW, value: 125 }, { atMs: NOW + 5_000, value: 110 }]

    expect(decideAttention('HEART_RATE_FATIGUE', points, 120, 'HIGHER_IS_WORSE', true, ATTENTION, NOW)).toBeNull()
  })

  it('sem leitura não decide nada', () => {
    expect(decideAttention('HEART_RATE_FATIGUE', [], 120, 'HIGHER_IS_WORSE', false, ATTENTION, NOW)).toBeNull()
    expect(decideAttention('HEART_RATE_FATIGUE', [], 120, 'HIGHER_IS_WORSE', true, ATTENTION, NOW)).toBeNull()
  })
})

describe('episodesOf: o lote da pulseira percorrido em ordem', () => {
  const HOLD = CALIBRATED_ALERT_PROFILE.sparseAttention.holdMs
  const GAP = CALIBRATED_ALERT_PROFILE.sparseAttention.maxGapMs
  const opens = (v: number) => v >= 120
  const recovers = (v: number) => v < 120
  const at = (minutes: number, value: number): Point => ({ atMs: minutes * MIN, value })

  it('episódio que abre e fecha dentro do lote', () => {
    const points = [at(0, 130), at(5, 130), at(10, 130), at(15, 110), at(20, 110)]

    expect(episodesOf(points, opens, recovers, HOLD, GAP, false, -1)).toEqual([
      { openedAtMs: 10 * MIN, recoveredAtMs: 15 * MIN, observedValue: 130 },
    ])
  })

  it('episódio ativo na última leitura fica sem recuperação', () => {
    const points = [at(0, 130), at(5, 130), at(10, 130), at(15, 135)]

    expect(episodesOf(points, opens, recovers, HOLD, GAP, false, -1)).toEqual([
      { openedAtMs: 10 * MIN, recoveredAtMs: null, observedValue: 130 },
    ])
  })

  it('não abre por falta de tempo na faixa', () => {
    const points = [at(0, 130), at(5, 130), at(10, 110)]

    expect(episodesOf(points, opens, recovers, HOLD, GAP, false, -1)).toEqual([])
  })

  it('vão maior que o permitido zera a sequência', () => {
    const points = [at(0, 130), at(11, 130), at(16, 130)]
    expect(episodesOf(points, opens, recovers, HOLD, GAP, false, -1)).toEqual([])

    // A sequência recomeça no ponto depois do vão e cobre 10 min a partir dele.
    expect(episodesOf([...points, at(21, 130)], opens, recovers, HOLD, GAP, false, -1)).toEqual([
      { openedAtMs: 21 * MIN, recoveredAtMs: null, observedValue: 130 },
    ])
  })

  it('trava com holdMs zero abre no primeiro ponto e recupera pela banda', () => {
    const points = [at(0, 150), at(5, 185), at(10, 175), at(15, 165)]

    expect(
      episodesOf(
        points,
        (v) => v >= 180,
        (v) => v < 170,
        0,
        GAP,
        false,
        -1,
      ),
    ).toEqual([{ openedAtMs: 5 * MIN, recoveredAtMs: 15 * MIN, observedValue: 185 }])
  })

  it('reabrir exige a janela inteira de novo', () => {
    const points = [at(0, 130), at(5, 130), at(10, 130), at(15, 110), at(20, 130), at(25, 130), at(30, 130)]

    expect(episodesOf(points, opens, recovers, HOLD, GAP, false, -1)).toEqual([
      { openedAtMs: 10 * MIN, recoveredAtMs: 15 * MIN, observedValue: 130 },
      { openedAtMs: 30 * MIN, recoveredAtMs: null, observedValue: 130 },
    ])
  })

  it('sinceMs suprime o episódio já registrado pelo lote anterior', () => {
    const points = [at(0, 130), at(5, 130), at(10, 130), at(15, 110), at(20, 130)]

    expect(episodesOf(points, opens, recovers, HOLD, GAP, false, 15 * MIN)).toEqual([])
  })

  it('os pontos antes de sinceMs semeiam a sequência que termina no lote novo', () => {
    const points = [at(0, 130), at(5, 130), at(10, 130)]

    expect(episodesOf(points, opens, recovers, HOLD, GAP, false, 5 * MIN)).toEqual([
      { openedAtMs: 10 * MIN, recoveredAtMs: null, observedValue: 130 },
    ])
  })

  it('ponto exatamente em sinceMs já foi avaliado e não abre', () => {
    const points = [at(0, 130), at(5, 130), at(10, 130)]

    expect(episodesOf(points, opens, recovers, HOLD, GAP, false, 10 * MIN)).toEqual([])
  })

  it('já ativa no começo, a recuperação no lote fecha o episódio sem abertura', () => {
    const points = [at(5, 130), at(10, 110), at(15, 130), at(20, 130), at(25, 130)]

    expect(episodesOf(points, opens, recovers, HOLD, GAP, true, 0)).toEqual([
      { openedAtMs: null, recoveredAtMs: 10 * MIN, observedValue: 110 },
      { openedAtMs: 25 * MIN, recoveredAtMs: null, observedValue: 130 },
    ])
  })

  it('já ativa e ainda na faixa no fim do lote: nada a registrar', () => {
    expect(episodesOf([at(5, 130), at(10, 130)], opens, recovers, HOLD, GAP, true, 0)).toEqual([])
  })

  it('já ativa, leitura de volta antes de sinceMs não fecha: o lote anterior a viu e deixou ativa', () => {
    expect(episodesOf([at(5, 110), at(15, 130)], opens, recovers, HOLD, GAP, true, 10 * MIN)).toEqual([])
  })

  it('pontos fora de ordem são percorridos em ordem', () => {
    const points = [at(15, 110), at(5, 130), at(10, 130), at(0, 130)]

    expect(episodesOf(points, opens, recovers, HOLD, GAP, false, -1)).toEqual([
      { openedAtMs: 10 * MIN, recoveredAtMs: 15 * MIN, observedValue: 130 },
    ])
  })
})

describe('decideBandPressure: uma medição na faixa de fadiga abre, as duas fora fecham', () => {
  const cuts = { systolic: 130, diastolic: 85 }

  it('sistólica no corte abre pela sistólica, com a régua da faixa', () => {
    expect(decideBandPressure({ systolic: 130, diastolic: 85 }, cuts, false)).toEqual({
      kind: 'BLOOD_PRESSURE_FATIGUE',
      action: 'OPEN',
      observedValue: 130,
      threshold: { value: 130, rule: 'BAND' },
    })
  })

  it('só a diastólica na faixa abre pela diastólica', () => {
    const decision = decideBandPressure({ systolic: 120, diastolic: 86 }, cuts, false)

    expect(decision?.observedValue).toBe(86)
    expect(decision?.threshold).toEqual({ value: 85, rule: 'BAND' })
  })

  it('129 por 84 não abre', () => {
    expect(decideBandPressure({ systolic: 129, diastolic: 84 }, cuts, false)).toBeNull()
  })

  it('ativa, 129 por 84 fecha; 129 por 86 mantém', () => {
    expect(decideBandPressure({ systolic: 129, diastolic: 84 }, cuts, true)).toEqual({
      kind: 'BLOOD_PRESSURE_FATIGUE',
      action: 'RECOVER',
      observedValue: 129,
      threshold: { value: 130, rule: 'BAND' },
    })
    expect(decideBandPressure({ systolic: 129, diastolic: 86 }, cuts, true)).toBeNull()
  })

  it('sem corte de sistólica, só a diastólica decide', () => {
    const onlyDiastolic = { systolic: null, diastolic: 85 }

    expect(decideBandPressure({ systolic: 200, diastolic: 80 }, onlyDiastolic, false)).toBeNull()
    expect(decideBandPressure({ systolic: 120, diastolic: 86 }, onlyDiastolic, false)?.observedValue).toBe(86)
    expect(decideBandPressure({ systolic: 200, diastolic: 80 }, onlyDiastolic, true)).toEqual({
      kind: 'BLOOD_PRESSURE_FATIGUE',
      action: 'RECOVER',
      observedValue: 80,
      threshold: { value: 85, rule: 'BAND' },
    })
  })

  it('sem corte nenhum ou sem medição não decide nada', () => {
    const none = { systolic: null, diastolic: null }

    expect(decideBandPressure({ systolic: 200, diastolic: 120 }, none, false)).toBeNull()
    expect(decideBandPressure({ systolic: 100, diastolic: 60 }, none, true)).toBeNull()
    expect(decideBandPressure(null, cuts, true)).toBeNull()
  })
})

describe('decidePressureCrisis: trava de pressão alta', () => {
  const defaults = CALIBRATED_ALERT_PROFILE.bloodPressureHigh

  it('180 de sistólica abre pela trava padrão', () => {
    expect(decidePressureCrisis({ systolic: 180, diastolic: 90 }, defaults, false, 'SAFETY_DEFAULT')).toEqual({
      kind: 'BLOOD_PRESSURE_HIGH',
      action: 'OPEN',
      observedValue: 180,
      threshold: { value: 180, rule: 'SAFETY_DEFAULT' },
    })
  })

  it('110 de diastólica abre pela diastólica; 179 por 109 não abre', () => {
    expect(decidePressureCrisis({ systolic: 150, diastolic: 110 }, defaults, false, 'SAFETY_DEFAULT')?.threshold).toEqual({
      value: 110,
      rule: 'SAFETY_DEFAULT',
    })
    expect(decidePressureCrisis({ systolic: 179, diastolic: 109 }, defaults, false, 'SAFETY_DEFAULT')).toBeNull()
  })

  it('ativa, recupera só com as duas abaixo da recuperação', () => {
    expect(decidePressureCrisis({ systolic: 165, diastolic: 95 }, defaults, true, 'SAFETY_DEFAULT')).toBeNull()
    expect(decidePressureCrisis({ systolic: 159, diastolic: 99 }, defaults, true, 'SAFETY_DEFAULT')?.action).toBe('RECOVER')
  })

  it('trava do admin vale no lugar do padrão, com o rastro de personalizada', () => {
    const custom = { systolicAt: 170, diastolicAt: 105, systolicRecoverBelow: 150, diastolicRecoverBelow: 95 }

    expect(decidePressureCrisis({ systolic: 170, diastolic: 80 }, custom, false, 'SAFETY_CUSTOM')?.threshold).toEqual({
      value: 170,
      rule: 'SAFETY_CUSTOM',
    })
  })

  it('sem medição não decide nada', () => {
    expect(decidePressureCrisis(null, defaults, true, 'SAFETY_DEFAULT')).toBeNull()
  })
})

describe('decideOxygenAttention: duas leituras seguidas na faixa, com tempo entre elas', () => {
  const APART = 10 * MIN

  it('duas leituras abaixo do corte com 12 min entre elas abrem', () => {
    expect(decideOxygenAttention(at(12, 92), at(0, 93), 94, false, APART)).toEqual({
      kind: 'OXYGEN_FATIGUE',
      action: 'OPEN',
      observedValue: 92,
      threshold: { value: 94, rule: 'BAND' },
    })
  })

  it('com 5 min entre elas não abre; com exatamente o mínimo abre', () => {
    expect(decideOxygenAttention(at(5, 92), at(0, 93), 94, false, APART)).toBeNull()
    expect(decideOxygenAttention(at(10, 92), at(0, 93), 94, false, APART)?.action).toBe('OPEN')
  })

  it('uma das duas no corte não abre: quando menos é pior, o corte é normal', () => {
    expect(decideOxygenAttention(at(12, 92), at(0, 94), 94, false, APART)).toBeNull()
  })

  it('sem a leitura anterior não abre', () => {
    expect(decideOxygenAttention(at(12, 92), null, 94, false, APART)).toBeNull()
  })

  it('ativa, a última de volta fecha; ainda na faixa mantém', () => {
    expect(decideOxygenAttention(at(12, 95), at(0, 92), 94, true, APART)).toEqual({
      kind: 'OXYGEN_FATIGUE',
      action: 'RECOVER',
      observedValue: 95,
      threshold: { value: 94, rule: 'BAND' },
    })
    expect(decideOxygenAttention(at(12, 93), at(0, 95), 94, true, APART)).toBeNull()
    expect(decideOxygenAttention(null, null, 94, true, APART)).toBeNull()
  })

  function at(minutes: number, value: number): Point {
    return { atMs: minutes * MIN, value }
  }
})

describe('decideOxygenLow: trava de oxigenação baixa', () => {
  const defaults = { openAt: CALIBRATED_ALERT_PROFILE.oxygenLow.openBelowPercent, closeAt: 92 }

  it('89% abre; 90% não abre', () => {
    expect(decideOxygenLow(89, defaults, false, 'SAFETY_DEFAULT')).toEqual({
      kind: 'OXYGEN_LOW',
      action: 'OPEN',
      observedValue: 89,
      threshold: { value: 90, rule: 'SAFETY_DEFAULT' },
    })
    expect(decideOxygenLow(90, defaults, false, 'SAFETY_DEFAULT')).toBeNull()
  })

  it('ativa, 92% mantém e 93% recupera', () => {
    expect(decideOxygenLow(92, defaults, true, 'SAFETY_DEFAULT')).toBeNull()
    expect(decideOxygenLow(93, defaults, true, 'SAFETY_CUSTOM')).toEqual({
      kind: 'OXYGEN_LOW',
      action: 'RECOVER',
      observedValue: 93,
      threshold: { value: 90, rule: 'SAFETY_CUSTOM' },
    })
  })

  it('sem leitura não decide nada', () => {
    expect(decideOxygenLow(null, defaults, true, 'SAFETY_DEFAULT')).toBeNull()
  })
})
