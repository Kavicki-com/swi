// Client do modal "Solicitar suporte": POST /support, rota pública (logado
// manda o e-mail da sessão).
// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no
// config); importar hooks de 'vitest' aqui duplica a instância (deps.inline) e
// quebra o runner.
import { vi } from 'vitest'
import { supportApi } from './support'

afterEach(() => vi.unstubAllGlobals())

describe('supportApi.send', () => {
  it('POST /support com reason/title/message/email e devolve { sent: true }', async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 's1' }) } as Response)
    vi.stubGlobal('fetch', f)

    const { data, error } = await supportApi.send({
      reason: 'Problema técnico',
      title: 'Mapa não carrega',
      message: 'A aba Mapas fica em branco.',
      email: 'admin@swi.local',
    })

    expect(error).toBeNull()
    expect(data).toEqual({ sent: true })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/support')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      reason: 'Problema técnico',
      title: 'Mapa não carrega',
      message: 'A aba Mapas fica em branco.',
      email: 'admin@swi.local',
    })
  })

  it('falha de rede → { data: null, error } com mensagem pt-BR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { data, error } = await supportApi.send({ reason: 'Outros', title: 'T', message: 'M' })
    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})
