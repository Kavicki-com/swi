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

const companyPayload = () => ({
  company: {
    name: 'Acme S.A.',
    cnpj: '12.345.678/0001-90',
    site: 'www.acme.com.br',
    cep: '30140-000',
    street: 'Avenida Quatro de Julho',
    number: '123',
    neighborhood: 'Pampulha',
    uf: 'MG',
  },
  responsible: {
    name: 'Maria',
    phone: '(31) 99999-0000',
    email: 'maria@acme.com',
    role: 'owner' as const,
  },
})

describe('authApi.signUpCompany (real)', () => {
  it('POST /auth/signup-company com o payload aninhado; sucesso não loga (só CHECK_EMAIL)', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nextStep: 'CHECK_EMAIL' }),
    } as Response)
    vi.stubGlobal('fetch', f)

    const { data, error } = await authApi.signUpCompany(companyPayload())

    expect(error).toBeNull()
    expect(data?.nextStep).toBe('CHECK_EMAIL')
    // não cria sessão: o admin nasce não-verificado, entra só depois do link
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/auth/signup-company')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.company.cnpj).toBe('12.345.678/0001-90')
    expect(body.responsible.email).toBe('maria@acme.com')
    expect(body.responsible.role).toBe('owner')
  })

  it('e-mail já cadastrado (409) devolve erro sem logar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ message: 'E-mail já cadastrado' }),
      } as Response),
    )

    const { data, error } = await authApi.signUpCompany(companyPayload())

    expect(data).toBeNull()
    expect(error?.message).toMatch(/cadastrad/i)
  })
})

describe('authApi.requestPasswordReset (real, link do admin)', () => {
  it('POST /auth/password/forgot-admin; 200 vazio = { sent: true }', async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)

    const { data, error } = await authApi.requestPasswordReset({ email: 'a@swi.com' })

    expect(error).toBeNull()
    expect(data?.sent).toBe(true)
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/auth/password/forgot-admin')
    expect(init.method).toBe('POST')
  })

  it('falha de rede vira erro amigável', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { data, error } = await authApi.requestPasswordReset({ email: 'a@swi.com' })

    expect(data).toBeNull()
    expect(error?.message).toBe('Não foi possível conectar ao servidor')
  })
})

describe('authApi.resetPassword (real, email + code)', () => {
  it('POST /auth/password/reset com email+code+newPassword; 200 = { reset: true }', async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => null } as Response)
    vi.stubGlobal('fetch', f)

    const { data, error } = await authApi.resetPassword({
      email: 'a@swi.com',
      code: '123456',
      newPassword: 'nova1234',
    })

    expect(error).toBeNull()
    expect(data?.reset).toBe(true)
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/auth/password/reset')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ email: 'a@swi.com', code: '123456', newPassword: 'nova1234' })
  })

  it('código inválido (400) devolve erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Código inválido' }),
      } as Response),
    )

    const { data, error } = await authApi.resetPassword({
      email: 'a@swi.com',
      code: '000000',
      newPassword: 'nova1234',
    })

    expect(data).toBeNull()
    expect(error?.message).toMatch(/inválido/i)
  })
})

// QA F (2026-07-24): "Alterar senha" do settings era toast fake. Client real:
// POST /auth/password/change (autenticado; exige a senha atual).
describe('authApi.changePassword', () => {
  it('POST /auth/password/change com current/new → { changed: true }', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ changed: true }) } as Response)
    vi.stubGlobal('fetch', f)

    const { data, error } = await authApi.changePassword({
      currentPassword: 'atual123',
      newPassword: 'nova1234',
    })

    expect(error).toBeNull()
    expect(data).toEqual({ changed: true })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/auth/password/change')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ currentPassword: 'atual123', newPassword: 'nova1234' })
  })

  it('401 (senha atual incorreta) → erro pt-BR específico', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) } as Response),
    )
    const { data, error } = await authApi.changePassword({ currentPassword: 'errada', newPassword: 'nova1234' })
    expect(data).toBeNull()
    expect(error?.message).toMatch(/senha atual/i)
  })
})

  // Achado no E2E (2026-07-24): o 401 de senha-atual-errada disparava o
  // logout global do apiFetch — errar a senha DESLOGAVA o admin. O 401 aqui
  // é resposta de negócio, não sessão morta: a sessão local deve sobreviver.
  it('401 de senha errada NÃO derruba a sessão local', async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-vivo')
    window.localStorage.setItem(SESSION_STORAGE_KEY, '{"id":"u1"}')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) } as Response),
    )

    const { error } = await authApi.changePassword({ currentPassword: 'errada', newPassword: 'nova1234' })

    expect(error?.message).toMatch(/senha atual/i)
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('jwt-vivo')
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe('{"id":"u1"}')
  })
