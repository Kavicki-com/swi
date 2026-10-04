import { randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { parseIdempotencyKey, requestHash } from './idempotency-key'

const KEY = randomUUID()

describe('parseIdempotencyKey', () => {
  // Sem cabeçalho, o envio segue como sempre foi: o app instalado e o painel
  // não mandam chave e não podem passar a receber erro.
  it('sem cabeçalho ou em branco devolve undefined', () => {
    expect(parseIdempotencyKey(undefined)).toBeUndefined()
    expect(parseIdempotencyKey('')).toBeUndefined()
    expect(parseIdempotencyKey('   ')).toBeUndefined()
  })

  // A chave é guardada como texto: a mesma chave em caixa diferente tem de
  // cair no mesmo registro.
  it('UUID válido volta em minúsculas e sem espaço', () => {
    expect(parseIdempotencyKey(`  ${KEY.toUpperCase()} `)).toBe(KEY)
  })

  it('texto que não é UUID → 400', () => {
    expect(() => parseIdempotencyKey('abc')).toThrow(BadRequestException)
  })

  // O app gera UUID v4 aleatório. Um valor fixo (UUID nulo, o máximo ou um
  // v1 de relógio) indica gerador quebrado: aceitar faria o segundo envio
  // igual, legítimo, virar reenvio do primeiro em silêncio.
  it.each([
    ['nulo', '00000000-0000-0000-0000-000000000000'],
    ['máximo', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ['v1', 'c232ab00-9414-11ec-b3c8-9e6bdeced846'],
  ])('UUID que não é v4 (%s) → 400', (_caso, value) => {
    expect(() => parseIdempotencyKey(value)).toThrow(BadRequestException)
  })

  // O Express junta cabeçalho repetido com vírgula. Escolher um dos dois em
  // silêncio esconderia um erro do cliente.
  it('cabeçalho repetido (dois valores juntados) → 400', () => {
    expect(() => parseIdempotencyKey(`${KEY}, ${KEY}`)).toThrow(BadRequestException)
  })
})

describe('requestHash', () => {
  it('não depende da ordem das chaves do objeto', () => {
    expect(requestHash('report', { title: 'T', summary: 'S' })).toBe(requestHash('report', { summary: 'S', title: 'T' }))
  })

  it('não depende da ordem das chaves em objetos aninhados', () => {
    expect(requestHash('report', { a: { x: 1, y: 2 } })).toBe(requestHash('report', { a: { y: 2, x: 1 } }))
  })

  // Campo ausente e campo undefined são o mesmo envio: o DTO pode ou não
  // carregar a propriedade conforme o que o cliente mandou.
  it('campo undefined vale o mesmo que campo ausente', () => {
    expect(requestHash('report', { title: 'T', summary: undefined })).toBe(requestHash('report', { title: 'T' }))
  })

  it('muda com o escopo', () => {
    expect(requestHash('report', { body: 'x' })).not.toBe(requestHash('report.comment', { body: 'x' }))
  })

  it('muda com qualquer valor, inclusive a ordem de uma lista', () => {
    const base = requestHash('report', { title: 'T', imageKeys: ['a', 'b'] })
    expect(requestHash('report', { title: 'T2', imageKeys: ['a', 'b'] })).not.toBe(base)
    expect(requestHash('report', { title: 'T', imageKeys: ['b', 'a'] })).not.toBe(base)
  })

  // null é valor (mensagem sem imagem), distinto de ausência.
  it('null não é o mesmo que ausência', () => {
    expect(requestHash('chat.message', { body: 'x', imageKey: null })).not.toBe(requestHash('chat.message', { body: 'x' }))
  })
})
