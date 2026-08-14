// "Solicitar Pausa" fala com POST /notifications/pause-request
// (ADMIN → notificação de journey pro worker).
// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no
// config); importar hooks de 'vitest' aqui duplica a instância (deps.inline) e
// quebra o runner.
import { vi } from 'vitest'
import { notificationsApi } from './notifications'

afterEach(() => vi.unstubAllGlobals())

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
