import * as SecureStore from 'expo-secure-store'
import type { AuthBackend, User } from './types'
import { apiRequest } from '../api/http'
import { setUserId, clearUserId } from '../api/session'

const TOKEN_KEY = 'swi.auth.token'

export const apiAuthBackend: AuthBackend = {
  async signIn({ email, password }): Promise<User> {
    const { accessToken, user } = await apiRequest('/auth/login', { method: 'POST', body: { email, password } })
    await SecureStore.setItemAsync(TOKEN_KEY, accessToken)
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
  async getCurrentUser(): Promise<User | null> {
    const t = await SecureStore.getItemAsync(TOKEN_KEY)
    if (!t) return null
    try { const u = await apiRequest('/auth/me', { auth: true }); setUserId(u.id); return u }
    catch (e) {
      // 401/403 = o token nao vale mais. Ele TEM que sair daqui.
      //
      // INCIDENTE 2026-07-27: engolir a falha e devolver null deixava o app na
      // tela de login com o token do usuario anterior ainda guardado. Quem
      // comecasse um cadastro dali escrevia no perfil alheio — o "Teste
      // Ricardo" nasceu vazio e os dados dele foram parar no "Joao Tester".
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
