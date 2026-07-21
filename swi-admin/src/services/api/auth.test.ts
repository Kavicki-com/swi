// describe/it/expect/afterEach vêm dos globals do Vitest (globals: true no config);
// importar hooks de 'vitest' aqui duplica a instância (deps.inline) e quebra o runner.
import { vi } from 'vitest'
import { SEED_ORG_ID } from '@/services/mockApi/seed'
import { authApi } from './auth'
import { SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from './http'

// JWT sintético: header.payload.signature — só o payload importa (o backend
// assina de verdade; o client apenas lê a role pra barrar worker no painel).
// Codifica em base64url como um JWT real (sem +, / nem padding).
const jwt = (payload: object) =>
  `x.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.y`

const okLogin = (token: string) =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      accessToken: token,
      user: { id: 'u1', email: 'admin@swi.local', name: 'Admin Demo' },
    }),
  } as Response)

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('authApi.signIn (real)', () => {
  it('persiste token e sessão quando o usuário é ADMIN', async () => {
    const f = okLogin(jwt({ sub: 'u1', role: 'ADMIN' }))
    vi.stubGlobal('fetch', f)

    const { data, error } = await authApi.signIn({ email: 'admin@swi.local', password: 'admin123' })

    expect(error).toBeNull()
    expect(data?.full_name).toBe('Admin Demo')
    expect(data?.email).toBe('admin@swi.local')
    expect(data?.role).toBe('admin')
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeTruthy()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeTruthy()
    // Bate no endpoint certo com o método certo.
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/auth/login')
    expect(init.method).toBe('POST')
  })

  it('grava a sessão com o org do seed — ponte pros domínios ainda mock', async () => {
    // Dashboard/Employees/etc. seguem mock e filtram por org_id === SEED_ORG_ID;
    // org_id vazio deixaria o painel inteiro zerado sem nenhum erro.
    vi.stubGlobal('fetch', okLogin(jwt({ sub: 'u1', role: 'ADMIN' })))

    const { data } = await authApi.signIn({ email: 'admin@swi.local', password: 'admin123' })

    expect(data?.org_id).toBe(SEED_ORG_ID)
    const stored = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? '{}')
    expect(stored.org_id).toBe(SEED_ORG_ID)
  })

  it('200 com corpo nulo devolve erro amigável sem persistir nada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => null,
      } as Response),
    )

    const { data, error } = await authApi.signIn({ email: 'admin@swi.local', password: 'admin123' })

    expect(data).toBeNull()
    expect(error?.message).toBe('Resposta inesperada do servidor.')
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('aceita JWT real em base64url (payload com - e _)', async () => {
    // "~~" força um caractere que em base64 clássico seria "+" — atob puro quebra.
    vi.stubGlobal('fetch', okLogin(jwt({ sub: 'u1', role: 'ADMIN', x: '~~' })))

    const { data, error } = await authApi.signIn({ email: 'admin@swi.local', password: 'admin123' })

    expect(error).toBeNull()
    expect(data?.role).toBe('admin')
  })

  it('rejeita WORKER — o painel é só de administradores', async () => {
    vi.stubGlobal('fetch', okLogin(jwt({ sub: 'u1', role: 'WORKER' })))

    const { data, error } = await authApi.signIn({
      email: 'worker@swi.local',
      password: 'worker123',
    })

    expect(data).toBeNull()
    expect(error?.message).toMatch(/administradores/i)
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('JWT com payload ilegível é tratado como não-ADMIN, sem persistir', async () => {
    vi.stubGlobal('fetch', okLogin('x.%%%não-é-base64%%%.y'))

    const { data, error } = await authApi.signIn({ email: 'admin@swi.local', password: 'admin123' })

    expect(data).toBeNull()
    expect(error?.message).toMatch(/administradores/i)
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('credencial errada devolve erro sem persistir nada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Credenciais inválidas' }),
      } as Response),
    )

    const { data, error } = await authApi.signIn({ email: 'a@b.c', password: 'x' })

    expect(data).toBeNull()
    expect(error?.message).toBe('Credenciais inválidas')
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('falha de rede vira erro amigável sem persistir nada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { data, error } = await authApi.signIn({ email: 'a@b.c', password: 'x' })

    expect(data).toBeNull()
    expect(error?.message).toBe('Não foi possível conectar ao servidor')
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })
})

describe('authApi.getSession (real)', () => {
  it('devolve o user quando token e sessão existem', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, jwt({ sub: 'u1', role: 'ADMIN' }))
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ id: 'u1', email: 'admin@swi.local', full_name: 'Admin Demo' }),
    )

    const { data, error } = await authApi.getSession()

    expect(error).toBeNull()
    expect(data?.full_name).toBe('Admin Demo')
  })

  it('devolve null quando falta o token (sessão órfã)', async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ id: 'u1', email: 'admin@swi.local', full_name: 'Admin Demo' }),
    )

    const { data, error } = await authApi.getSession()

    expect(data).toBeNull()
    expect(error).toBeNull()
  })

  it('devolve null quando a sessão gravada não é JSON válido', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-abc')
    window.localStorage.setItem(SESSION_STORAGE_KEY, '{corrompido')

    const { data, error } = await authApi.getSession()

    expect(data).toBeNull()
    expect(error).toBeNull()
  })
})

describe('authApi.signOut (real)', () => {
  it('limpa as duas chaves', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-abc')
    window.localStorage.setItem(SESSION_STORAGE_KEY, '{"id":"u1"}')

    const { error } = await authApi.signOut()

    expect(error).toBeNull()
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})
