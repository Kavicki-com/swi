import { vi } from 'vitest'
import type { NotificationDto } from '@/services/api/notifications'
import type { ServiceResponse } from '@/services/types'
import { createNotificationsStore } from './notificationsStore'

const n = (id: string, over: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  title: `Batimento alto: ${id}`,
  body: '',
  domain: 'health',
  targetId: null,
  read: false,
  createdAt: '2026-10-05T12:00:00.000Z',
  ...over,
})

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void }
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const okList = (items: NotificationDto[]): ServiceResponse<NotificationDto[]> => ({
  data: items,
  error: null,
})
const failed = <T>(): ServiceResponse<T> => ({ data: null, error: { message: 'falhou' } })
const done: ServiceResponse<null> = { data: null, error: null }

function setup() {
  const lists: Deferred<ServiceResponse<NotificationDto[]>>[] = []
  let push: ((n: NotificationDto) => void) | null = null
  const unsubscribe = vi.fn()
  const api = {
    list: vi.fn(() => {
      const d = deferred<ServiceResponse<NotificationDto[]>>()
      lists.push(d)
      return d.promise
    }),
    markRead: vi.fn(async (_id: string) => done),
    markAllRead: vi.fn(async () => done),
  }
  const store = createNotificationsStore({
    api,
    subscribe: (cb) => {
      push = cb
      return unsubscribe
    },
  })
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { store, api, lists, push: (x: NotificationDto) => push!(x), unsubscribe, flush }
}

describe('createNotificationsStore', () => {
  it('ao ligar, assina o socket e faz a primeira leitura', async () => {
    const t = setup()
    t.store.start()
    expect(t.api.list).toHaveBeenCalledTimes(1)
    t.lists[0]!.resolve(okList([n('a')]))
    await t.flush()
    expect(t.store.getState().status).toBe('ready')
    expect(t.store.getState().items.map((i) => i.id)).toEqual(['a'])
  })

  it('releituras pedidas durante uma leitura viram uma só, depois dela', async () => {
    const t = setup()
    t.store.start()
    t.store.refresh()
    t.store.refresh()
    expect(t.api.list).toHaveBeenCalledTimes(1)
    t.lists[0]!.resolve(okList([]))
    await t.flush()
    expect(t.api.list).toHaveBeenCalledTimes(2)
    t.lists[1]!.resolve(okList([]))
    await t.flush()
    expect(t.api.list).toHaveBeenCalledTimes(2)
  })

  it('o que chega pelo socket durante a leitura fica na lista', async () => {
    const t = setup()
    t.store.start()
    t.push(n('chegou', { createdAt: '2026-10-05T12:05:00.000Z' }))
    t.lists[0]!.resolve(okList([n('a')]))
    await t.flush()
    expect(t.store.getState().items.map((i) => i.id)).toEqual(['chegou', 'a'])
  })

  it('avisa quem assina a cada mudança', async () => {
    const t = setup()
    const listener = vi.fn()
    t.store.subscribe(listener)
    t.store.start()
    t.lists[0]!.resolve(okList([n('a')]))
    await t.flush()
    expect(listener).toHaveBeenCalled()
  })

  it('falha na primeira leitura deixa em falha, e tentar de novo relê', async () => {
    const t = setup()
    t.store.start()
    t.lists[0]!.resolve(failed())
    await t.flush()
    expect(t.store.getState().status).toBe('failed')
    t.store.refresh()
    expect(t.api.list).toHaveBeenCalledTimes(2)
  })

  it('marcar uma como lida chama o servidor e conta na hora', async () => {
    const t = setup()
    t.store.start()
    t.lists[0]!.resolve(okList([n('a'), n('b')]))
    await t.flush()
    t.store.markRead('a')
    expect(t.store.getState().items.find((i) => i.id === 'a')?.read).toBe(true)
    expect(t.api.markRead).toHaveBeenCalledWith('a')
    await t.flush()
    expect(t.store.getState().items.find((i) => i.id === 'a')?.read).toBe(true)
  })

  it('releitura em voo durante a marca de lida não desfaz a lida ao chegar', async () => {
    const t = setup()
    t.store.start()
    t.lists[0]!.resolve(okList([n('a')]))
    await t.flush()
    t.store.refresh()
    t.store.markRead('a')
    await t.flush()
    t.lists[1]!.resolve(okList([n('a', { read: false })]))
    await t.flush()
    expect(t.store.getState().items[0]!.read).toBe(true)
  })

  it('leitura que rejeita conta como falha e não trava as próximas', async () => {
    const t = setup()
    t.api.list.mockImplementationOnce(() => Promise.reject(new Error('rede')))
    t.store.start()
    await t.flush()
    expect(t.store.getState().status).toBe('failed')
    t.store.refresh()
    expect(t.api.list).toHaveBeenCalledTimes(2)
  })

  it('marca de lida que rejeita volta a notificação para não lida', async () => {
    const t = setup()
    t.api.markRead.mockImplementationOnce(() => Promise.reject(new Error('rede')))
    t.store.start()
    t.lists[0]!.resolve(okList([n('a')]))
    await t.flush()
    t.store.markRead('a')
    await t.flush()
    expect(t.store.getState().items[0]!.read).toBe(false)
  })

  it('marcar como lida uma que já está lida não chama o servidor', async () => {
    const t = setup()
    t.store.start()
    t.lists[0]!.resolve(okList([n('a', { read: true })]))
    await t.flush()
    t.store.markRead('a')
    expect(t.api.markRead).not.toHaveBeenCalled()
  })

  it('recusa do servidor volta a notificação para não lida', async () => {
    const t = setup()
    t.api.markRead.mockResolvedValueOnce(failed())
    t.store.start()
    t.lists[0]!.resolve(okList([n('a')]))
    await t.flush()
    t.store.markRead('a')
    await t.flush()
    expect(t.store.getState().items[0]!.read).toBe(false)
  })

  it('marcar todas marca só as que estão na tela e chama o servidor uma vez', async () => {
    const t = setup()
    t.store.start()
    t.lists[0]!.resolve(okList([n('a'), n('b', { read: true })]))
    await t.flush()
    t.store.markAllRead()
    expect(t.api.markAllRead).toHaveBeenCalledTimes(1)
    expect(t.store.getState().items.every((i) => i.read)).toBe(true)
  })

  it('sem não lidas, marcar todas não chama o servidor', async () => {
    const t = setup()
    t.store.start()
    t.lists[0]!.resolve(okList([n('a', { read: true })]))
    await t.flush()
    t.store.markAllRead()
    expect(t.api.markAllRead).not.toHaveBeenCalled()
  })

  it('desligado, solta o socket e ignora resposta atrasada', async () => {
    const t = setup()
    const stop = t.store.start()
    stop()
    expect(t.unsubscribe).toHaveBeenCalled()
    t.lists[0]!.resolve(okList([n('a')]))
    await t.flush()
    expect(t.store.getState().items).toEqual([])
    t.store.refresh()
    expect(t.api.list).toHaveBeenCalledTimes(1)
  })
})
