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

  // A conta nasce no FIM do wizard, levando o perfil junto — é o que faz a fila
  // de aprovação do painel chegar completa em vez de só nome e e-mail.
  it('signUp manda o perfil do wizard junto do cadastro', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ nextStep: 'CONFIRM' }))
    await apiAuthBackend.signUp({
      email: 'j@ex.com',
      password: 'Senha@123',
      name: 'João Silva',
      companyId: 'company-seed-1',
      profile: { cpf: '000.000.000-00', bloodType: 'O-' },
    })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('/auth/signup')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'j@ex.com',
      password: 'Senha@123',
      name: 'João Silva',
      companyId: 'company-seed-1',
      profile: { cpf: '000.000.000-00', bloodType: 'O-' },
    })
  })

  it('signUp sem perfil segue válido (fluxo mock / build antiga)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ nextStep: 'CONFIRM' }))
    await apiAuthBackend.signUp({ email: 'j@ex.com', password: 'p', name: 'J' })
    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(JSON.parse(init.body as string).profile).toBeUndefined()
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
