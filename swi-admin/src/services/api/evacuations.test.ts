// vitest globals (describe/it/expect/vi) via globals: true — importar de
// 'vitest' duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import { evacuationsApi, type EvacuationProgressDto } from './evacuations'

const dto = (over: Partial<EvacuationProgressDto> = {}): EvacuationProgressDto => ({
  id: 'ev1',
  status: 'ACTIVE',
  startedAt: '2026-07-25T18:00:00.000Z',
  endedAt: null,
  total: 2,
  acked: 1,
  workers: [
    { id: 'w1', name: 'Worker Um', acked: true, ackAt: '2026-07-25T18:05:00.000Z' },
    { id: 'w2', name: 'Worker Dois', acked: false, ackAt: null },
  ],
  ...over,
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

describe('evacuationsApi.active', () => {
  it('GET /evacuations/active devolve o progresso no envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(dto()))
    vi.stubGlobal('fetch', fetchMock)
    const res = await evacuationsApi.active()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/evacuations/active'),
      expect.anything(),
    )
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ id: 'ev1', acked: 1, total: 2 })
  })

  it('sem evacuação ativa (corpo vazio) → data null SEM erro', async () => {
    // O backend responde 200 com corpo vazio quando não há ativa; o apiFetch
    // entrega null — que aqui é estado legítimo, não falha.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('empty')
        },
      }),
    )
    const res = await evacuationsApi.active()
    expect(res.data).toBeNull()
    expect(res.error).toBeNull()
  })

  it('falha de rede degrada pra envelope de erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const res = await evacuationsApi.active()
    expect(res.data).toBeNull()
    expect(res.error?.message).toBeTruthy()
  })
})

describe('evacuationsApi.start', () => {
  it('POST /evacuations devolve o dto inicial', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(dto({ acked: 0 })))
    vi.stubGlobal('fetch', fetchMock)
    const res = await evacuationsApi.start()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/evacuations')
    expect(init.method).toBe('POST')
    expect(res.data?.acked).toBe(0)
  })

  it('409 (já existe ativa) vira erro de negócio no envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ message: 'Já existe uma evacuação ativa' }),
      }),
    )
    const res = await evacuationsApi.start()
    expect(res.data).toBeNull()
    expect(res.error?.message).toBe('Já existe uma evacuação ativa')
  })
})

describe('evacuationsApi.end', () => {
  it('POST /evacuations/:id/end (204) → envelope ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('no body')
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await evacuationsApi.end('ev1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/evacuations/ev1/end')
    expect(init.method).toBe('POST')
    expect(res.error).toBeNull()
  })
})
