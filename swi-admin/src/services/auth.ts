// Fachada de autenticação — todas as operações são reais (backend Nest).
//
// Chaves explícitas em vez de `...realAuthApi`: se o módulo real renomear um
// método, o tsc quebra AQUI, no ponto onde o contrato é declarado, em vez de
// espalhar o erro pelas telas. Sem `export *`: SESSION_STORAGE_KEY e
// TOKEN_STORAGE_KEY canônicos vivem em './api/http', e duplicá-los aqui criaria
// ambiguidade de import para quem consome.
import { authApi as realAuthApi } from './api/auth'

export const authApi = {
  signIn: realAuthApi.signIn,
  signOut: realAuthApi.signOut,
  getSession: realAuthApi.getSession,
  signUpCompany: realAuthApi.signUpCompany,
  changePassword: realAuthApi.changePassword,
  requestPasswordReset: realAuthApi.requestPasswordReset,
  resetPassword: realAuthApi.resetPassword,
}
