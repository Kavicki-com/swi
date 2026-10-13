// describe/it/expect vêm dos globals do Vitest (globals: true), como no resto do painel.
import { clampPage, pageCountOf, pageSlice } from './pagination'

const list = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('pageCountOf', () => {
  it('arredonda pra cima e nunca fica abaixo de 1', () => {
    expect(pageCountOf(30, 25)).toBe(2)
    expect(pageCountOf(50, 25)).toBe(2)
    expect(pageCountOf(51, 25)).toBe(3)
    expect(pageCountOf(0, 25)).toBe(1)
  })
})

describe('clampPage', () => {
  it('prende a página na faixa [1, pageCount]', () => {
    expect(clampPage(0, 3)).toBe(1)
    expect(clampPage(5, 3)).toBe(3)
    expect(clampPage(2, 3)).toBe(2)
  })
})

describe('pageSlice', () => {
  it('fatia a página pedida', () => {
    expect(pageSlice(list(30), 1, 25)).toEqual(list(25))
    expect(pageSlice(list(30), 2, 25)).toEqual([25, 26, 27, 28, 29])
  })

  it('o tamanho da página muda quantos aparecem (MEL-04)', () => {
    expect(pageSlice(list(30), 1, 5)).toEqual([0, 1, 2, 3, 4])
    expect(pageSlice(list(30), 1, 100)).toEqual(list(30))
  })

  it('página fora de faixa cai na última, não devolve vazio à toa', () => {
    expect(pageSlice(list(30), 99, 25)).toEqual([25, 26, 27, 28, 29])
  })
})
