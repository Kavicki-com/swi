// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no config);
// importar hooks de 'vitest' aqui duplica a instância (deps.inline) e quebra o runner.
import { vi } from 'vitest'
import { ApiError, apiFetch, SESSION_CLEARED_EVENT, TOKEN_STORAGE_KEY } from './http'

const mockFetch = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('injeta o Bearer token quando há sessão', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-abc')
    const f = mockFetch({ ok: true })
    vi.stubGlobal('fetch', f)

    await apiFetch('/work-orders')

    const init = f.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc')
  })

  it('omite o header quando não há sessão', async () => {
    const f = mockFetch({ ok: true })
    vi.stubGlobal('fetch', f)

    await apiFetch('/work-orders')

    const init = f.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('preserva headers passados como instância de Headers', async () => {
    const f = mockFetch({ ok: true })
    vi.stubGlobal('fetch', f)

    await apiFetch('/work-orders', { headers: new Headers({ 'If-Match': 'etag-1' }) })

    const headers = f.mock.calls[0]?.[1]?.headers as Record<string, string>
    // Headers normaliza nomes pra minúsculas na iteração.
    expect(headers['if-match']).toBe('etag-1')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('preserva headers passados como pares [string, string][]', async () => {
    const f = mockFetch({ ok: true })
    vi.stubGlobal('fetch', f)

    await apiFetch('/work-orders', { headers: [['X-Custom', '1']] })

    const headers = f.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['x-custom']).toBe('1')
  })

  it('header do caller vence o default mesmo com casing diferente', async () => {
    const f = mockFetch({ ok: true })
    vi.stubGlobal('fetch', f)

    await apiFetch('/upload', { headers: new Headers({ 'Content-Type': 'text/plain' }) })

    const headers = f.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['content-type']).toBe('text/plain')
    // O default não pode sobrar como chave duplicada com outro casing.
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('falha de rede vira ApiError com status 0 (sem resposta do servidor)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(apiFetch('/work-orders')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: 'Não foi possível conectar ao servidor',
    })
  })

  it('propaga a mensagem de erro do Nest em ApiError', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: 'responsável inválido' }, 400))
    await expect(apiFetch('/work-orders', { method: 'POST' })).rejects.toThrow(
      'responsável inválido',
    )
  })

  it('junta mensagens de array do class-validator em uma só', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: ['título obrigatório', 'data inválida'] }, 400))
    await expect(apiFetch('/work-orders', { method: 'POST' })).rejects.toThrow(
      'título obrigatório, data inválida',
    )
  })

  it('cai em "Erro <status>" quando o body de erro não é JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      } as unknown as Response),
    )
    await expect(apiFetch('/work-orders')).rejects.toThrow('Erro 500')
  })

  it('resolve sem explodir em resposta sem body (204)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input')
        },
      } as unknown as Response),
    )
    await expect(apiFetch('/work-orders/1', { method: 'DELETE' })).resolves.toBeNull()
  })

  it('401 limpa a sessão (token expirado não pode ficar preso)', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-velho')
    vi.stubGlobal('fetch', mockFetch({ message: 'Unauthorized' }, 401))

    await expect(apiFetch('/work-orders')).rejects.toBeInstanceOf(ApiError)
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('401 numa chamada autenticada avisa o app com o evento de sessão derrubada', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-velho')
    vi.stubGlobal('fetch', mockFetch({ message: 'Unauthorized' }, 401))
    const heard = vi.fn()
    window.addEventListener(SESSION_CLEARED_EVENT, heard)

    await expect(apiFetch('/work-orders')).rejects.toBeInstanceOf(ApiError)

    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener(SESSION_CLEARED_EVENT, heard)
  })

  // O JwtAuthGuard do backend usa a exception default do Passport ('Unauthorized',
  // em inglês). O resto do app é pt-BR — o painel não repassa esse texto cru.
  it('401 de sessão expirada troca a mensagem crua do Passport por uma em pt', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-velho')
    vi.stubGlobal('fetch', mockFetch({ message: 'Unauthorized' }, 401))

    await expect(apiFetch('/work-orders')).rejects.toThrow('Sua sessão expirou. Entre novamente.')
  })

  // 401 SEM token é o login recusando credencial, não sessão expirada: aí a
  // mensagem do backend já vem em pt e é a única que explica o que aconteceu.
  it('401 sem token preserva a mensagem do backend (login recusado)', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: 'Credenciais inválidas' }, 401))

    await expect(apiFetch('/auth/login', { method: 'POST' })).rejects.toThrow(
      'Credenciais inválidas',
    )
  })

  it('erro que não é 401 preserva a sessão', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-abc')
    vi.stubGlobal('fetch', mockFetch({ message: 'Forbidden' }, 403))

    await expect(apiFetch('/work-orders')).rejects.toBeInstanceOf(ApiError)
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-abc')
  })

  it('ApiError carrega o status HTTP', async () => {
    vi.stubGlobal('fetch', mockFetch({ message: 'não encontrada' }, 404))
    await expect(apiFetch('/work-orders/999')).rejects.toMatchObject({ status: 404 })
  })

  it('avisa no console em build de produção sem VITE_API_URL', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_URL', '')
    vi.resetModules()

    await import('./http')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('VITE_API_URL'))
    warn.mockRestore()
    vi.unstubAllEnvs()
  })
})
