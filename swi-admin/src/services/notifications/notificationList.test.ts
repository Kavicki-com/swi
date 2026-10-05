import type { NotificationDto } from '@/services/api/notifications'
import {
  initialNotifications,
  unreadCount,
  withArrival,
  withFailure,
  withLocalRead,
  withReadSettled,
  withResponse,
} from './notificationList'

const n = (id: string, over: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  title: `Batimento alto: ${id}`,
  body: '130 bpm, acima do limite de 120 bpm.',
  domain: 'health',
  targetId: `cond-${id}`,
  read: false,
  createdAt: '2026-10-05T12:00:00.000Z',
  ...over,
})

const ids = (s: { items: NotificationDto[] }) => s.items.map((i) => i.id)

describe('withResponse', () => {
  it('a primeira leitura deixa a lista pronta, mais nova primeiro', () => {
    const s = withResponse(initialNotifications(), {
      request: 1,
      askedArrival: 0,
      items: [
        n('a', { createdAt: '2026-10-05T10:00:00.000Z' }),
        n('b', { createdAt: '2026-10-05T11:00:00.000Z' }),
      ],
    })
    expect(s.status).toBe('ready')
    expect(ids(s)).toEqual(['b', 'a'])
  })

  it('notificação de chat fica fora: o chat tem contador próprio', () => {
    const s = withResponse(initialNotifications(), {
      request: 1,
      askedArrival: 0,
      items: [n('a'), n('c', { domain: 'chat' })],
    })
    expect(ids(s)).toEqual(['a'])
  })

  it('resposta de um pedido mais velho que o último aplicado é descartada', () => {
    let s = withResponse(initialNotifications(), {
      request: 2,
      askedArrival: 0,
      items: [n('novo')],
    })
    s = withResponse(s, { request: 1, askedArrival: 0, items: [n('velho')] })
    expect(ids(s)).toEqual(['novo'])
  })

  it('o que chegou pelo socket depois do envio do pedido fica', () => {
    let s = withResponse(initialNotifications(), { request: 1, askedArrival: 0, items: [n('a')] })
    const asked = s.arrivalCount
    s = withArrival(s, n('chegou', { createdAt: '2026-10-05T12:05:00.000Z' }))
    s = withResponse(s, { request: 2, askedArrival: asked, items: [n('a')] })
    expect(ids(s)).toEqual(['chegou', 'a'])
  })

  it('o que chegou antes do envio e não veio na resposta sai', () => {
    let s = withArrival(initialNotifications(), n('antigo'))
    s = withResponse(s, { request: 1, askedArrival: s.arrivalCount, items: [n('a')] })
    expect(ids(s)).toEqual(['a'])
  })

  it('a resposta vale para o que veio nela, inclusive o estado de lida', () => {
    let s = withArrival(initialNotifications(), n('a'))
    s = withResponse(s, { request: 1, askedArrival: 0, items: [n('a', { read: true })] })
    expect(s.items[0]!.read).toBe(true)
  })

  it('marca de lida ainda sem confirmação do servidor vale sobre a resposta', () => {
    let s = withResponse(initialNotifications(), { request: 1, askedArrival: 0, items: [n('a')] })
    s = withLocalRead(s, ['a'])
    s = withResponse(s, {
      request: 2,
      askedArrival: s.arrivalCount,
      items: [n('a', { read: false })],
    })
    expect(s.items[0]!.read).toBe(true)
  })

  it('guarda no máximo 200, as mais novas', () => {
    const many = Array.from({ length: 205 }, (_, i) =>
      n(`x${i}`, { createdAt: new Date(Date.UTC(2026, 9, 5, 0, i)).toISOString() }),
    )
    const s = withResponse(initialNotifications(), { request: 1, askedArrival: 0, items: many })
    expect(s.items).toHaveLength(200)
    expect(s.items[0]!.id).toBe('x204')
  })
})

describe('withArrival', () => {
  it('entra no topo, sem duplicar a mesma notificação', () => {
    let s = withResponse(initialNotifications(), { request: 1, askedArrival: 0, items: [n('a')] })
    s = withArrival(s, n('b', { createdAt: '2026-10-05T12:01:00.000Z' }))
    s = withArrival(s, n('b', { createdAt: '2026-10-05T12:01:00.000Z' }))
    expect(ids(s)).toEqual(['b', 'a'])
  })

  it('chat pelo socket também fica fora', () => {
    const s = withArrival(initialNotifications(), n('c', { domain: 'chat' }))
    expect(s.items).toEqual([])
  })

  it('cada chegada conta, para a releitura saber o que veio depois', () => {
    const s = withArrival(withArrival(initialNotifications(), n('a')), n('b'))
    expect(s.arrivalCount).toBe(2)
  })
})

describe('withFailure', () => {
  it('falha antes de qualquer leitura deixa a lista em falha', () => {
    expect(withFailure(initialNotifications(), 1).status).toBe('failed')
  })

  it('falha numa releitura mantém a lista que está na tela', () => {
    const s = withResponse(initialNotifications(), { request: 1, askedArrival: 0, items: [n('a')] })
    const after = withFailure(s, 2)
    expect(after.status).toBe('ready')
    expect(ids(after)).toEqual(['a'])
  })
})

describe('marcar como lida', () => {
  it('marca na hora e conta uma não lida a menos', () => {
    let s = withResponse(initialNotifications(), {
      request: 1,
      askedArrival: 0,
      items: [n('a'), n('b')],
    })
    expect(unreadCount(s)).toBe(2)
    s = withLocalRead(s, ['a'])
    expect(unreadCount(s)).toBe(1)
  })

  it('confirmada, a marca sai quando chega leitura pedida depois da confirmação', () => {
    let s = withResponse(initialNotifications(), { request: 1, askedArrival: 0, items: [n('a')] })
    s = withReadSettled(withLocalRead(s, ['a']), ['a'], true, 1)
    expect(s.items[0]!.read).toBe(true)
    s = withResponse(s, { request: 2, askedArrival: 0, items: [n('a', { read: true })] })
    expect(s.pendingRead.size).toBe(0)
    expect(s.items[0]!.read).toBe(true)
  })

  // A leitura saiu antes de o servidor gravar a marca e chegou depois da
  // confirmação: ela ainda diz "não lida", e a marca segue valendo.
  it('leitura que saiu antes da confirmação e chega depois não desfaz a lida', () => {
    let s = withResponse(initialNotifications(), { request: 1, askedArrival: 0, items: [n('a')] })
    s = withReadSettled(withLocalRead(s, ['a']), ['a'], true, 2)
    s = withResponse(s, { request: 2, askedArrival: 0, items: [n('a', { read: false })] })
    expect(s.items[0]!.read).toBe(true)
    expect(s.pendingRead.size).toBe(1)
  })

  it('recusada pelo servidor, volta a não lida', () => {
    let s = withResponse(initialNotifications(), { request: 1, askedArrival: 0, items: [n('a')] })
    s = withReadSettled(withLocalRead(s, ['a']), ['a'], false, 1)
    expect(s.pendingRead.size).toBe(0)
    expect(s.items[0]!.read).toBe(false)
  })
})
