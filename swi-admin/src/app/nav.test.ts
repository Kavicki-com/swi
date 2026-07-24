import { NAV_ITEMS } from './nav'

describe('NAV_ITEMS', () => {
  it('tem Tarefas apontando pra /tasks', () => {
    const tarefas = NAV_ITEMS.find((i) => i.label === 'Tarefas')
    expect(tarefas?.value).toBe('/tasks')
  })

  // A sidebar inteira usa variante _filled; Tarefas era a exceção (outline)
  // porque o DS não tinha assignment_filled — entrou no 0.1.117 (decisão do
  // designer 2026-07-24: clipboard preenchido, export Figma).
  it('todo item usa variante _filled (fim da exceção do Tarefas)', () => {
    for (const item of NAV_ITEMS) {
      expect(item.icon, `${item.label} usa ${item.icon}`).toMatch(/_filled$/)
    }
  })

  // Figma 1606-11583 @1366px: Tarefas é o ÚLTIMO item da sidebar, logo depois
  // de Configurações e imediatamente acima da seção de chat.
  it('Tarefas é o último item, depois de Configurações (ordem do Figma)', () => {
    const labels = NAV_ITEMS.map((i) => i.label)
    expect(labels[labels.length - 1]).toBe('Tarefas')
    expect(labels.indexOf('Tarefas')).toBe(labels.indexOf('Configurações') + 1)
  })
})
