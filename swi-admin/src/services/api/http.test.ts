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

  // Um 401 sem header de CORS e um servidor fora do ar chegam iguais no catch:
  // `fetch` rejeita nos dois e o navegador não deixa ler o status. O /health é
  // público, então responder 200 nele prova que o servidor está de pé e que o
  // CORS funciona; logo, a chamada autenticada que falhou era 401 com o header
  // suprimido, ou seja, sessão morta.
  const fetchComSaude = (saudeOk: boolean) =>
    vi.fn().mockImplementation((url: unknown) => {
      if (String(url).endsWith('/health')) {
        return saudeOk
          ? Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ status: 'ok' }),
            } as Response)
          : Promise.reject(new TypeError('Failed to fetch'))
      }
      return Promise.reject(new TypeError('Failed to fetch'))
    })

  it('chamada autenticada bloqueada com o servidor de pé derruba a sessão', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-velho')
    vi.stubGlobal('fetch', fetchComSaude(true))

    await expect(apiFetch('/work-orders')).rejects.toMatchObject({
      status: 401,
      message: 'Sua sessão expirou. Entre novamente.',
    })
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('chamada autenticada bloqueada com o servidor de pé avisa o app pelo evento', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-velho')
    vi.stubGlobal('fetch', fetchComSaude(true))
    const heard = vi.fn()
    window.addEventListener(SESSION_CLEARED_EVENT, heard)

    await expect(apiFetch('/work-orders')).rejects.toBeInstanceOf(ApiError)

    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener(SESSION_CLEARED_EVENT, heard)
  })

  // Queda de rede de verdade não pode deslogar ninguém: aí o /health também cai.
  it('servidor fora do ar preserva a sessão e segue com status 0', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-abc')
    vi.stubGlobal('fetch', fetchComSaude(false))

    await expect(apiFetch('/work-orders')).rejects.toMatchObject({
      status: 0,
      message: 'Não foi possível conectar ao servidor',
    })
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-abc')
  })

  // keepSessionOn401 marca rotas onde 401 é resposta de negócio (senha atual
  // errada). Nelas a sondagem não deve nem acontecer, quanto mais deslogar.
  it('keepSessionOn401 preserva a sessão mesmo com o servidor de pé', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-abc')
    const f = fetchComSaude(true)
    vi.stubGlobal('fetch', f)

    await expect(
      apiFetch('/auth/password/change', { method: 'POST' }, { keepSessionOn401: true }),
    ).rejects.toMatchObject({ status: 0 })

    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-abc')
    expect(f.mock.calls.some((c) => String(c[0]).endsWith('/health'))).toBe(false)
  })

  it('sem token guardado não sonda o /health (não há sessão a derrubar)', async () => {
    const f = fetchComSaude(true)
    vi.stubGlobal('fetch', f)

    await expect(apiFetch('/work-orders')).rejects.toMatchObject({ status: 0 })

    expect(f.mock.calls.some((c) => String(c[0]).endsWith('/health'))).toBe(false)
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

  // Paginação: o total da coleção vem em header (X-Total-Count) e o corpo segue
  // sendo só o array, então o caller precisa de um gancho pra ler a resposta
  // crua sem duplicar token/erro do apiFetch.
  it('onResponse recebe a Response crua (headers legíveis) antes do parse', async () => {
    const headers = new Headers({ 'X-Total-Count': '262' })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, headers, json: async () => [{ id: 'r1' }] }),
    )
    let total: string | null = null
    const data = await apiFetch<{ id: string }[]>(
      '/reports',
      {},
      {
        onResponse: (res) => {
          total = res.headers.get('X-Total-Count')
        },
      },
    )
    expect(total).toBe('262')
    expect(data).toEqual([{ id: 'r1' }])
  })

  // Antes, um build de produção sem a variável apontava em silêncio para a
  // máquina de quem abriu o navegador e falhava como se o backend estivesse
  // fora do ar. Agora o erro diz o que está errado, e NÃO passa pelo catch de
  // rede do apiFetch, que o converteria em "não foi possível conectar".
  it('falha com a mensagem da variável em build de produção sem VITE_API_URL', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_URL', '')
    vi.resetModules()

    const { apiFetch } = await import('./http')

    await expect(apiFetch('/qualquer')).rejects.toThrow(/VITE_API_URL/)
    vi.unstubAllEnvs()
  })
})
