// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no config);
// importar hooks de 'vitest' aqui duplica a instância (deps.inline) e quebra o runner.
import { vi } from 'vitest'
import { ApiError } from './http'
import { camerasApi, countCameras } from './cameras'

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

const portaria = { id: 'c1', name: 'Portaria', lat: -3.1, lng: -60.02, url: null }

describe('camerasApi', () => {
  it('list lê /cameras com GET', async () => {
    const f = stub([portaria])
    expect(await camerasApi.list()).toEqual([portaria])
    expect(f.mock.calls[0]?.[0]).toMatch(/\/cameras$/)
    expect((f.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBeUndefined()
  })

  it('create manda POST com o payload', async () => {
    const f = stub(portaria, 201)
    await camerasApi.create({ name: 'Portaria', lat: -3.1, lng: -60.02, url: null })
    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(f.mock.calls[0]?.[0]).toMatch(/\/cameras$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Portaria',
      lat: -3.1,
      lng: -60.02,
      url: null,
    })
  })

  it('update manda PATCH no id só com o que mudou', async () => {
    const f = stub(portaria)
    await camerasApi.update('c1', { url: 'https://cameras.exemplo.com.br/1' })
    const init = f.mock.calls[0]?.[1] as RequestInit
    expect(f.mock.calls[0]?.[0]).toMatch(/\/cameras\/c1$/)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://cameras.exemplo.com.br/1' })
  })

  it('remove manda DELETE no id', async () => {
    const f = stub(null, 204)
    await camerasApi.remove('c1')
    expect(f.mock.calls[0]?.[0]).toMatch(/\/cameras\/c1$/)
    expect((f.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE')
  })

  it('nome repetido chega como ApiError 409 com a mensagem do backend', async () => {
    stub({ message: 'Já existe uma câmera com esse nome' }, 409)
    const err = await camerasApi
      .create({ name: 'Portaria', lat: 0, lng: 0, url: null })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).message).toBe('Já existe uma câmera com esse nome')
  })
})

describe('countCameras', () => {
  it('conta as câmeras cadastradas', async () => {
    stub([portaria, { ...portaria, id: 'c2', name: 'Pátio' }])
    expect(await countCameras()).toBe(2)
  })

  it('falha vira null, nunca zero: zero afirmaria que não há câmera', async () => {
    stub({ message: 'boom' }, 500)
    expect(await countCameras()).toBeNull()
  })
})
