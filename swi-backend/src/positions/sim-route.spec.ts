import { advance, loopForWorker, type SimState } from './sim-route'

// Núcleo PURO do simulador dev de posições: anda um ponto ao longo de uma
// polilinha fechada em passos de tempo. Determinístico — sem Date/random.
describe('loopForWorker', () => {
  it('gera um loop fechado com pelo menos 3 vértices dentro da área do site', () => {
    const route = loopForWorker(0)
    expect(route.length).toBeGreaterThanOrEqual(3)
    for (const [lng, lat] of route) {
      expect(lng).toBeGreaterThan(-46.7)
      expect(lng).toBeLessThan(-46.55)
      expect(lat).toBeGreaterThan(-23.6)
      expect(lat).toBeLessThan(-23.5)
    }
  })

  it('workers diferentes ganham loops deslocados (não empilha todo mundo no mesmo pixel)', () => {
    expect(loopForWorker(0)).not.toEqual(loopForWorker(1))
  })
})

describe('advance', () => {
  const square: [number, number][] = [
    [-46.63, -23.55],
    [-46.629, -23.55],
    [-46.629, -23.549],
    [-46.63, -23.549],
  ]

  it('avança ao longo do segmento proporcional a velocidade × tempo', () => {
    const s0: SimState = { seg: 0, t: 0 }
    const { pos, state } = advance(square, s0, 10, 1.4) // 14 m em ~102 m de segmento
    expect(state.seg).toBe(0)
    expect(state.t).toBeGreaterThan(0)
    expect(state.t).toBeLessThan(1)
    // Andou pra leste (lng cresce), lat constante no primeiro segmento.
    expect(pos[0]).toBeGreaterThan(-46.63)
    expect(pos[1]).toBeCloseTo(-23.55, 6)
  })

  it('transborda pro próximo segmento e dá a volta no loop (wrap)', () => {
    let state: SimState = { seg: 0, t: 0 }
    // Passo gigante: percorre o loop inteiro várias vezes sem estourar índice.
    for (let i = 0; i < 10; i++) ({ state } = advance(square, state, 600, 1.4))
    expect(state.seg).toBeGreaterThanOrEqual(0)
    expect(state.seg).toBeLessThan(square.length)
    expect(state.t).toBeGreaterThanOrEqual(0)
    expect(state.t).toBeLessThan(1)
  })

  it('é determinístico: mesmo estado + mesmo dt → mesma posição', () => {
    const a = advance(square, { seg: 1, t: 0.5 }, 30, 1.4)
    const b = advance(square, { seg: 1, t: 0.5 }, 30, 1.4)
    expect(a).toEqual(b)
  })
})
