import type { Prisma } from '@prisma/client'
import { heartRateReferenceOf } from './heart-rate-reference'

// O JSON de entradas é escrito pelo serviço de avaliação e lido aqui sem
// contrato de tipo: o banco aceita qualquer formato, e linha antiga pode não
// ter o de hoje. O que estes casos protegem é a tradução do formato atual e a
// recusa calma de todo o resto, sem exceção que derrube a leitura do perfil.

const AT = '2026-10-20T15:00:00.000Z'
const inputs = (baseline: Prisma.JsonValue) => ({ profile: {}, chain: {}, baseline })

describe('heartRateReferenceOf', () => {
  it('repouso medido traz os dias da mediana e a máxima pela idade', () => {
    expect(
      heartRateReferenceOf(inputs({ restingBpm: 58, source: 'measured', days: 9, ageYears: 40, maxBpm: 180 }), AT),
    ).toEqual({ restingBpm: 58, restingSource: 'MEASURED', provisionalFrom: null, measuredDays: 9, maxBpm: 180, computedAt: AT })
  })

  it.each([
    ['open_day', 'OPEN_DAY'],
    ['session', 'SESSION'],
    ['default', 'DEFAULT'],
  ])('repouso provisório diz de onde veio (%s)', (from, expected) => {
    const ref = heartRateReferenceOf(
      inputs({ restingBpm: 70, source: 'provisional', provisionalFrom: from, days: 0, ageYears: 30, maxBpm: 187 }),
      AT,
    )
    expect(ref?.restingSource).toBe('PROVISIONAL')
    expect(ref?.provisionalFrom).toBe(expected)
    expect(ref?.measuredDays).toBe(0)
  })

  it('sem data de nascimento o repouso continua e a máxima fica nula', () => {
    const ref = heartRateReferenceOf(inputs({ restingBpm: 64, source: 'measured', days: 3, ageYears: null, maxBpm: null }), AT)
    expect(ref?.restingBpm).toBe(64)
    expect(ref?.maxBpm).toBeNull()
  })

  it.each(['AGE', 'BLEND', 'PERSONAL'])('com calibração, diz de onde veio o topo da régua (%s)', (peakSource) => {
    const ref = heartRateReferenceOf(
      inputs({ restingBpm: 58, source: 'measured', days: 12, ageYears: 35, maxBpm: 150, peakSource }),
      AT,
    )
    expect(ref?.maxBpm).toBe(150)
    expect(ref?.peakSource).toBe(peakSource)
  })

  it('linha antiga ou origem do pico desconhecida: a referência vale, sem a origem do pico', () => {
    const old = heartRateReferenceOf(inputs({ restingBpm: 58, source: 'measured', days: 9, maxBpm: 180 }), AT)
    const odd = heartRateReferenceOf(inputs({ restingBpm: 58, source: 'measured', days: 9, maxBpm: 180, peakSource: 'x' }), AT)
    expect(old).not.toHaveProperty('peakSource')
    expect(odd).not.toBeNull()
    expect(odd).not.toHaveProperty('peakSource')
  })

  it('máxima fracionária sai com uma casa', () => {
    // 208 - 0,7 * 33 = 184,9 em ponto flutuante vira 184.89999999999998.
    const ref = heartRateReferenceOf(inputs({ restingBpm: 60, source: 'measured', days: 2, ageYears: 33, maxBpm: 208 - 0.7 * 33 }), AT)
    expect(ref?.maxBpm).toBe(184.9)
  })

  it.each([
    ['inputs nulo', null],
    ['sem baseline', { profile: {} }],
    ['baseline não objeto', inputs('x')],
    ['repouso ausente', inputs({ source: 'measured', days: 1, maxBpm: 180 })],
    ['repouso não numérico', inputs({ restingBpm: '60', source: 'measured', days: 1, maxBpm: 180 })],
    ['origem desconhecida', inputs({ restingBpm: 60, source: 'guess', days: 1, maxBpm: 180 })],
    // Medido sai sempre da mediana de pelo menos um dia terminado: sem dias
    // inteiros e positivos a linha não é do formato que o serviço grava.
    ['medido sem dias', inputs({ restingBpm: 60, source: 'measured', maxBpm: 180 })],
    ['medido com dias não numéricos', inputs({ restingBpm: 60, source: 'measured', days: '3', maxBpm: 180 })],
    ['medido com zero dias', inputs({ restingBpm: 60, source: 'measured', days: 0, maxBpm: 180 })],
    ['medido com dias negativos', inputs({ restingBpm: 60, source: 'measured', days: -2, maxBpm: 180 })],
    ['medido com dias fracionários', inputs({ restingBpm: 60, source: 'measured', days: 2.5, maxBpm: 180 })],
    ['provisório sem origem conhecida', inputs({ restingBpm: 70, source: 'provisional', provisionalFrom: 'x', days: 0 })],
    // Nome herdado de Object.prototype: só as três origens gravadas valem.
    ['provisório com origem herdada', inputs({ restingBpm: 70, source: 'provisional', provisionalFrom: 'toString', days: 0 })],
    ['array', [1, 2]],
  ])('formato inesperado devolve nulo, nunca exceção (%s)', (_label, json) => {
    expect(heartRateReferenceOf(json as never, AT)).toBeNull()
  })
})
