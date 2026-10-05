// "Solicitar Pausa" fala com POST /notifications/pause-request
// (ADMIN → notificação de journey pro worker).
// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no
// config); importar hooks de 'vitest' aqui duplica a instância (deps.inline) e
// quebra o runner.
import { vi } from 'vitest'
import { notificationsApi, type NotificationDto } from './notifications'

afterEach(() => vi.unstubAllGlobals())

const ok = (body: unknown, status = 200) =>
  ({ ok: true, status, json: async () => body }) as Response

const health: NotificationDto = {
  id: 'n1',
  title: 'Batimento alto: João Silva',
  body: '130 bpm, acima do limite de 120 bpm.',
  domain: 'health',
  targetId: 'cond-1',
  read: false,
  createdAt: '2026-10-05T12:00:00.000Z',
}

describe('notificationsApi.list', () => {
  it('GET /notifications devolve a lista do próprio admin, mais nova primeiro', async () => {
    const f = vi.fn().mockResolvedValue(ok([health]))
    vi.stubGlobal('fetch', f)

    const { data, error } = await notificationsApi.list()

    expect(error).toBeNull()
    expect(data).toEqual([health])
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/notifications$/)
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('resposta fora do contrato vira erro, e não lista vazia', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    const { data, error } = await notificationsApi.list()
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })

  it('falha do servidor vira { data: null, error }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response),
    )
    const { data, error } = await notificationsApi.list()
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})

describe('notificationsApi.markRead e markAllRead', () => {
  it('POST /notifications/:id/read com o id codificado', async () => {
    const f = vi.fn().mockResolvedValue(ok({}, 204))
    vi.stubGlobal('fetch', f)

    const { error } = await notificationsApi.markRead('n 1')

    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/notifications\/n%201\/read$/)
    expect(init.method).toBe('POST')
  })

  it('POST /notifications/read-all', async () => {
    const f = vi.fn().mockResolvedValue(ok({}, 204))
    vi.stubGlobal('fetch', f)

    const { error } = await notificationsApi.markAllRead()

    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/notifications\/read-all$/)
    expect(init.method).toBe('POST')
  })

  it('falha ao marcar vira erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response),
    )
    expect((await notificationsApi.markRead('x')).error).not.toBeNull()
    expect((await notificationsApi.markAllRead()).error).not.toBeNull()
  })
})

describe('notificationsApi.requestPause', () => {
  it('POST /notifications/pause-request com o workerId → { requested: true }', async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204, json: async () => ({}) } as Response)
    vi.stubGlobal('fetch', f)

    const { data, error } = await notificationsApi.requestPause('worker-1')

    expect(error).toBeNull()
    expect(data).toEqual({ requested: true })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/notifications/pause-request')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ workerId: 'worker-1' })
  })

  it('worker de outra empresa (404) → { data: null, error } com mensagem do backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 404,
          json: async () => ({ message: 'Funcionário não encontrado' }),
        } as Response),
    )
    const { data, error } = await notificationsApi.requestPause('ghost')
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})
