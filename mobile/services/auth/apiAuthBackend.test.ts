import { apiAuthBackend } from './apiAuthBackend'
import { getUserId, clearUserId } from '../api/session'

jest.mock('expo-secure-store', () => {
  const itens = new Map<string, string>()
  return {
    AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
    setItemAsync: jest.fn(async (k: string, x: string) => { itens.set(k, x) }),
    getItemAsync: jest.fn(async (k: string) => itens.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => { itens.delete(k) }),
  }
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
    expect(store.setItemAsync).toHaveBeenCalledWith(expect.any(String), 't1', expect.anything())
    expect(getUserId()).toBe('u1')
  })

  it('signIn relança a mensagem de "aguardando aprovação" no 403 NOT_APPROVED', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(403, { reason: 'NOT_APPROVED', message: 'Sua conta está aguardando aprovação do administrador' }))
    await expect(apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' }))
      .rejects.toThrow(/aguardando aprovação/)
  })

  it('changePassword manda senha atual e nova pro endpoint autenticado', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ accessToken: 't1', user: { id: 'u1', email: 'j@ex.com', name: 'J' } }))
    await apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' })
    ;(global.fetch as jest.Mock).mockResolvedValue(okJson({ ok: true }))

    await apiAuthBackend.changePassword({ currentPassword: 'velha123', newPassword: 'Nova@1234' })

    const [url, init] = (global.fetch as jest.Mock).mock.calls.at(-1)!
    expect(String(url)).toMatch(/\/auth\/password\/change$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ currentPassword: 'velha123', newPassword: 'Nova@1234' })
    expect(init.headers.Authorization).toBe('Bearer t1')
  })

  it('signOut limpa o userId da sessão', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ accessToken: 't1', user: { id: 'u1', email: 'j@ex.com', name: 'J' } }))
    await apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' })
    expect(getUserId()).toBe('u1')
    await apiAuthBackend.signOut()
    expect(getUserId()).toBe('')
  })

  it('getCurrentUser sem token = null', async () => {
    const store = require('expo-secure-store'); await store.deleteItemAsync('swi.auth.token')
    expect(await apiAuthBackend.getCurrentUser()).toBeNull()
  })

  // O cadastro cria SÓ a conta. O perfil é preenchido pelo wizard DEPOIS do
  // primeiro login pós-aprovação, via PUT /profile/me autenticado, e nada de
  // perfil viaja no signup.
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

// Sessao fantasma: se `getCurrentUser` engolir QUALQUER falha do /auth/me e
// devolver null, o app cai na tela de login mas o token continua no
// SecureStore. Um cadastro iniciado dali roda com a sessao anterior ainda
// valida e grava no perfil de outra pessoa.
//
// A distincao que estes testes protegem: 401 = token morto, apaga. Rede fora =
// a sessao pode estar perfeitamente boa, so nao da pra confirmar agora, e
// apagar ai deslogaria todo mundo a cada soluco de conexao.
describe('getCurrentUser: token invalido nao pode sobreviver', () => {
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

  it('preserva o token quando a rede falha, a sessao pode estar boa', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'))

    expect(await apiAuthBackend.getCurrentUser()).toBeNull()
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-do-joao')
  })
})

// O GPS em segundo plano envia com o iPhone bloqueado. Token gravado com o
// padrão (WHEN_UNLOCKED) não pode ser lido nessa hora, e todo envio falharia.
describe('token legível com o aparelho bloqueado', () => {
  const store = () => require('expo-secure-store')
  const AFU = { keychainAccessible: 'afterFirstUnlock' }

  const MARCA = 'swi.auth.token.afu'
  const eu = { id: 'u1', email: 'j@ex.com', name: 'J' }

  // Estado de quem instalou antes desta versão: token gravado com o padrão,
  // sem a marca de conversão.
  const sessaoAntiga = async () => {
    await store().deleteItemAsync(MARCA)
    await store().setItemAsync('swi.auth.token', 'token-antigo')
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockResolvedValue(okJson(eu))
  }

  beforeEach(() => {
    (global as any).fetch = jest.fn()
    jest.clearAllMocks()
  })

  it('signIn grava o token com AFTER_FIRST_UNLOCK, apagando antes o anterior', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ accessToken: 't1', user: eu }))
    await apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' })
    // Gravar por cima de um item existente só troca o valor, nunca a
    // acessibilidade: por isso o apagar vem antes.
    expect(store().deleteItemAsync).toHaveBeenCalledWith('swi.auth.token')
    expect(store().setItemAsync).toHaveBeenCalledWith('swi.auth.token', 't1', AFU)
    const apagou = store().deleteItemAsync.mock.invocationCallOrder[0]
    const gravou = store().setItemAsync.mock.invocationCallOrder[0]
    expect(apagou).toBeLessThan(gravou)
    expect(await store().getItemAsync(MARCA)).toBe('1')
  })

  it('a sessão restaurada regrava o token antigo com AFTER_FIRST_UNLOCK, uma vez', async () => {
    await sessaoAntiga()
    expect(await apiAuthBackend.getCurrentUser()).toEqual(eu)
    expect(store().setItemAsync).toHaveBeenCalledWith('swi.auth.token', 'token-antigo', AFU)
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-antigo')

    // Já convertido: as aberturas seguintes não apagam nem regravam o token,
    // e a sessão não fica à mercê de o app morrer entre os dois passos.
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockResolvedValue(okJson(eu))
    expect(await apiAuthBackend.getCurrentUser()).toEqual(eu)
    expect(store().deleteItemAsync).not.toHaveBeenCalled()
    expect(store().setItemAsync).not.toHaveBeenCalled()
  })

  it('se a regravação falhar, o token volta como estava e a conversão fica para depois', async () => {
    await sessaoAntiga()
    store().setItemAsync.mockRejectedValueOnce(new Error('keychain'))
    expect(await apiAuthBackend.getCurrentUser()).toEqual(eu)
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-antigo')
    expect(await store().getItemAsync(MARCA)).toBeNull()
  })

  it('falha ao ler a marca não derruba a sessão', async () => {
    await sessaoAntiga()
    const ler = store().getItemAsync.getMockImplementation()
    store().getItemAsync.mockImplementation(async (k: string) => {
      if (k === MARCA) throw new Error('keychain')
      return ler(k)
    })
    expect(await apiAuthBackend.getCurrentUser()).toEqual(eu)
    store().getItemAsync.mockImplementation(ler)
  })
})
