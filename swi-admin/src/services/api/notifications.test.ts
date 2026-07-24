// QA F (2026-07-24): "Solicitar Pausa" era toast fake. Client real:
// POST /notifications/pause-request (ADMIN → notificação de journey pro worker).
// vitest globals (describe/it/expect/afterEach) via globals: true — importar de
// 'vitest' duplicaria a instância (ver nota no auth.test.ts).
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
