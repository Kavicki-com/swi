import {
  ageInYearsAt,
  maxHeartRateForAge,
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
