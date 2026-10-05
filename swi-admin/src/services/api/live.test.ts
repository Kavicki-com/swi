// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no config).
import { vi } from 'vitest'
import { ApiError } from './http'
import { liveApi } from './live'

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

const ana = { workerId: 'w1', name: 'Ana', startedAt: '2026-10-05T14:32:00.000Z' }

describe('liveApi', () => {
  it('list lê /live e devolve quem está transmitindo', async () => {
    const f = stub([ana])
    expect(await liveApi.list()).toEqual([ana])
    expect(f.mock.calls[0]?.[0]).toMatch(/\/live$/)
  })

  it('list descarta item fora do contrato em vez de levar lixo para a tela', async () => {
    stub([ana, { workerId: 7 }, null, { workerId: 'w2', name: 'Bruno' }])
    expect(await liveApi.list()).toEqual([ana])
  })

  it('list recusa resposta que não é lista', async () => {
    stub({})
    await expect(liveApi.list()).rejects.toBeInstanceOf(ApiError)
  })

  it('iceServers lê /live/ice-servers e devolve só a lista', async () => {
    const f = stub({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    expect(await liveApi.iceServers()).toEqual([{ urls: 'stun:stun.l.google.com:19302' }])
    expect(f.mock.calls[0]?.[0]).toMatch(/\/live\/ice-servers$/)
  })

  it('iceServers sem lista na resposta vira lista vazia', async () => {
    stub({})
    expect(await liveApi.iceServers()).toEqual([])
  })
})
