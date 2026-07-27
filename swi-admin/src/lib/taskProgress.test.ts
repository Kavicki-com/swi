// vitest globals (describe/it/expect) via globals: true — importar de 'vitest'
// duplicaria a instância e quebraria o registro do suite (ver formatAge.test.ts).
import {
  formatElapsed,
  hasRunningItem,
  taskElapsedSeconds,
  taskTimeProgressPct,
  type TimedItem,
} from './taskProgress'

// Espelho de swi-backend/src/work-orders/order-status.spec.ts: as duas contas
// precisam bater, senão a barra pula ao trocar o snapshot do fetch pelo valor
// recalculado no tick.
const NOW = new Date('2026-07-26T12:00:00.000Z').getTime()
const item = (over: Partial<TimedItem> = {}): TimedItem => ({
  status: 'pending',
  startedAt: null,
  accumulatedSeconds: 0,
  estimatedMinutes: null,
  ...over,
})

describe('taskTimeProgressPct', () => {
  it('soma o tempo bancado contra a estimativa da tarefa', () => {
    expect(
      taskTimeProgressPct(
        [item({ accumulatedSeconds: 900 }), item({ accumulatedSeconds: 900 })],
        100,
        NOW,
      ),
    ).toBe(30)
  })

  it('item em andamento conta desde startedAt — é o que faz a barra andar', () => {
    const rodando = item({
      status: 'in_progress',
      startedAt: new Date(NOW - 10 * 60_000).toISOString(),
      accumulatedSeconds: 300,
    })
    expect(taskTimeProgressPct([rodando], 60, NOW)).toBe(25)
    // e um segundo depois o valor é maior — a barra não fica congelada
    expect(taskTimeProgressPct([rodando], 60, NOW + 60_000)).toBeGreaterThan(25)
  })

  it('estoura em 100 em vez de passar', () => {
    expect(taskTimeProgressPct([item({ accumulatedSeconds: 99_999 })], 10, NOW)).toBe(100)
  })

  it('sem estimativa da tarefa, cai na soma dos itens', () => {
    expect(
      taskTimeProgressPct([item({ accumulatedSeconds: 1800, estimatedMinutes: 60 })], null, NOW),
    ).toBe(50)
  })

  it('sem estimativa nenhuma devolve 0 (não existe % honesto)', () => {
    expect(taskTimeProgressPct([item({ accumulatedSeconds: 1800 })], null, NOW)).toBe(0)
    expect(taskTimeProgressPct([], 60, NOW)).toBe(0)
  })

  it('startedAt no futuro não gera progresso negativo', () => {
    const futuro = item({ status: 'in_progress', startedAt: new Date(NOW + 60_000).toISOString() })
    expect(taskTimeProgressPct([futuro], 60, NOW)).toBe(0)
  })
})

describe('taskElapsedSeconds + formatElapsed (o "quanto tempo passou" da tela)', () => {
  it('soma o bancado de todos os itens', () => {
    expect(
      taskElapsedSeconds(
        [item({ accumulatedSeconds: 900 }), item({ accumulatedSeconds: 26 })],
        NOW,
      ),
    ).toBe(926)
  })

  it('inclui o tempo corrido do item em andamento', () => {
    const rodando = item({
      status: 'in_progress',
      startedAt: new Date(NOW - 90_000).toISOString(), // 1min30 atrás
      accumulatedSeconds: 30,
    })
    expect(taskElapsedSeconds([rodando], NOW)).toBe(120)
  })

  it('formata em h:mm:ss com os segundos visíveis (é o que mostra o tempo correndo)', () => {
    expect(formatElapsed(26)).toBe('0:00:26')
    expect(formatElapsed(926)).toBe('0:15:26')
    expect(formatElapsed(3600)).toBe('1:00:00')
    expect(formatElapsed(0)).toBe('0:00:00')
  })

  it('não formata tempo negativo', () => {
    expect(formatElapsed(-5)).toBe('0:00:00')
  })
})

describe('hasRunningItem (decide se a tela precisa do tick de 1s)', () => {
  it('true só com item em andamento COM âncora', () => {
    expect(
      hasRunningItem([item({ status: 'in_progress', startedAt: new Date(NOW).toISOString() })]),
    ).toBe(true)
    expect(hasRunningItem([item({ status: 'in_progress' })])).toBe(false) // sem startedAt não corre
    expect(hasRunningItem([item({ status: 'paused', accumulatedSeconds: 60 })])).toBe(false)
    expect(hasRunningItem([])).toBe(false)
  })
})
