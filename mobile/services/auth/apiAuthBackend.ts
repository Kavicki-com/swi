import * as SecureStore from 'expo-secure-store'
import type { AuthBackend, User } from './types'
import { apiRequest } from '../api/http'
import { setUserId, clearUserId } from '../api/session'

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

export const apiAuthBackend: AuthBackend = {
  async signIn({ email, password }): Promise<User> {
    const { accessToken, user } = await apiRequest('/auth/login', { method: 'POST', body: { email, password } })
    await storeToken(accessToken)
    setUserId(user.id)
    return user
  },
  // companyId: empresa escolhida na tela de cadastro — sem ela o worker nasce
  // sem vínculo e fica invisível na fila de aprovação do painel (org-scoped).
  async signUp({ email, password, name, companyId }) { return apiRequest('/auth/signup', { method: 'POST', body: { email, password, name, companyId } }) },
  async confirmSignUp({ email, code }) { await apiRequest('/auth/confirm', { method: 'POST', body: { email, code } }) },
  async resendConfirmation({ email }) { await apiRequest('/auth/confirm/resend', { method: 'POST', body: { email } }) },
  async signOut() { await SecureStore.deleteItemAsync(TOKEN_KEY); clearUserId() },
  async resetPassword({ email }) { await apiRequest('/auth/password/forgot', { method: 'POST', body: { email } }) },
  async confirmReset({ email, code, newPassword }) { await apiRequest('/auth/password/reset', { method: 'POST', body: { email, code, newPassword } }) },
  async changePassword({ currentPassword, newPassword }) { await apiRequest('/auth/password/change', { method: 'POST', body: { currentPassword, newPassword }, auth: true }) },
  async getCurrentUser(): Promise<User | null> {
    const t = await SecureStore.getItemAsync(TOKEN_KEY)
    if (!t) return null
    try {
      const u = await apiRequest('/auth/me', { auth: true })
      setUserId(u.id)
      // A sessão vale mesmo se a conversão falhar: fica para a próxima abertura.
      await convertStoredToken(t).catch(() => undefined)
      return u
    }
    catch (e) {
      // 401/403 = o token nao vale mais. Ele TEM que sair daqui.
      //
      // Engolir a falha e devolver null deixaria o app na tela de login com o
      // token do usuario anterior ainda guardado, e um cadastro iniciado dali
      // gravaria no perfil de outra pessoa.
      //
      // Rede fora (fetch rejeita, sem status) e outra coisa: a sessao pode
      // estar perfeitamente boa e so nao da pra confirmar agora. Apagar ai
      // deslogaria todo mundo a cada soluco do tunel.
      const status = (e as any)?.status
      if (status === 401 || status === 403) { await SecureStore.deleteItemAsync(TOKEN_KEY); clearUserId() }
      return null
    }
  },
}
