// Auth real contra o backend Nest (POST /auth/login). Mantém o envelope
// MockResponse pra que useAuth e as telas não precisem mudar na migração.
import type { User } from '@/services/types'
import type { MockResponse } from '@/services/mockApi/types'
import { ApiError, apiFetch, clearSession, SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from './http'

type LoginResponse = { accessToken: string; user: { id: string; email: string; name: string } }

// Lê a role do payload do JWT. NÃO é validação de segurança (quem valida é o
// backend em toda rota) — serve pra barrar cedo um worker que tentou o painel,
// com mensagem clara em vez de 403 em cada tela.
const roleOf = (token: string): string => {
  try {
    // JWT usa base64url; atob só entende base64 clássico.
    const payload = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).role ?? ''
  } catch {
    return ''
  }
}

// O backend devolve { id, email, name }; o painel consome o shape User.
// created_at é sintético (timestamp do login, não da criação da conta) — não
// usar pra exibir "membro desde".
const toAdminUser = (u: LoginResponse['user']): User => ({
  id: u.id,
  email: u.email,
  full_name: u.name,
  role: 'admin',
  consent_given_at: null,
  created_at: new Date().toISOString(),
})

export const authApi = {
  signIn: async ({
    email,
    password,
  }: {
    email: string
    password: string
  }): Promise<MockResponse<User>> => {
    try {
      const res = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      // 200 sem corpo/sem token = infra quebrada; sem o guard, o TypeError
      // (em inglês) vazaria pro FormError.
      if (!res?.accessToken) {
        return { data: null, error: { message: 'Resposta inesperada do servidor.' } }
      }
      if (roleOf(res.accessToken) !== 'ADMIN') {
        return { data: null, error: { message: 'Acesso restrito a administradores.' } }
      }
      const user = toAdminUser(res.user)
      window.localStorage.setItem(TOKEN_STORAGE_KEY, res.accessToken)
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user))
      return { data: user, error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : 'Falha no login' } }
    }
  },

  signOut: async (): Promise<MockResponse<null>> => {
    clearSession()
    return { data: null, error: null }
  },

  getSession: async (): Promise<MockResponse<User | null>> => {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    // Sessão sem token é órfã (ex.: 401 do apiFetch derruba as duas chaves,
    // mas estado antigo pode ter só a sessão) — trata como deslogado pra não
    // renderizar o painel com credencial morta.
    if (!raw || !window.localStorage.getItem(TOKEN_STORAGE_KEY)) return { data: null, error: null }
    try {
      return { data: JSON.parse(raw) as User, error: null }
    } catch {
      return { data: null, error: null }
    }
  },

  // Onboarding de empresa (POST /auth/signup-company). NÃO cria sessão: o admin
  // nasce APPROVED porém não-verificado — só entra depois de definir a senha
  // pelo link. A tela mostra "confirme seu e-mail", não navega pro painel.
  signUpCompany: async (input: {
    company: {
      name: string
      cnpj: string
      site?: string
      cep: string
      street: string
      number: string
      neighborhood: string
      uf: string
    }
    responsible: { name: string; phone: string; email: string; role: string }
  }): Promise<MockResponse<{ nextStep: 'CHECK_EMAIL' }>> => {
    try {
      await apiFetch<unknown>('/auth/signup-company', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return { data: { nextStep: 'CHECK_EMAIL' }, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao cadastrar' },
      }
    }
  },

  // Recuperação do admin (POST /auth/password/forgot-admin) — endpoint que manda
  // LINK, distinto do /auth/password/forgot code-based do mobile. Silencioso por
  // design: 200 sempre (não vaza se o e-mail existe).
  requestPasswordReset: async ({
    email,
  }: {
    email: string
  }): Promise<MockResponse<{ sent: true }>> => {
    try {
      await apiFetch<unknown>('/auth/password/forgot-admin', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      return { data: { sent: true }, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao enviar instruções' },
      }
    }
  },

  // QA F (2026-07-24): troca de senha autenticada do settings (POST
  // /auth/password/change) — exige a senha atual. O backend responde 401
  // genérico quando ela não confere; traduzimos pro erro específico da tela.
  changePassword: async ({
    currentPassword,
    newPassword,
  }: {
    currentPassword: string
    newPassword: string
  }): Promise<MockResponse<{ changed: true }>> => {
    try {
      await apiFetch<unknown>(
        '/auth/password/change',
        {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword }),
        },
        // 401 aqui = senha atual errada (resposta de negócio) — não derruba a sessão.
        { keepSessionOn401: true },
      )
      return { data: { changed: true }, error: null }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        return { data: null, error: { message: 'Senha atual incorreta.' } }
      }
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao alterar a senha' },
      }
    }
  },

  // Define/redefine a senha (POST /auth/password/reset) com o código embutido no
  // link (email + code vêm da URL). O mesmo endpoint do mobile; aqui também
  // destrava o admin recém-criado (o backend marca emailVerified=true).
  resetPassword: async ({
    email,
    code,
    newPassword,
  }: {
    email: string
    code: string
    newPassword: string
  }): Promise<MockResponse<{ reset: true }>> => {
    try {
      await apiFetch<unknown>('/auth/password/reset', {
        method: 'POST',
        body: JSON.stringify({ email, code, newPassword }),
      })
      return { data: { reset: true }, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao redefinir senha' },
      }
    }
  },
}
