// Rascunho da área de evacuação: vetorização sequencial com fechamento
// obrigatório. Puro, sem mapa: a tela só despacha estas transições.
import {
  addVertex,
  canClose,
  closeDraft,
  EMPTY_DRAFT,
  isReady,
  moveVertex,
  undoDraft,
  type AreaDraft,
} from './areaDraft'
import type { AreaVertex } from './evacuationArea'

const A: AreaVertex = [-46.64, -23.53]
const B: AreaVertex = [-46.6, -23.52]
const C: AreaVertex = [-46.58, -23.55]
const D: AreaVertex = [-46.62, -23.57]

const open = (...vs: AreaVertex[]): AreaDraft => vs.reduce(addVertex, EMPTY_DRAFT)

describe('areaDraft', () => {
  it('adiciona pontos em sequência com o trajeto aberto', () => {
    expect(open(A, B)).toEqual({ vertices: [A, B], closed: false })
  })

  it('não fecha com menos de três pontos', () => {
    expect(canClose(open(A, B))).toBe(false)
    expect(closeDraft(open(A, B))).toEqual(open(A, B))
  })

  it('fecha com três pontos ou mais', () => {
    expect(canClose(open(A, B, C))).toBe(true)
    expect(closeDraft(open(A, B, C))).toEqual({ vertices: [A, B, C], closed: true })
  })

  it('trajeto fechado não aceita ponto novo', () => {
    const closed = closeDraft(open(A, B, C))
    expect(addVertex(closed, D)).toBe(closed)
    expect(canClose(closed)).toBe(false)
  })

  it('desfazer com o trajeto fechado reabre sem perder ponto', () => {
    expect(undoDraft(closeDraft(open(A, B, C)))).toEqual({ vertices: [A, B, C], closed: false })
  })

  it('desfazer com o trajeto aberto tira o último ponto', () => {
    expect(undoDraft(open(A, B, C))).toEqual({ vertices: [A, B], closed: false })
    expect(undoDraft(EMPTY_DRAFT)).toEqual(EMPTY_DRAFT)
  })

  it('arrastar troca só o vértice indicado e mantém o fechamento', () => {
    const moved = moveVertex(closeDraft(open(A, B, C)), 1, D)
    expect(moved).toEqual({ vertices: [A, D, C], closed: true })
  })

  it('só fica pronto fechado e com três pontos ou mais', () => {
    expect(isReady(open(A, B, C))).toBe(false)
    expect(isReady(closeDraft(open(A, B, C)))).toBe(true)
  })
})
