import * as SecureStore from 'expo-secure-store'
import type { AuthBackend, SessionCheck, StoredSession, User } from './types'
import { apiRequest } from '../api/http'
import { setUserId, clearUserId } from '../api/session'
import { clearStoredSession, isFresh, isUser, readStoredSession, writeStoredSession } from './storedSession'

const TOKEN_KEY = 'swi.auth.token'
// Marca de que o token guardado já está legível com o aparelho bloqueado.
const TOKEN_CONVERTED_KEY = 'swi.auth.token.afu'

// Grava o token legível depois do primeiro desbloqueio, e não só com o
// aparelho desbloqueado (o padrão): o GPS em segundo plano envia com o iPhone
// no bolso, e sem o token cada envio falharia. Gravar por cima de um item
// existente só troca o valor, nunca a acessibilidade, por isso apaga antes.
// Se a gravação nova falhar, o token volta como estava: perder a sessão é
// pior que um envio que espera o desbloqueio.
async function storeToken(token: string) {
  const afterFirstUnlock = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
  await SecureStore.deleteItemAsync(TOKEN_KEY)
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token, afterFirstUnlock)
  } catch {
    await SecureStore.setItemAsync(TOKEN_KEY, token)
    await SecureStore.deleteItemAsync(TOKEN_CONVERTED_KEY).catch(() => undefined)
    return
  }
  await SecureStore.setItemAsync(TOKEN_CONVERTED_KEY, '1', afterFirstUnlock).catch(() => undefined)
}

// Sessão de antes desta versão: o token foi gravado com o padrão e precisa
// ser regravado. Uma vez só, pela marca: apagar e gravar a cada abertura
// deixaria a sessão à mercê de o app morrer entre os dois passos.
async function convertStoredToken(token: string) {
  if (await SecureStore.getItemAsync(TOKEN_CONVERTED_KEY)) return
  await storeToken(token)
}

// Id do dono do token, lido do próprio token (o `sub` do JWT), sem conferir a
// assinatura: serve só para casar o token com a cópia da sessão. Quem decide
// se o token vale é o servidor.
function tokenSubject(token: string): string | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const sub = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)))?.sub
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

// Muda a cada login e a cada sessão esquecida (logout ou revogação). Uma
// confirmação ou restauração que começou antes, e que com sinal fraco pode
// levar 20 s, não mexe em nada do que veio depois: nem no id, nem na cópia,
// nem no token de quem entrou.
let generation = 0

// Cada passo vale sozinho: uma falha do Keychain ao apagar o token não pode
// deixar a cópia nem o id para trás.
async function forgetSession() {
  generation += 1
  clearUserId()
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined)
  await clearStoredSession().catch(() => undefined)
}

export const apiAuthBackend: AuthBackend = {
  async signIn({ email, password }): Promise<User> {
    generation += 1
    const { accessToken, user } = await apiRequest('/auth/login', { method: 'POST', body: { email, password } })
    await storeToken(accessToken)
    setUserId(user.id)
    // Por cima da cópia de quem estava antes. Se esta gravação falhar, a
    // cópia antiga não abre com o token novo: o `sub` não bate.
    await writeStoredSession(user, new Date()).catch(() => undefined)
    return user
  },
  // companyId: empresa escolhida na tela de cadastro — sem ela o worker nasce
  // sem vínculo e fica invisível na fila de aprovação do painel (org-scoped).
  async signUp({ email, password, name, companyId }) { return apiRequest('/auth/signup', { method: 'POST', body: { email, password, name, companyId } }) },
  async confirmSignUp({ email, code }) { await apiRequest('/auth/confirm', { method: 'POST', body: { email, code } }) },
  async resendConfirmation({ email }) { await apiRequest('/auth/confirm/resend', { method: 'POST', body: { email } }) },
  async signOut() { await forgetSession() },
  async resetPassword({ email }) { await apiRequest('/auth/password/forgot', { method: 'POST', body: { email } }) },
  async confirmReset({ email, code, newPassword }) { await apiRequest('/auth/password/reset', { method: 'POST', body: { email, code, newPassword } }) },
  async changePassword({ currentPassword, newPassword }) { await apiRequest('/auth/password/change', { method: 'POST', body: { currentPassword, newPassword }, auth: true }) },
  async restoreSession(): Promise<StoredSession | null> {
    const mine = generation
    const t = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null)
    if (!t) return null
    const stored = await readStoredSession()
    if (mine !== generation) return null
    // A cópia só vale com o token da mesma pessoa e por 72 h desde a última
    // confirmação: passou disso, só o servidor abre o app.
    if (!stored || tokenSubject(t) !== stored.user.id || !isFresh(stored, new Date())) return null
    setUserId(stored.user.id)
    return stored
  },
  async confirmSession(): Promise<SessionCheck> {
    const mine = generation
    let t: string | null
    try {
      t = await SecureStore.getItemAsync(TOKEN_KEY)
    } catch {
      // Keychain fechado (iPhone reiniciado e ainda não desbloqueado): não é
      // falta de token, e a sessão não pode cair por isso.
      return { status: 'unreachable' }
    }
    if (!t) return { status: 'none' }
    let u: unknown
    try {
      u = await apiRequest('/auth/me', { auth: true })
    }
    catch (e) {
      // A sessão mudou enquanto a resposta vinha: ela fala de outro token.
      if (mine !== generation) return { status: 'unreachable' }
      // 401/403 DA API = o token nao vale mais. Ele TEM que sair daqui.
      //
      // Engolir a falha deixaria o app na tela de login com o token do
      // usuario anterior ainda guardado, e um cadastro iniciado dali gravaria
      // no perfil de outra pessoa.
      //
      // Rede fora (fetch rejeita, sem status) e outra coisa: a sessao pode
      // estar perfeitamente boa e so nao da pra confirmar agora. Apagar ai
      // deslogaria todo mundo a cada soluco do tunel. Vale o mesmo para 401 ou
      // 403 sem o corpo do Nest: quem respondeu foi um proxy ou o portal de
      // uma rede, e não a API.
      const status = (e as any)?.status
      if ((status === 401 || status === 403) && (e as any)?.apiError === true) {
        await forgetSession()
        return { status: 'revoked' }
      }
      return { status: 'unreachable' }
    }
    // Portal de rede que responde 200 com uma página chega aqui como `{}`.
    if (mine !== generation || !isUser(u)) return { status: 'unreachable' }
    const user = { id: u.id, email: u.email, name: u.name }
    setUserId(user.id)
    // A sessão vale mesmo se a conversão falhar: fica para a próxima abertura.
    await convertStoredToken(t).catch(() => undefined)
    if (mine !== generation) return { status: 'unreachable' }
    await writeStoredSession(user, new Date()).catch(() => undefined)
    return { status: 'valid', user }
  },
}
