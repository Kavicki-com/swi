// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no config);
// importar hooks de 'vitest' aqui duplica a instância (deps.inline) e quebra o runner.
import { vi } from 'vitest'
import { ApiError } from './http'
import { rescuesApi } from './rescues'

const stub = (body: unknown, status = 200) => {
  const f = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

const rescue = {
  id: 'r1',
  number: 1849,
  status: 'dispatched',
  startedAt: '2026-10-14T12:00:00.000Z',
  arrivedAt: null,
  endedAt: null,
  injured: { id: 'ferido-1', name: 'Ana' },
  rescuer: { id: 'socorrista-1', name: 'Bruno' },
}

describe('rescuesApi', () => {
  it('list lê /alerts/rescues com GET', async () => {
    const f = stub([rescue])
    expect(await rescuesApi.list()).toEqual([rescue])
    expect(f.mock.calls[0]?.[0]).toMatch(/\/alerts\/rescues$/)
    expect((f.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBeUndefined()
  })

  it('dispatch manda POST no ferido com o socorrista no corpo', async () => {
    const f = stub(rescue, 201)
    await rescuesApi.dispatch('ferido-1', 'socorrista-1')
    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(f.mock.calls[0]?.[0]).toMatch(/\/alerts\/ferido-1\/rescue$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ rescuerId: 'socorrista-1' })
  })

  it('arrive manda POST em rescues/:id/arrive', async () => {
    const f = stub({ ...rescue, status: 'arrived' })
    await rescuesApi.arrive('r1')
    expect(f.mock.calls[0]?.[0]).toMatch(/\/alerts\/rescues\/r1\/arrive$/)
    expect((f.mock.calls[0]?.[1] as RequestInit).method).toBe('POST')
  })

  it('end manda POST em rescues/:id/end', async () => {
    const f = stub({ ...rescue, status: 'ended' })
    await rescuesApi.end('r1')
    expect(f.mock.calls[0]?.[0]).toMatch(/\/alerts\/rescues\/r1\/end$/)
    expect((f.mock.calls[0]?.[1] as RequestInit).method).toBe('POST')
  })

  it('erro do backend chega como ApiError com status e mensagem', async () => {
    stub({ message: 'Resgate já encerrado' }, 409)
    const err = await rescuesApi.end('r1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toBe('Resgate já encerrado')
  })
})
