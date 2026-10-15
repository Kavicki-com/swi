// Auth real contra o backend Nest (POST /auth/login). Mantém o envelope
// ServiceResponse pra que useAuth e as telas não precisem mudar na migração.
import type { PanelLevel, User } from '@/services/types'
import type { ServiceResponse } from '@/services/types'
import { ApiError, apiFetch, clearSession, SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from './http'

type LoginResponse = { accessToken: string; user: { id: string; email: string; name: string } }

// Lê a role do payload do JWT. NÃO é validação de segurança (quem valida é o
// backend em toda rota): serve pra barrar cedo um worker que tentou o painel,
// com mensagem clara em vez de 403 em cada tela, e pra saber o nível da sessão.
const roleOf = (token: string): string => {
  try {
    // JWT usa base64url; atob só entende base64 clássico.
    const payload = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).role ?? ''
  } catch {
    return ''
  }
}

/** Nível do painel pelo papel do token; qualquer outro papel não entra. */
const levelOf = (token: string): PanelLevel | null => {
  const role = roleOf(token)
  return role === 'ADMIN' || role === 'SUPERVISOR' ? role : null
}

/** O que o usuário logado pode fazer, calculado no backend (GET /auth/me). */
export type MyAccess = { role: string; permissions: string[] }

// O backend devolve { id, email, name }; o painel consome o shape User.
// created_at é sintético (timestamp do login, não da criação da conta): não
// usar pra exibir "membro desde".
const toAdminUser = (u: LoginResponse['user'], level: PanelLevel): User => ({
  id: u.id,
  email: u.email,
  full_name: u.name,
  role: 'admin',
  level,
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
  }): Promise<ServiceResponse<User>> => {
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
      const level = levelOf(res.accessToken)
      if (!level) {
        return {
          data: null,
          error: { message: 'Acesso restrito a administradores e supervisores.' },
        }
      }
      const user = toAdminUser(res.user, level)
      window.localStorage.setItem(TOKEN_STORAGE_KEY, res.accessToken)
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user))
      return { data: user, error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : 'Falha no login' } }
    }
  },

  // Nível e permissões do usuário logado, da matriz do backend. A coluna
  // "Permissões" das configurações mostra isto; o painel não tem cópia da matriz.
  me: async (): Promise<ServiceResponse<MyAccess>> => {
    try {
      const u = await apiFetch<{ role: string; permissions?: string[] }>('/auth/me')
      return { data: { role: u.role, permissions: u.permissions ?? [] }, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao carregar' },
      }
    }
  },

  signOut: async (): Promise<ServiceResponse<null>> => {
    clearSession()
    return { data: null, error: null }
  },

  getSession: async (): Promise<ServiceResponse<User | null>> => {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY)
    // Sessão sem token é órfã (ex.: 401 do apiFetch derruba as duas chaves,
    // mas estado antigo pode ter só a sessão) — trata como deslogado pra não
    // renderizar o painel com credencial morta.
    if (!raw || !token) return { data: null, error: null }
    try {
      // O nível vem do token, não do JSON gravado: sessão anterior aos níveis
      // não tem o campo, e o token é o que o backend assinou.
      return {
        data: { ...(JSON.parse(raw) as User), level: levelOf(token) ?? 'ADMIN' },
        error: null,
      }
    } catch {
      return { data: null, error: null }
    }
  },

  // Foto do admin logado, URL assinada. Vem do /users/:id dele, que responde
  // mesmo sem perfil preenchido; o /profile/me devolve 404 nesse caso e o
  // navegador registra erro no console. Sem foto ou com falha: null.
  avatarOf: async (userId: string): Promise<string | null> => {
    try {
      const u = await apiFetch<{ avatar?: string | null }>(`/users/${encodeURIComponent(userId)}`)
      return u?.avatar || null
    } catch {
      return null
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
  }): Promise<ServiceResponse<{ nextStep: 'CHECK_EMAIL' }>> => {
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
  }): Promise<ServiceResponse<{ sent: true }>> => {
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

  // Troca de senha autenticada do settings (POST /auth/password/change): exige
  // a senha atual. O backend responde 401 genérico quando ela não confere, e
  // aqui isso vira o erro específico da tela.
  changePassword: async ({
    currentPassword,
    newPassword,
  }: {
    currentPassword: string
    newPassword: string
  }): Promise<ServiceResponse<{ changed: true }>> => {
    try {
      await apiFetch<unknown>(
        '/auth/password/change',
        {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword }),
        },
        // 401 aqui = senha atual errada (resposta de negócio), não derruba a sessão.
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
  }): Promise<ServiceResponse<{ reset: true }>> => {
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
