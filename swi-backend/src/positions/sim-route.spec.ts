import {
  advance,
  distanceMeters,
  loopForWorker,
  MUSTER_POINT,
  stepToward,
  type SimState,
} from './sim-route'

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

// Evacuação: convergência em linha reta pro ponto de encontro.
describe('stepToward', () => {
  const from: [number, number] = [-46.631, -23.551]

  it('cada passo REDUZ a distância até o alvo', () => {
    let cur = from
    let last = distanceMeters(cur, MUSTER_POINT)
    for (let i = 0; i < 5; i++) {
      cur = stepToward(cur, MUSTER_POINT, 3, 1.4)
      const d = distanceMeters(cur, MUSTER_POINT)
      expect(d).toBeLessThan(last)
      last = d
    }
  })

  it('clampa EXATAMENTE no alvo sem overshoot (e fica lá)', () => {
    let cur = from
    // Passos gigantes: chega e não passa do ponto.
    for (let i = 0; i < 10; i++) cur = stepToward(cur, MUSTER_POINT, 600, 1.4)
    expect(cur).toEqual(MUSTER_POINT)
    expect(stepToward(cur, MUSTER_POINT, 3, 1.4)).toEqual(MUSTER_POINT)
  })

  it('é determinístico', () => {
    expect(stepToward(from, MUSTER_POINT, 3, 1.4)).toEqual(stepToward(from, MUSTER_POINT, 3, 1.4))
  })
})

describe('distanceMeters / MUSTER_POINT', () => {
  it('muster fica dentro da área do site', () => {
    expect(MUSTER_POINT[0]).toBeGreaterThan(-46.7)
    expect(MUSTER_POINT[0]).toBeLessThan(-46.55)
    expect(MUSTER_POINT[1]).toBeGreaterThan(-23.6)
    expect(MUSTER_POINT[1]).toBeLessThan(-23.5)
  })

  it('distância equiretangular bate a escala esperada (~111 m por 0.001° de lat)', () => {
    const d = distanceMeters([-46.63, -23.55], [-46.63, -23.549])
    expect(d).toBeGreaterThan(100)
    expect(d).toBeLessThan(120)
  })
})
