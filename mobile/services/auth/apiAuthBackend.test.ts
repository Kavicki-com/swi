import { apiAuthBackend } from './apiAuthBackend'

jest.mock('expo-secure-store', () => {
  let v: string | null = null
  return { setItemAsync: jest.fn(async (_k, x) => { v = x }), getItemAsync: jest.fn(async () => v), deleteItemAsync: jest.fn(async () => { v = null }) }
})

const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body })
const errJson = (status: number, body: any) => ({ ok: false, status, json: async () => body })

describe('apiAuthBackend', () => {
  beforeEach(() => { (global as any).fetch = jest.fn() })

  it('signIn guarda o token e devolve o user', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ accessToken: 't1', user: { id: 'u1', email: 'j@ex.com', name: 'J' } }))
    const u = await apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' })
    expect(u).toEqual({ id: 'u1', email: 'j@ex.com', name: 'J' })
    const store = require('expo-secure-store')
    expect(store.setItemAsync).toHaveBeenCalledWith(expect.any(String), 't1')
  })

  it('signIn relança a mensagem de "aguardando aprovação" no 403 NOT_APPROVED', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(403, { reason: 'NOT_APPROVED', message: 'Sua conta está aguardando aprovação do administrador' }))
    await expect(apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' }))
      .rejects.toThrow(/aguardando aprovação/)
  })

  it('getCurrentUser sem token = null', async () => {
    const store = require('expo-secure-store'); await store.deleteItemAsync('x')
    expect(await apiAuthBackend.getCurrentUser()).toBeNull()
  })
})
