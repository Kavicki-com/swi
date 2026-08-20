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
  // Sem isto, um teste de timer falso que quebre ANTES do próprio cleanup
  // deixaria os timers congelados e derrubaria os testes seguintes por um
  // motivo que não é o deles.
  vi.useRealTimers()
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

// O nginx da API carimba `Access-Control-Allow-Origin` só em 2xx, então TODO
// status de erro volta sem o header e chega no cliente como promise rejeitada,
// indistinguível de servidor fora do ar. Sondar só o /health respondia "o
// servidor está de pé", que é verdade em 401, 403, 409 e 500 igualmente, e o
// painel deslogava o admin no meio do formulário por causa de um 403.
// A sondagem que decide isso tem que perguntar pela CREDENCIAL, não pelo host.
describe('sondagem de sessão atrás do CORS', () => {
  type Rota = number | 'rejeita'

  const respostaFalsa = (status: number) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({}),
    }) as Response

  // 'rejeita' reproduz o que o navegador entrega quando a resposta vem sem o
  // header de CORS: promise rejeitada, status ilegível.
  const fetchPorRota = (rotas: { chamada: Rota; me: Rota; health: Rota }) =>
    vi.fn().mockImplementation((url: unknown) => {
      const alvo = String(url)
      const escolha = alvo.endsWith('/auth/me')
        ? rotas.me
        : alvo.endsWith('/health')
          ? rotas.health
          : rotas.chamada
      return escolha === 'rejeita'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(respostaFalsa(escolha))
    })

  const chamadasEm = (f: ReturnType<typeof vi.fn>, sufixo: string) =>
    f.mock.calls.filter((c) => String(c[0]).endsWith(sufixo))

  it('403 escondido pelo CORS não desloga: o /auth/me prova que o token vive', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-vivo')
    vi.stubGlobal('fetch', fetchPorRota({ chamada: 'rejeita', me: 200, health: 200 }))

    await expect(apiFetch('/reports/r1', { method: 'DELETE' })).rejects.toMatchObject({
      status: 0,
    })
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-vivo')
  })

  it('erro ilegível com token vivo não mente dizendo que a sessão expirou', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-vivo')
    vi.stubGlobal('fetch', fetchPorRota({ chamada: 'rejeita', me: 200, health: 200 }))

    await expect(apiFetch('/reports/r1', { method: 'DELETE' })).rejects.toThrow(
      /sessão continua ativa/i,
    )
  })

  // Onde o CORS está correto (dev, e a produção depois do `add_header always`),
  // a sondagem lê o 401 direto e não precisa do /health pra concluir.
  it('401 legível na sondagem derruba a sessão sem consultar o /health', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-velho')
    const f = fetchPorRota({ chamada: 'rejeita', me: 401, health: 200 })
    vi.stubGlobal('fetch', f)

    await expect(apiFetch('/work-orders')).rejects.toMatchObject({
      status: 401,
      message: 'Sua sessão expirou. Entre novamente.',
    })
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(chamadasEm(f, '/health')).toHaveLength(0)
  })

  // Cancelamento (unmount, troca de tela) cai no MESMO catch de rede. Sem
  // distinguir, sair de uma tela no meio do carregamento deslogava o admin.
  it('requisição cancelada não sonda nada e preserva a sessão', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-vivo')
    const abortado = new DOMException('The user aborted a request.', 'AbortError')
    const f = vi.fn().mockRejectedValue(abortado)
    vi.stubGlobal('fetch', f)

    const controle = new AbortController()
    controle.abort()

    await expect(apiFetch('/work-orders', { signal: controle.signal })).rejects.toMatchObject({
      status: 0,
    })
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-vivo')
    expect(chamadasEm(f, '/auth/me')).toHaveLength(0)
    expect(chamadasEm(f, '/health')).toHaveLength(0)
  })

  // Uma tela carrega várias coleções de uma vez. Com a sessão morta, cada falha
  // abria a própria sondagem e disparava o próprio SESSION_CLEARED: N rodadas de
  // rede e N derrubadas de contexto pro mesmo fato.
  it('falhas simultâneas sondam uma vez só e avisam o app uma vez só', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-velho')
    const f = fetchPorRota({ chamada: 'rejeita', me: 'rejeita', health: 200 })
    vi.stubGlobal('fetch', f)
    const ouviu = vi.fn()
    window.addEventListener(SESSION_CLEARED_EVENT, ouviu)

    const resultados = await Promise.allSettled([
      apiFetch('/work-orders'),
      apiFetch('/reports'),
      apiFetch('/notifications'),
    ])

    expect(resultados.every((r) => r.status === 'rejected')).toBe(true)
    expect(chamadasEm(f, '/auth/me')).toHaveLength(1)
    expect(ouviu).toHaveBeenCalledTimes(1)
    window.removeEventListener(SESSION_CLEARED_EVENT, ouviu)
  })

  // Resposta de sondagem servida do cache do navegador responderia sobre o
  // passado: um 200 guardado do /health "provaria" que o servidor está de pé
  // depois de ele cair.
  it('sonda sem cache', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-vivo')
    const f = fetchPorRota({ chamada: 'rejeita', me: 200, health: 200 })
    vi.stubGlobal('fetch', f)

    await expect(apiFetch('/work-orders')).rejects.toBeInstanceOf(ApiError)

    const init = chamadasEm(f, '/auth/me')[0]?.[1] as RequestInit
    expect(init.cache).toBe('no-store')
  })

  // Host blackholed (pacote engolido, sem RST): a sondagem sem prazo pendura o
  // erro do usuário pelo tempo inteiro do timeout do navegador, somado ao da
  // chamada original.
  it('desiste da sondagem no tempo limite em vez de pendurar o erro', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-vivo')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown) => {
        // A chamada de verdade falha rápido; as sondagens é que ficam penduradas.
        if (String(url).endsWith('/work-orders')) {
          return Promise.reject(new TypeError('Failed to fetch'))
        }
        return new Promise(() => {})
      }),
    )

    const promessa = apiFetch('/work-orders')
    const veredito = expect(promessa).rejects.toMatchObject({
      status: 0,
      message: 'Não foi possível conectar ao servidor',
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await veredito

    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-vivo')
  })

  // Estouro de prazo não é evidência de token morto, é o contrário: um 401 com
  // o header de CORS suprimido rejeita na hora, não fica 4 s mudo. Sondagem
  // muda aponta pra servidor em sofrimento (o /auth/me consulta o banco, o
  // /health não), e deslogar aí troca "servidor com problema" por "sua sessão
  // expirou", que manda o admin refazer login sem que login resolva nada.
  it('sondagem autenticada muda preserva a sessão mesmo com o /health de pé', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-vivo')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown) => {
        const alvo = String(url)
        // Banco travado: a rota autenticada pendura, e a de saúde, que não
        // consulta o banco, segue respondendo na hora.
        if (alvo.endsWith('/auth/me')) return new Promise(() => {})
        if (alvo.endsWith('/health')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
        }
        return Promise.reject(new TypeError('Failed to fetch'))
      }),
    )

    const promessa = apiFetch('/work-orders')
    const veredito = expect(promessa).rejects.toMatchObject({
      status: 0,
      message: 'Não foi possível conectar ao servidor',
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await veredito

    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-vivo')
  })
})
