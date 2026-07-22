import { authApi as realAuthApi } from './api/auth'
import { authApi as mockAuthApi } from './mockApi/auth'

// signIn/signOut/getSession + o onboarding de empresa e a recuperação de senha
// são REAIS (backend Nest). O `signUp` legado (que logava direto) segue no mock
// só pra não quebrar o useAuth; as telas de auth usam signUpCompany. Sem
// `export *` do mock: SESSION_STORAGE_KEY/TOKEN_STORAGE_KEY canônicos vivem em
// './api/http' — evita ambiguidade de import pra quem consome.
// Chaves explícitas (não `...realAuthApi`): se o real renomear um método, o
// tsc quebra aqui em vez de deixar o mock ativo em produção sem aviso.
export const authApi = {
  ...mockAuthApi,
  signIn: realAuthApi.signIn,
  signOut: realAuthApi.signOut,
  getSession: realAuthApi.getSession,
  signUpCompany: realAuthApi.signUpCompany,
  requestPasswordReset: realAuthApi.requestPasswordReset,
  resetPassword: realAuthApi.resetPassword,
}
