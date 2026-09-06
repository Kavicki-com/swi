import { ageInYearsAt, maxHeartRateForAge, restingFromDailyMinima } from './assessment-baseline'

// Repouso observado é o piso do monitorado, não repouso clínico; a mediana dos
// mínimos diários existe para um dia com leitura espúria não dominar duas
// semanas. A máxima é a de Tanaka; a idade é contada no calendário de Brasília,
// pela mesma pegadinha de fuso que o schema documenta para @db.Date.

describe('restingFromDailyMinima', () => {
  it('sem dia fechado com batimento, não há repouso observado', () => {
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

describe('ageInYearsAt', () => {
  it('conta anos completos no calendário de Brasília', () => {
    // Nasceu em 1991-05-10. Em 2026-05-10T01:00Z ainda é 09/05 em Brasília: 34 anos.
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
