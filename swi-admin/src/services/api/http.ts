// Client HTTP único do swi-admin contra o backend Nest. Todos os domínios que
// migrarem do mock pro backend real passam por aqui — política de token e de
// erro fica em um lugar só.
export const TOKEN_STORAGE_KEY = 'swi.admin.token'
// Mesmo valor do mock (mockApi/auth.ts): a sessão do usuário continua na chave
// existente; só o token JWT é chave nova.
export const SESSION_STORAGE_KEY = 'swi.admin.session'

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  console.warn(
    '[api] VITE_API_URL ausente no build de produção — toda chamada vai pra http://localhost:3000. Configure no .env (ver .env.example).',
  )
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const readToken = (): string | null => window.localStorage.getItem(TOKEN_STORAGE_KEY)

export const clearSession = (): void => {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  window.localStorage.removeItem(SESSION_STORAGE_KEY)
}

// Aceita as 3 formas de HeadersInit (Record, Headers, pares [string, string][])
// — spread direto de `Headers` viraria `{}` e perderia headers em silêncio.
// Header do caller vence o default, comparando nomes case-insensitive.
const mergeHeaders = (
  defaults: Record<string, string>,
  extra?: HeadersInit,
): Record<string, string> => {
  const merged: Record<string, string> = { ...defaults }
  new Headers(extra).forEach((value: string, name: string) => {
    // `name` já vem minúsculo; remove o default equivalente pra não duplicar.
    for (const key of Object.keys(merged)) {
      if (key.toLowerCase() === name) delete merged[key]
    }
    merged[name] = value
  })
  return merged
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken()
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: mergeHeaders(
        {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        init.headers,
      ),
    })
  } catch {
    // Sem resposta do servidor (offline, DNS, CORS — e também abort: convertemos
    // tudo de propósito pra manter o contrato "todo erro de apiFetch é ApiError").
    // status 0 = a request nem chegou no backend.
    throw new ApiError('Não foi possível conectar ao servidor', 0)
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Sem corpo (204) e corpo malformado caem juntos aqui, de propósito: o
    // backend é nosso, 200-com-não-JSON é infra quebrada e o piloto não precisa
    // de strictness — segue com null.
  }

  if (!res.ok) {
    // Token expirado/inválido: derruba a sessão local. O RequireAuth redireciona
    // pro login no próximo render — evita loop de request com credencial morta.
    if (res.status === 401) clearSession()
    const message =
      (body as { message?: string | string[] } | null)?.message ?? `Erro ${res.status}`
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message, res.status)
  }
  return body as T
}
