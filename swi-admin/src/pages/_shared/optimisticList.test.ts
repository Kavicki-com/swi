// vitest globals (describe/it/expect) via globals: true.
import { ancoraDe, reinserirAncorado } from './optimisticList'

const item = (id: string) => ({ id })
const ids = (lista: ReadonlyArray<{ id: string }>) => lista.map((x) => x.id)

const A = item('a')
const B = item('b')
const C = item('c')

describe('ancoraDe', () => {
  it('descreve a posição pelo vizinho anterior', () => {
    expect(ancoraDe([A, B, C], 'b')).toEqual({ pos: 1, anteriorId: 'a' })
  })

  it('o primeiro da lista não tem vizinho anterior', () => {
    expect(ancoraDe([A, B], 'a')).toEqual({ pos: 0, anteriorId: null })
  })

  // Quem não está na lista não foi removido dela, e o chamador precisa
  // distinguir isso de "estava na primeira posição".
  it('item ausente devolve pos -1', () => {
    expect(ancoraDe([A, B], 'z')).toEqual({ pos: -1, anteriorId: null })
  })
})

describe('reinserirAncorado', () => {
  it('devolve o item logo depois do vizinho', () => {
    expect(ids(reinserirAncorado([A, C], B, 'a'))).toEqual(['a', 'b', 'c'])
  })

  it('devolve ao topo quem era o primeiro', () => {
    expect(ids(reinserirAncorado([B, C], A, null))).toEqual(['a', 'b', 'c'])
  })

  // O ponto do módulo: a lista se deslocou durante o await (uma linha nova
  // chegou por refetch). Um índice guardado antes apontaria pro lugar errado; a
  // âncora continua certa.
  it('acerta a posição mesmo que a lista tenha se deslocado no meio do caminho', () => {
    const NOVO = item('novo')
    expect(ids(reinserirAncorado([NOVO, A, C], B, 'a'))).toEqual(['novo', 'a', 'b', 'c'])
  })

  it('não duplica quando um refetch já recolocou o item', () => {
    expect(ids(reinserirAncorado([A, B, C], B, 'a'))).toEqual(['a', 'b', 'c'])
  })

  // Sem âncora não há posição defensável, e o fim é o único lugar que não
  // mente sobre a ordem anterior.
  it('vizinho sumido joga pro fim em vez de inventar posição', () => {
    expect(ids(reinserirAncorado([C], B, 'a'))).toEqual(['c', 'b'])
  })

  it('não muta a lista recebida', () => {
    const original = [A, C]
    reinserirAncorado(original, B, 'a')
    expect(ids(original)).toEqual(['a', 'c'])
  })
})
