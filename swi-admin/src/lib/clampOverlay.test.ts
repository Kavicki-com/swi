import { clampOverlay } from './clampOverlay'

describe('clampOverlay, eixo horizontal', () => {
  it('com espaço, o cartão nasce ao lado do pino', () => {
    expect(clampOverlay({ anchor: 100, offset: 8, size: 600, container: 1200 })).toBe(108)
  })

  it('perto da borda direita, encosta o cartão na borda sem cortar', () => {
    expect(clampOverlay({ anchor: 1100, offset: 8, size: 600, container: 1200 })).toBe(600)
  })

  it('mapa mais estreito que o cartão, alinha à esquerda', () => {
    expect(clampOverlay({ anchor: 300, offset: 8, size: 600, container: 400 })).toBe(0)
  })

  it('sem medida ainda, não mexe', () => {
    expect(clampOverlay({ anchor: 1100, offset: 8, size: 0, container: 0 })).toBe(1108)
  })

  it('o que sobra para fora do fim da caixa também fica dentro do mapa', () => {
    expect(
      clampOverlay({ anchor: 1100, offset: 8, size: 600, container: 1200, overhangEnd: 10 }),
    ).toBe(590)
  })
})

describe('clampOverlay, eixo vertical', () => {
  it('com espaço, o cartão sobe acima do pino', () => {
    expect(clampOverlay({ anchor: 300, offset: -120, size: 200, container: 600 })).toBe(180)
  })

  it('pino perto do topo, encosta o cartão na borda de cima sem cortar', () => {
    expect(clampOverlay({ anchor: 40, offset: -120, size: 200, container: 600 })).toBe(0)
  })

  it('pino perto do topo, o que sobra acima da caixa também fica dentro do mapa', () => {
    expect(
      clampOverlay({ anchor: 40, offset: -120, size: 200, container: 600, overhangStart: 10 }),
    ).toBe(10)
  })

  it('pino perto da base, encosta o cartão na borda de baixo', () => {
    expect(clampOverlay({ anchor: 580, offset: -120, size: 200, container: 600 })).toBe(400)
  })

  it('mapa mais baixo que o cartão, alinha no topo', () => {
    expect(clampOverlay({ anchor: 100, offset: -120, size: 700, container: 600 })).toBe(0)
  })

  it('sem medida ainda, não mexe', () => {
    expect(clampOverlay({ anchor: 40, offset: -120, size: 0, container: 0 })).toBe(-80)
  })
})
