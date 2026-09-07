import { EXPERIMENTAL_ALERT_PROFILE as PROFILE } from './alert-profile'
import {
  decideBattery,
  decideBloodPressure,
  decideHeartRate,
  heartRateLimits,
  type EngineSample,
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

describe('decideBloodPressure: abre em 140 ou 90, recupera abaixo de 130 e 85', () => {
  it('sistólica 140 abre a revisão', () => {
    expect(decideBloodPressure({ systolic: 140, diastolic: 80 }, false, PROFILE)).toEqual({
      kind: 'BLOOD_PRESSURE_REVIEW',
      action: 'OPEN',
      observedValue: 140,
      threshold: null,
    })
  })

  it('diastólica 90 abre, e o valor observado é a que cruzou', () => {
    expect(decideBloodPressure({ systolic: 120, diastolic: 90 }, false, PROFILE)?.observedValue).toBe(90)
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
