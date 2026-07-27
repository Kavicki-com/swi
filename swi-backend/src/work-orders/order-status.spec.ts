import { orderStatus, orderProgressPct, orderTimeProgressPct, distributeMinutes } from './order-status'

describe('orderStatus (recompute puro do pai)', () => {
  it('todos done → done', () => {
    expect(orderStatus(['done', 'done'])).toBe('done')
  })
  it('nenhum começado → pending', () => {
    expect(orderStatus(['pending', 'pending'])).toBe('pending')
  })
  it('misto → in_progress (paused e done contam como começado)', () => {
    expect(orderStatus(['pending', 'in_progress'])).toBe('in_progress')
    expect(orderStatus(['pending', 'paused'])).toBe('in_progress')
    expect(orderStatus(['pending', 'done'])).toBe('in_progress')
  })
  it('lista vazia → pending (invariante ≥1 item torna isso inalcançável)', () => {
    expect(orderStatus([])).toBe('pending')
  })
})

describe('orderProgressPct (done ÷ total)', () => {
  it('conta done sobre total, arredondado', () => {
    expect(orderProgressPct(['done', 'pending', 'pending'])).toBe(33)
    expect(orderProgressPct(['done', 'done'])).toBe(100)
    expect(orderProgressPct(['pending'])).toBe(0)
  })
})

describe('orderTimeProgressPct (decorrido ÷ estimado)', () => {
  const NOW = new Date('2026-07-26T12:00:00.000Z').getTime()
  const item = (over: Partial<Parameters<typeof orderTimeProgressPct>[0][number]> = {}) => ({
    status: 'pending' as const,
    startedAt: null,
    accumulatedSeconds: 0,
    estimatedMinutes: null,
    ...over,
  })

  it('soma o tempo bancado dos itens contra a estimativa do pai', () => {
    // 30min de 100min = 30%.
    expect(
      orderTimeProgressPct(
        [item({ accumulatedSeconds: 900 }), item({ accumulatedSeconds: 900 })],
        100,
        NOW,
      ),
    ).toBe(30)
  })

  it('item EM ANDAMENTO conta o tempo desde startedAt (é o que faz a barra andar)', () => {
    const rodando = item({
      status: 'in_progress',
      startedAt: new Date(NOW - 10 * 60_000),   // 10min atrás
      accumulatedSeconds: 300,                  // + 5min já bancados
    })
    // 15min de 60 = 25%.
    expect(orderTimeProgressPct([rodando], 60, NOW)).toBe(25)
  })

  it('estoura em 100 em vez de passar (tarefa que demorou mais que o previsto)', () => {
    expect(orderTimeProgressPct([item({ accumulatedSeconds: 99_999 })], 10, NOW)).toBe(100)
  })

  it('sem estimativa do pai, cai na soma dos itens', () => {
    expect(
      orderTimeProgressPct([item({ accumulatedSeconds: 1800, estimatedMinutes: 60 })], null, NOW),
    ).toBe(50)
  })

  it('sem estimativa nenhuma devolve 0 (não existe % honesto)', () => {
    expect(orderTimeProgressPct([item({ accumulatedSeconds: 1800 })], null, NOW)).toBe(0)
    expect(orderTimeProgressPct([], 60, NOW)).toBe(0)
  })

  it('relógio atrás de startedAt não gera progresso negativo', () => {
    const futuro = item({ status: 'in_progress', startedAt: new Date(NOW + 60_000) })
    expect(orderTimeProgressPct([futuro], 60, NOW)).toBe(0)
  })
})

describe('distributeMinutes (rateio determinístico)', () => {
  it('preserva a soma, resto nos primeiros', () => {
    expect(distributeMinutes(480, 4)).toEqual([120, 120, 120, 120])
    expect(distributeMinutes(100, 3)).toEqual([34, 33, 33])
  })
  it('total null → nulls; n=0 → []', () => {
    expect(distributeMinutes(null, 2)).toEqual([null, null])
    expect(distributeMinutes(480, 0)).toEqual([])
  })
})
