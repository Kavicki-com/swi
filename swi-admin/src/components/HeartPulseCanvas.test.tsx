// Comportamento do traçado de batimento do menu de usuário. O jsdom não
// implementa canvas, então `getContext('2d')` é substituído por um dublê que
// registra o que foi desenhado, é o único jeito de afirmar o FORMATO da onda
// (linha de base longa, pico R alto, degraus de Q/S) em vez de só montar o
// componente.
//
// O relógio é fixado por teste: a fase do ciclo sai de Date.now(), então cada
// trecho da onda (P, Q, R, S, T) é escolhido pela fração de segundo.
import { render } from '@testing-library/react'
import { HeartPulseCanvas } from './HeartPulseCanvas'

type Ponto = { x: number; y: number }

const desenho = {
  pontos: [] as Ponto[],
  limpezas: 0,
  traços: 0,
  strokeStyle: '' as string,
  shadowColor: '' as string,
  escala: [] as Array<[number, number]>,
}

function fakeContext() {
  return {
    scale: (x: number, y: number) => {
      desenho.escala.push([x, y])
    },
    clearRect: () => {
      desenho.limpezas += 1
    },
    beginPath: () => {
      desenho.pontos.length = 0
    },
    moveTo: (x: number, y: number) => {
      desenho.pontos.push({ x, y })
    },
    lineTo: (x: number, y: number) => {
      desenho.pontos.push({ x, y })
    },
    stroke: () => {
      desenho.traços += 1
      desenho.strokeStyle = contexto.strokeStyle
      desenho.shadowColor = contexto.shadowColor
    },
    lineWidth: 0,
    lineJoin: '',
    strokeStyle: '',
    shadowBlur: 0,
    shadowColor: '',
  }
}

let contexto = fakeContext()
// Devolver null simula um browser sem suporte a 2d, o componente tem que
// desistir sem quebrar.
let contextoDisponivel = true

// Um único quadro por render: o rAF real nunca para, e o objetivo aqui é
// inspecionar o traçado de UM instante conhecido.
let quadrosPendentes: FrameRequestCallback[] = []

beforeEach(() => {
  vi.useFakeTimers()
  contexto = fakeContext()
  contextoDisponivel = true
  quadrosPendentes = []
  desenho.pontos = []
  desenho.limpezas = 0
  desenho.traços = 0
  desenho.strokeStyle = ''
  desenho.shadowColor = ''
  desenho.escala = []

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => (contextoDisponivel ? contexto : null) as unknown as CanvasRenderingContext2D,
  )
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    quadrosPendentes.push(cb)
    return quadrosPendentes.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Monta o componente num instante escolhido e roda UM quadro.
 * `fase` é a fração do ciclo cardíaco (0 a 1). Com bpm 60 o ciclo dura
 * exatamente 1 s, então a fase é a própria fração de segundo do relógio.
 */
function desenharEm(fase: number, props: Partial<Parameters<typeof HeartPulseCanvas>[0]> = {}) {
  vi.setSystemTime(new Date(10_000_000 + Math.round(fase * 1000)))
  const view = render(
    <HeartPulseCanvas color="#65D040" width={100} height={80} step={2} bpm={60} {...props} />,
  )
  quadrosPendentes.shift()?.(0)
  return view
}

/** Ponto recém-plotado: entra em x = width e recua um passo antes do traçado. */
const ultimoY = () => desenho.pontos[desenho.pontos.length - 1]?.y

describe('HeartPulseCanvas: formato da onda', () => {
  it('fora dos complexos, a linha fica na altura de repouso', () => {
    desenharEm(0.6)

    expect(ultimoY()).toBe(40)
  })

  it('a onda P sobe um degrau curto no início do ciclo', () => {
    desenharEm(0.07)

    expect(ultimoY()).toBe(15)
  })

  it('Q desce logo antes do pico', () => {
    desenharEm(0.21)

    expect(ultimoY()).toBe(65)
  })

  it('o pico R é limitado para não sair pelo topo do canvas', () => {
    desenharEm(0.23)

    // Sem o limite, o valor seria 40 - 120 = -80, fora da área desenhável.
    expect(ultimoY()).toBe(4)
  })

  it('S desce logo depois do pico', () => {
    desenharEm(0.25)

    expect(ultimoY()).toBe(65)
  })

  it('a onda T sobe um degrau largo no fim do ciclo', () => {
    desenharEm(0.4)

    expect(ultimoY()).toBe(5)
  })

  it('nenhum ponto do traçado escapa da área desenhável', () => {
    desenharEm(0.23)

    const ys = desenho.pontos.map((p) => p.y)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...ys)).toBeLessThanOrEqual(76)
  })

  it('o traçado nasce preenchido, com mais de um batimento visível', () => {
    desenharEm(0.6)

    // Largura 100 com passo 2: a semeadura cobre a tela inteira em vez de
    // começar vazia e ir enchendo.
    expect(desenho.pontos.length).toBeGreaterThan(45)
  })
})

describe('HeartPulseCanvas: desenho e ciclo de vida', () => {
  it('cada quadro limpa a tela antes de traçar', () => {
    desenharEm(0.6)

    expect(desenho.limpezas).toBe(1)
    expect(desenho.traços).toBe(1)
  })

  it('usa a cor recebida no traço e no brilho quando não há cor de brilho', () => {
    desenharEm(0.6, { color: '#084614' })

    expect(desenho.strokeStyle).toBe('#084614')
    expect(desenho.shadowColor).toBe('#084614')
  })

  it('cor de brilho própria não sobrescreve a cor do traço', () => {
    desenharEm(0.6, { color: '#084614', glowColor: '#FFFFFF' })

    expect(desenho.strokeStyle).toBe('#084614')
    expect(desenho.shadowColor).toBe('#FFFFFF')
  })

  it('o canvas é redimensionado pela densidade de pixels da tela', () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const { container } = desenharEm(0.6)
    const canvas = container.querySelector('canvas')!

    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(160)
    expect(canvas.style.width).toBe('100px')
    expect(desenho.escala[0]).toEqual([2, 2])
  })

  it('sem contexto 2d, não desenha nada em vez de quebrar', () => {
    contextoDisponivel = false

    expect(() => desenharEm(0.6)).not.toThrow()
    expect(desenho.traços).toBe(0)
  })

  it('o traçado é decorativo e fica fora da leitura de tela', () => {
    const { container } = desenharEm(0.6)

    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden')
  })
})
