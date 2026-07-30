import { apiAuthBackend } from './apiAuthBackend'
import { getUserId, clearUserId } from '../api/session'

jest.mock('expo-secure-store', () => {
  let v: string | null = null
  return { setItemAsync: jest.fn(async (_k, x) => { v = x }), getItemAsync: jest.fn(async () => v), deleteItemAsync: jest.fn(async () => { v = null }) }
})

const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body })
const errJson = (status: number, body: any) => ({ ok: false, status, json: async () => body })

describe('apiAuthBackend', () => {
  beforeEach(() => { (global as any).fetch = jest.fn() })
  afterEach(() => clearUserId())

  it('signIn guarda o token e devolve o user', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ accessToken: 't1', user: { id: 'u1', email: 'j@ex.com', name: 'J' } }))
    const u = await apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' })
    expect(u).toEqual({ id: 'u1', email: 'j@ex.com', name: 'J' })
    const store = require('expo-secure-store')
    expect(store.setItemAsync).toHaveBeenCalledWith(expect.any(String), 't1')
    expect(getUserId()).toBe('u1')
  })

  it('signIn relança a mensagem de "aguardando aprovação" no 403 NOT_APPROVED', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(403, { reason: 'NOT_APPROVED', message: 'Sua conta está aguardando aprovação do administrador' }))
    await expect(apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' }))
      .rejects.toThrow(/aguardando aprovação/)
  })

  it('signOut limpa o userId da sessão', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ accessToken: 't1', user: { id: 'u1', email: 'j@ex.com', name: 'J' } }))
    await apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' })
    expect(getUserId()).toBe('u1')
    await apiAuthBackend.signOut()
    expect(getUserId()).toBe('')
  })

  it('getCurrentUser sem token = null', async () => {
    const store = require('expo-secure-store'); await store.deleteItemAsync('x')
    expect(await apiAuthBackend.getCurrentUser()).toBeNull()
  })

  // Reordenação 2026-07-27: o cadastro cria SÓ a conta (fluxo 1). O perfil é
  // preenchido pelo wizard DEPOIS do primeiro login pós-aprovação, via
  // PUT /profile/me autenticado — nada de perfil viajando no signup.
  it('signUp manda só conta e vínculo de empresa', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ nextStep: 'CONFIRM' }))
    await apiAuthBackend.signUp({
      email: 'j@ex.com',
      password: 'Senha@123',
      name: 'João Silva',
      companyId: 'company-seed-1',
    })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('/auth/signup')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'j@ex.com',
      password: 'Senha@123',
      name: 'João Silva',
      companyId: 'company-seed-1',
    })
  })

  it('resendConfirmation faz POST em /auth/confirm/resend com o e-mail', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({}))
    await apiAuthBackend.resendConfirmation({ email: 'j@ex.com' })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('/auth/confirm/resend')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'j@ex.com' })
  })
})

// INCIDENTE 2026-07-27: o perfil do "Joao Tester" apareceu com o telefone e o
// tipo sanguineo do "Teste Ricardo", gravados 1 segundo antes da conta do
// Ricardo nascer. O wizard inteiro rodou com o token do Joao ainda valido.
//
// De onde vinha esse token: `getCurrentUser` engolia QUALQUER falha do
// /auth/me e devolvia null. O app caia na tela de login — mas o token
// continuava no SecureStore. Os tuneis do backend cairam duas vezes naquele
// dia; bastou o /auth/me falhar por rede pra virar sessao fantasma.
//
// A distincao que faltava: 401 = token morto, apaga. Rede fora = a sessao
// pode estar perfeitamente boa, so nao da pra confirmar agora — apagar ai
// deslogaria todo mundo a cada soluco de conexao.
describe('getCurrentUser — token invalido nao pode sobreviver', () => {
  const store = () => require('expo-secure-store')

  beforeEach(async () => {
    (global as any).fetch = jest.fn()
    await store().setItemAsync('swi.auth.token', 'token-do-joao')
  })

  it('apaga o token quando o servidor diz 401', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(401, { message: 'Unauthorized' }))

    expect(await apiAuthBackend.getCurrentUser()).toBeNull()
    expect(await store().getItemAsync('swi.auth.token')).toBeNull()
  })

  it('preserva o token quando a rede falha — a sessao pode estar boa', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'))

    expect(await apiAuthBackend.getCurrentUser()).toBeNull()
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-do-joao')
  })
})
