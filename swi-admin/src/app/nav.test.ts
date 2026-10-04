import { formatBadgeCount, NAV_ITEMS, withBadges } from './nav'

describe('NAV_ITEMS', () => {
  it('tem Tarefas apontando pra /tasks', () => {
    const tarefas = NAV_ITEMS.find((i) => i.label === 'Tarefas')
    expect(tarefas?.value).toBe('/tasks')
  })

  // A sidebar inteira usa a variante _filled, sem exceção. Tarefas depende de
  // `assignment_filled`, que existe a partir do DS 0.1.117.
  it('todo item da sidebar usa a variante _filled', () => {
    for (const item of NAV_ITEMS) {
      expect(item.icon, `${item.label} usa ${item.icon}`).toMatch(/_filled$/)
    }
  })

  it('tem Câmeras apontando pra /cameras, com o ícone de câmera', () => {
    const cameras = NAV_ITEMS.find((i) => i.label === 'Câmeras')
    expect(cameras?.value).toBe('/cameras')
    expect(cameras?.icon).toBe('video_camera_filled')
  })

  // Tarefas vem logo depois de Configurações, e Câmeras logo abaixo de
  // Tarefas, como último item, imediatamente acima da seção de chat.
  it('Câmeras é o último item, depois de Tarefas, que vem depois de Configurações', () => {
    const labels = NAV_ITEMS.map((i) => i.label)
    expect(labels[labels.length - 1]).toBe('Câmeras')
    expect(labels.indexOf('Câmeras')).toBe(labels.indexOf('Tarefas') + 1)
    expect(labels.indexOf('Tarefas')).toBe(labels.indexOf('Configurações') + 1)
  })
})

describe('formatBadgeCount', () => {
  it('zero → sem badge (nada a avisar)', () => {
    expect(formatBadgeCount(0)).toBeUndefined()
  })

  it('contagem pequena aparece exata', () => {
    expect(formatBadgeCount(1)).toBe('1')
    expect(formatBadgeCount(9)).toBe('9')
  })

  it('acima de 9 satura em "+9" (o pino é pequeno demais pra 3 dígitos)', () => {
    expect(formatBadgeCount(10)).toBe('+9')
    expect(formatBadgeCount(147)).toBe('+9')
  })

  it('negativo/NaN não vira badge', () => {
    expect(formatBadgeCount(-1)).toBeUndefined()
    expect(formatBadgeCount(Number.NaN)).toBeUndefined()
  })
})

describe('withBadges', () => {
  it('undefined NÃO marca o item — badge só existe com contagem real', () => {
    const items = withBadges({ '/reports': undefined })
    expect(items.find((i) => i.value === '/reports')?.badge).toBeUndefined()
  })

  it('marca só o item pedido', () => {
    const items = withBadges({ '/reports': '3' })
    expect(items.find((i) => i.value === '/reports')?.badge).toBe('3')
    expect(items.find((i) => i.value === '/alerts')?.badge).toBeUndefined()
  })
})
