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

  it('confirmSession sem token = none', async () => {
    const store = require('expo-secure-store'); await store.deleteItemAsync('swi.auth.token')
    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'none' })
    expect(global.fetch).not.toHaveBeenCalled()
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

// Sessao fantasma: se a confirmação engolir QUALQUER falha do /auth/me, o app
// cai na tela de login mas o token continua no SecureStore. Um cadastro
// iniciado dali roda com a sessao anterior ainda valida e grava no perfil de
// outra pessoa.
//
// A distincao que estes testes protegem: 401 ou 403 DA API = token morto,
// apaga. Rede fora, ou alguém no caminho respondendo (portal de rede, proxy) =
// a sessao pode estar perfeitamente boa, so nao da pra confirmar agora, e
// apagar ai deslogaria todo mundo a cada soluco de conexao.
describe('confirmSession: token invalido nao pode sobreviver', () => {
  const store = () => require('expo-secure-store')
  const SESSAO = 'swi.auth.session'
  const eu = { id: 'u1', email: 'j@ex.com', name: 'J' }

  beforeEach(async () => {
    (global as any).fetch = jest.fn()
    clearUserId()
    await store().setItemAsync('swi.auth.token', 'token-do-joao')
    await store().setItemAsync(SESSAO, JSON.stringify({ v: 1, user: eu, confirmedAt: '2026-10-07T12:00:00.000Z' }))
  })

  it.each([401, 403])('apaga o token e a cópia da sessão quando a API diz %i', async (status) => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(status, { statusCode: status, message: 'Unauthorized' }))

    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'revoked' })
    expect(await store().getItemAsync('swi.auth.token')).toBeNull()
    expect(await store().getItemAsync(SESSAO)).toBeNull()
    expect(getUserId()).toBe('')
  })

  it.each([401, 403])('preserva tudo quando o %i não veio da API (proxy, portal de rede)', async (status) => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(status, {}))

    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'unreachable' })
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-do-joao')
    expect(await store().getItemAsync(SESSAO)).not.toBeNull()
  })

  it('preserva o token quando a rede falha, a sessao pode estar boa', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'))

    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'unreachable' })
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-do-joao')
    expect(await store().getItemAsync(SESSAO)).not.toBeNull()
  })

  // Revogada é revogada mesmo se o Keychain falhar ao apagar: devolver erro
  // faria quem pergunta confirmar de novo, sem fim.
  it('falha ao apagar o token ainda conta como revogada', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(401, { statusCode: 401, message: 'Unauthorized' }))
    store().deleteItemAsync.mockRejectedValueOnce(new Error('keychain'))

    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'revoked' })
    expect(await store().getItemAsync(SESSAO)).toBeNull()
    expect(getUserId()).toBe('')
  })

  // iPhone reiniciado e ainda não desbloqueado: o Keychain recusa a leitura.
  // Isso não é "sem token", e a sessão não pode cair por causa dele.
  it('falha ao ler o token não derruba a sessão', async () => {
    store().getItemAsync.mockRejectedValueOnce(new Error('keychain'))

    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'unreachable' })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-do-joao')
  })

  it('preserva o token com erro do servidor', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(errJson(500, { statusCode: 500, message: 'Internal' }))

    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'unreachable' })
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-do-joao')
  })

  // Portal de rede de hotel ou de obra: responde 200 com uma página, o corpo
  // não é JSON e chegava aqui como `{}`. Isso não é um usuário.
  it.each([
    ['corpo ilegível', { ok: true, status: 200, json: async () => { throw new SyntaxError('<html>') } }],
    ['corpo sem usuário', okJson({})],
    ['nulo', okJson(null)],
  ])('não aceita resposta 200 que não é usuário (%s)', async (_caso, resposta) => {
    (global.fetch as jest.Mock).mockResolvedValue(resposta)

    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'unreachable' })
    expect(getUserId()).toBe('')
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-do-joao')
  })

  it('confirmada, regrava a cópia com a hora nova e preenche o id', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ ...eu, name: 'Joana' }))

    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'valid', user: { ...eu, name: 'Joana' } })
    expect(getUserId()).toBe('u1')
    const copia = JSON.parse(await store().getItemAsync(SESSAO))
    expect(copia.user).toEqual({ ...eu, name: 'Joana' })
    expect(copia.confirmedAt).not.toBe('2026-10-07T12:00:00.000Z')
  })
})

// A cópia abre o app sem o servidor. Ela só vale junto do token da mesma
// pessoa: a conferência é pelo `sub` do token, que é o id do usuário.
describe('restoreSession: abrir sem sinal', () => {
  const store = () => require('expo-secure-store')
  const SESSAO = 'swi.auth.session'
  const eu = { id: 'u1', email: 'j@ex.com', name: 'J' }
  const tokenDe = (sub: string) => `h.${btoa(JSON.stringify({ sub, role: 'WORKER' }))}.s`
  const copia = (confirmedAt: string, user = eu) => JSON.stringify({ v: 1, user, confirmedAt })

  beforeEach(async () => {
    (global as any).fetch = jest.fn()
    clearUserId()
    await store().deleteItemAsync('swi.auth.token')
    await store().deleteItemAsync(SESSAO)
  })

  it('com token e cópia recente devolve a cópia e preenche o id, sem ir à rede', async () => {
    await store().setItemAsync('swi.auth.token', tokenDe('u1'))
    const agora = new Date().toISOString()
    await store().setItemAsync(SESSAO, copia(agora))

    expect(await apiAuthBackend.restoreSession()).toEqual({ user: eu, confirmedAt: agora })
    expect(getUserId()).toBe('u1')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sem token não abre', async () => {
    await store().setItemAsync(SESSAO, copia(new Date().toISOString()))
    expect(await apiAuthBackend.restoreSession()).toBeNull()
  })

  it('sem cópia não abre', async () => {
    await store().setItemAsync('swi.auth.token', tokenDe('u1'))
    expect(await apiAuthBackend.restoreSession()).toBeNull()
  })

  it('com a cópia confirmada há 72 h ou mais não abre', async () => {
    await store().setItemAsync('swi.auth.token', tokenDe('u1'))
    await store().setItemAsync(SESSAO, copia(new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()))
    expect(await apiAuthBackend.restoreSession()).toBeNull()
    expect(getUserId()).toBe('')
  })

  it('cópia de outra pessoa não abre com o token desta', async () => {
    await store().setItemAsync('swi.auth.token', tokenDe('u2'))
    await store().setItemAsync(SESSAO, copia(new Date().toISOString()))
    expect(await apiAuthBackend.restoreSession()).toBeNull()
  })

  it('token que não dá para ler não abre', async () => {
    await store().setItemAsync('swi.auth.token', 'token-do-joao')
    await store().setItemAsync(SESSAO, copia(new Date().toISOString()))
    expect(await apiAuthBackend.restoreSession()).toBeNull()
  })
})

// Com sinal fraco a resposta leva até 20 s. O que mudou nesse meio (logout,
// login de outra pessoa) vale mais que ela.
describe('resposta que chega depois de a sessão mudar', () => {
  const store = () => require('expo-secure-store')
  const SESSAO = 'swi.auth.session'
  const ana = { id: 'u1', email: 'ana@ex.com', name: 'Ana' }
  const bia = { id: 'u2', email: 'bia@ex.com', name: 'Bia' }

  function adiada() {
    let resolve!: (v: unknown) => void
    const promise = new Promise((r) => { resolve = r })
    return { promise, resolve }
  }
  // A confirmação lê o token antes de ir à rede: espera o pedido sair.
  const pedidoNoAr = async () => {
    for (let i = 0; i < 50 && (global.fetch as jest.Mock).mock.calls.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(global.fetch).toHaveBeenCalledTimes(1)
  }

  beforeEach(async () => {
    (global as any).fetch = jest.fn()
    clearUserId()
    await store().setItemAsync('swi.auth.token', 'token-da-ana')
    await store().deleteItemAsync(SESSAO)
  })

  it('confirmação que volta depois do logout não regrava a cópia nem o id', async () => {
    const resposta = adiada()
    ;(global.fetch as jest.Mock).mockReturnValueOnce(resposta.promise)
    const confirmando = apiAuthBackend.confirmSession()
    await pedidoNoAr()

    await apiAuthBackend.signOut()
    resposta.resolve(okJson(ana))

    expect(await confirmando).toEqual({ status: 'unreachable' })
    expect(await store().getItemAsync(SESSAO)).toBeNull()
    expect(getUserId()).toBe('')
  })

  it('401 atrasado de quem saiu não apaga o token de quem entrou', async () => {
    const resposta = adiada()
    ;(global.fetch as jest.Mock)
      .mockReturnValueOnce(resposta.promise)
      .mockResolvedValueOnce(okJson({ accessToken: 'token-da-bia', user: bia }))
    const confirmando = apiAuthBackend.confirmSession()
    await pedidoNoAr()

    await apiAuthBackend.signIn({ email: 'bia@ex.com', password: 'x' })
    resposta.resolve(errJson(401, { statusCode: 401, message: 'Unauthorized' }))

    expect(await confirmando).toEqual({ status: 'unreachable' })
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-da-bia')
    expect(getUserId()).toBe('u2')
  })

  it('restauração que termina depois do logout não preenche o id', async () => {
    const tokenDe = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`
    await store().setItemAsync('swi.auth.token', tokenDe('u1'))
    await store().setItemAsync(SESSAO, JSON.stringify({ v: 1, user: ana, confirmedAt: new Date().toISOString() }))

    const restaurando = apiAuthBackend.restoreSession()
    const saindo = apiAuthBackend.signOut()

    expect(await restaurando).toBeNull()
    await saindo
    expect(getUserId()).toBe('')
  })
})

describe('cópia da sessão no login e no logout', () => {
  const store = () => require('expo-secure-store')
  const SESSAO = 'swi.auth.session'
  const eu = { id: 'u1', email: 'j@ex.com', name: 'J' }

  beforeEach(() => { (global as any).fetch = jest.fn() })

  it('signIn grava a cópia de quem entrou, sobre a de quem estava antes', async () => {
    await store().setItemAsync(SESSAO, JSON.stringify({ v: 1, user: { id: 'u9', email: 'x@ex.com', name: 'X' }, confirmedAt: '2026-10-01T00:00:00.000Z' }))
    ;(global.fetch as jest.Mock).mockResolvedValue(okJson({ accessToken: 't1', user: eu }))

    await apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' })

    expect(JSON.parse(await store().getItemAsync(SESSAO)).user).toEqual(eu)
  })

  it('signOut apaga o token e a cópia', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(okJson({ accessToken: 't1', user: eu }))
    await apiAuthBackend.signIn({ email: 'j@ex.com', password: 'senha123' })

    await apiAuthBackend.signOut()

    expect(await store().getItemAsync('swi.auth.token')).toBeNull()
    expect(await store().getItemAsync(SESSAO)).toBeNull()
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
    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'valid', user: eu })
    expect(store().setItemAsync).toHaveBeenCalledWith('swi.auth.token', 'token-antigo', AFU)
    expect(await store().getItemAsync('swi.auth.token')).toBe('token-antigo')

    // Já convertido: as aberturas seguintes não apagam nem regravam o token,
    // e a sessão não fica à mercê de o app morrer entre os dois passos.
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockResolvedValue(okJson(eu))
    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'valid', user: eu })
    expect(store().deleteItemAsync).not.toHaveBeenCalledWith('swi.auth.token')
    expect(store().setItemAsync).not.toHaveBeenCalledWith('swi.auth.token', expect.anything(), expect.anything())
    expect(store().setItemAsync).not.toHaveBeenCalledWith('swi.auth.token', expect.anything())
  })

  it('se a regravação falhar, o token volta como estava e a conversão fica para depois', async () => {
    await sessaoAntiga()
    store().setItemAsync.mockRejectedValueOnce(new Error('keychain'))
    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'valid', user: eu })
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
    expect(await apiAuthBackend.confirmSession()).toEqual({ status: 'valid', user: eu })
    store().getItemAsync.mockImplementation(ler)
  })
})
