import { pointInPolygon, countWorkersInArea, type AreaVertex } from './evacuationArea'

// Área de evacuação: polígono [lng, lat]. O contador do painel conta quantos
// workers caem dentro do anel desenhado (ponto-em-polígono por ray casting).
describe('pointInPolygon', () => {
  // Quadrado de 2x2 graus centrado na origem (sentido não importa pro ray cast).
  const square: AreaVertex[] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]

  it('ponto no centro está dentro', () => {
    expect(pointInPolygon([0, 0], square)).toBe(true)
  })

  it('ponto fora está fora', () => {
    expect(pointInPolygon([2, 2], square)).toBe(false)
  })

  it('funciona com anel fechado (primeiro vértice repetido no fim)', () => {
    const closed: AreaVertex[] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ]
    expect(pointInPolygon([0.5, -0.5], closed)).toBe(true)
    expect(pointInPolygon([5, 5], closed)).toBe(false)
  })

  it('menos de 3 vértices nunca contém ponto', () => {
    expect(pointInPolygon([0, 0], [[-1, -1], [1, 1]])).toBe(false)
  })
})

describe('countWorkersInArea', () => {
  const square: AreaVertex[] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]
  const markers = [
    { id: 'in1', lng: 0, lat: 0 },
    { id: 'in2', lng: 0.5, lat: 0.5 },
    { id: 'out', lng: 3, lat: 3 },
  ]

  it('conta só os workers dentro do polígono', () => {
    expect(countWorkersInArea(markers, square)).toBe(2)
  })

  it('sem área → 0', () => {
    expect(countWorkersInArea(markers, null)).toBe(0)
    expect(countWorkersInArea(markers, [])).toBe(0)
  })
})
