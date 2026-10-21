import {
  ageInYearsAt,
  baselineFor,
  calibratedBaselineFor,
  maxHeartRateForAge,
  MIN_RESERVE_BPM,
  PROVISIONAL_RESTING_DEFAULT_BPM,
  PROVISIONAL_RESTING_FLOOR_BPM,
  restingBaseline,
  restingFromDailyMinima,
} from './assessment-baseline'

// Repouso observado é o piso do monitorado, não repouso clínico; a mediana dos
// mínimos diários existe para um dia com leitura espúria não dominar duas
// semanas. A máxima é a de Tanaka; a idade é contada no calendário de Brasília,
// pela mesma pegadinha de fuso que o schema documenta para @db.Date.

describe('restingFromDailyMinima', () => {
  it('sem dia terminado com batimento, não há repouso observado', () => {
    expect(restingFromDailyMinima([])).toBeNull()
  })

  it('um dia só vale como mediana', () => {
    expect(restingFromDailyMinima([64])).toBe(64)
  })

  it('a mediana de quantidade ímpar é o do meio', () => {
    expect(restingFromDailyMinima([70, 20, 62])).toBe(62)
  })

  it('a mediana de quantidade par é a média dos dois do meio', () => {
    expect(restingFromDailyMinima([60, 64, 62, 70])).toBe(63)
  })

  it('um batimento espúrio de 20 num dia não domina a semana', () => {
    expect(restingFromDailyMinima([20, 60, 61, 62, 63, 64, 65])).toBe(62)
  })
})

// Repouso provisório: existe para esforço e desgaste aparecerem desde o
// primeiro uso. Ele nunca passa por cima de um dia terminado, nunca sobe além do
// teto e nunca desce abaixo do chão do alerta de batimento baixo.
describe('restingBaseline', () => {
  it('com dia terminado, é a mediana medida, e o que o dia em andamento mostrou não entra', () => {
    expect(restingBaseline({ endedDayMinima: [70, 20, 62], openDayMinima: [50], sessionMinBpm: 45 })).toEqual({
      restingBpm: 62,
      source: 'measured',
      days: 3,
    })
  })

  it('sem nada observado, o provisório é o teto padrão', () => {
    expect(restingBaseline({ endedDayMinima: [], openDayMinima: [], sessionMinBpm: null })).toEqual({
      restingBpm: PROVISIONAL_RESTING_DEFAULT_BPM,
      source: 'provisional',
      days: 0,
      from: 'default',
    })
  })

  it('o menor batimento do dia em andamento vale quando fica abaixo do teto', () => {
    expect(restingBaseline({ endedDayMinima: [], openDayMinima: [66, 58], sessionMinBpm: null })).toMatchObject({
      restingBpm: 58,
      from: 'open_day',
    })
  })

  it('o menor batimento da sessão vale quando é o menor de todos', () => {
    expect(restingBaseline({ endedDayMinima: [], openDayMinima: [58], sessionMinBpm: 55 })).toMatchObject({
      restingBpm: 55,
      from: 'session',
    })
  })

  it('mínimo observado acima do teto não sobe o repouso', () => {
    // Poucos minutos de uso em atividade dizem mais sobre o trabalho do que
    // sobre o repouso, e um repouso de 95 faria o esforço do dia sair baixo.
    expect(restingBaseline({ endedDayMinima: [], openDayMinima: [95], sessionMinBpm: 92 })).toMatchObject({
      restingBpm: PROVISIONAL_RESTING_DEFAULT_BPM,
      from: 'default',
    })
  })

  it('leitura abaixo do chão é espúria e fica fora', () => {
    expect(restingBaseline({ endedDayMinima: [], openDayMinima: [PROVISIONAL_RESTING_FLOOR_BPM - 1], sessionMinBpm: 20 })).toMatchObject({
      restingBpm: PROVISIONAL_RESTING_DEFAULT_BPM,
      from: 'default',
    })
    expect(restingBaseline({ endedDayMinima: [], openDayMinima: [], sessionMinBpm: PROVISIONAL_RESTING_FLOOR_BPM })).toMatchObject({
      restingBpm: PROVISIONAL_RESTING_FLOOR_BPM,
      from: 'session',
    })
  })
})

describe('ageInYearsAt', () => {
  it('conta anos completos no calendário de Brasília', () => {
    // Nasceu em `1991-05-10`. Em `2026-05-10T01:00Z` ainda é 09/05 em Brasília: 34 anos.
    expect(ageInYearsAt(new Date('1991-05-10T00:00:00.000Z'), new Date('2026-05-10T01:00:00.000Z'))).toBe(34)
    // Às 03:00Z já é 10/05 em Brasília: 35 anos.
    expect(ageInYearsAt(new Date('1991-05-10T00:00:00.000Z'), new Date('2026-05-10T03:00:00.000Z'))).toBe(35)
  })
})

describe('maxHeartRateForAge', () => {
  it('é 208 menos 0,7 vezes a idade', () => {
    expect(maxHeartRateForAge(35)).toBe(183.5)
  })
})

// A linha de base inteira, num lugar só: a avaliação do relógio e a esparsa da
// pulseira passam por aqui e não podem discordar sobre o repouso de ninguém.
describe('baselineFor', () => {
  const now = new Date('2026-10-20T15:00:00.000Z')

  it('sem data de nascimento, indisponível', () => {
    const r = baselineFor({ endedDayMinima: [60], openDayMinima: [], sessionMinBpm: null }, null, now)
    expect(r.baseline).toEqual({ kind: 'unavailable', reason: 'no_birth_date' })
    expect(r.resting.source).toBe('measured')
  })

  it('com data de nascimento, repouso medido e máxima de Tanaka', () => {
    const r = baselineFor(
      { endedDayMinima: [62, 58, 60], openDayMinima: [], sessionMinBpm: null },
      new Date('1991-05-10T00:00:00.000Z'),
      now,
    )
    expect(r.ageYears).toBe(35)
    expect(r.baseline).toEqual({ kind: 'available', restingBpm: 60, maxBpm: 208 - 0.7 * 35 })
  })
})

// A régua da calibração individual (revisão 2.0): repouso dos dias válidos e
// topo no pico habitual. Sem calibração, exatamente a de sempre.
describe('calibratedBaselineFor', () => {
  const now = new Date('2026-10-20T15:00:00.000Z')
  const birthDate = new Date('1991-05-10T00:00:00.000Z')
  const byAge = 208 - 0.7 * 35
  const restingInput = { endedDayMinima: [62, 58, 60], openDayMinima: [], sessionMinBpm: null }
  const noDays = { endedDayMinima: [], openDayMinima: [], sessionMinBpm: 64 }

  it('sem calibração, igual a baselineFor e o pico pela idade', () => {
    const r = calibratedBaselineFor(null, restingInput, birthDate, now)
    expect(r).toEqual({ ...baselineFor(restingInput, birthDate, now), peakSource: 'AGE' })
  })

  it('com calibração em mistura, repouso e pico da calibração', () => {
    const r = calibratedBaselineFor({ restingBpm: 58, peakBpm: 150, validDays: 12 }, noDays, birthDate, now)
    expect(r.baseline).toEqual({ kind: 'available', restingBpm: 58, maxBpm: 150 })
    expect(r.resting).toEqual({ restingBpm: 58, source: 'measured', days: 12 })
    expect(r.maxBpm).toBe(150)
    expect(r.ageYears).toBe(35)
    expect(r.peakSource).toBe('BLEND')
  })

  it('com 30 dias válidos, o pico é só pessoal', () => {
    const r = calibratedBaselineFor({ restingBpm: 58, peakBpm: 150, validDays: 30 }, noDays, birthDate, now)
    expect(r.peakSource).toBe('PERSONAL')
  })

  it('antes do 3º dia válido, o pico guardado ainda é a partida pela idade', () => {
    const r = calibratedBaselineFor({ restingBpm: 58, peakBpm: byAge, validDays: 2 }, noDays, birthDate, now)
    expect(r.peakSource).toBe('AGE')
    expect(r.maxBpm).toBe(byAge)
  })

  it('sem data de nascimento e sem pico, indisponível', () => {
    const r = calibratedBaselineFor({ restingBpm: 58, peakBpm: null, validDays: 4 }, noDays, null, now)
    expect(r.baseline).toEqual({ kind: 'unavailable', reason: 'no_birth_date' })
    expect(r.peakSource).toBe('AGE')
  })

  it('sem data de nascimento, com pico do 7º dia em diante, disponível e pessoal', () => {
    const r = calibratedBaselineFor({ restingBpm: 58, peakBpm: 150, validDays: 7 }, noDays, null, now)
    expect(r.baseline).toEqual({ kind: 'available', restingBpm: 58, maxBpm: 150 })
    expect(r.ageYears).toBeNull()
    expect(r.peakSource).toBe('PERSONAL')
  })

  it('calibração sem repouso usa o repouso do caminho de hoje', () => {
    const r = calibratedBaselineFor({ restingBpm: null, peakBpm: 150, validDays: 12 }, noDays, birthDate, now)
    expect(r.resting).toEqual({ restingBpm: 64, source: 'provisional', days: 0, from: 'session' })
    expect(r.baseline).toEqual({ kind: 'available', restingBpm: 64, maxBpm: 150 })
  })

  it('reserva menor que o mínimo cai na máxima pela idade', () => {
    const r = calibratedBaselineFor(
      { restingBpm: 80, peakBpm: 80 + MIN_RESERVE_BPM - 1, validDays: 30 },
      noDays,
      birthDate,
      now,
    )
    expect(r.baseline).toEqual({ kind: 'available', restingBpm: 80, maxBpm: byAge })
    expect(r.peakSource).toBe('AGE')
  })

  it('reserva menor que o mínimo e sem idade, indisponível', () => {
    const r = calibratedBaselineFor({ restingBpm: 80, peakBpm: 95, validDays: 30 }, noDays, null, now)
    expect(r.baseline).toEqual({ kind: 'unavailable', reason: 'no_birth_date' })
    expect(r.maxBpm).toBeNull()
    expect(r.peakSource).toBe('AGE')
  })

  it('reserva exatamente no mínimo ainda vale o pico', () => {
    const r = calibratedBaselineFor({ restingBpm: 80, peakBpm: 80 + MIN_RESERVE_BPM, validDays: 30 }, noDays, birthDate, now)
    expect(r.maxBpm).toBe(100)
    expect(r.peakSource).toBe('PERSONAL')
  })
})
