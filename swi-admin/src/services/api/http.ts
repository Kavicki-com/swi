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

// Apagar o localStorage NÃO avisa o React: o `user` do AuthContext continuaria
// truthy e a tela ficaria viva com credencial morta (RequireAuth não redireciona,
// GuestOnly não deixa ir pro /login — sem saída a não ser F5). Este evento é o
// canal explícito pra derrubar o contexto na PRÓPRIA aba; o evento nativo
// `storage` só dispara nas OUTRAS, e o AuthProvider assina os dois.
export const SESSION_CLEARED_EVENT = 'swi:session-cleared'

export const readToken = (): string | null => window.localStorage.getItem(TOKEN_STORAGE_KEY)

export const clearSession = (): void => {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  window.localStorage.removeItem(SESSION_STORAGE_KEY)
  window.dispatchEvent(new Event(SESSION_CLEARED_EVENT))
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

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  // keepSessionOn401: pra rotas onde 401 é resposta de NEGÓCIO e não sessão
  // morta (ex.: /auth/password/change com a senha atual errada). Sem isso,
  // errar a senha atual deslogava o admin (achado no E2E de 2026-07-24).
  // onResponse: gancho pra ler a Response crua (headers) sem duplicar a
  // política de token/erro daqui. Usado pela paginação, que traz o total da
  // coleção em `X-Total-Count` enquanto o corpo continua sendo só o array.
  opts: { keepSessionOn401?: boolean; onResponse?: (res: Response) => void } = {},
): Promise<T> {
  const token = readToken()
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: mergeHeaders(
        {
          'Content-Type': 'application/json',
          // QA remoto via túnel: no plano free o ngrok intercepta requests de
          // browser com uma página interstitial (Ngrok-Error-Code
          // ERR_NGROK_6024) — HTML, status 200 e SEM Access-Control-Allow-
          // Origin, o que o browser reporta como erro de CORS. Este header
          // pula a interstitial. Inerte quando não há túnel no caminho.
          'ngrok-skip-browser-warning': 'true',
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

  opts.onResponse?.(res)

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Sem corpo (204) e corpo malformado caem juntos aqui, de propósito: o
    // backend é nosso, 200-com-não-JSON é infra quebrada e o piloto não precisa
    // de strictness — segue com null.
  }

  if (!res.ok) {
    // 401 COM token = a credencial que mandamos morreu. Derruba a sessão local
    // (o evento do clearSession zera o AuthContext, que faz o RequireAuth
    // redirecionar) e troca a mensagem: o JwtAuthGuard usa a exception default
    // do Passport, que responde 'Unauthorized' cru em inglês.
    //
    // 401 SEM token é outra coisa: é o /auth/login recusando a credencial. Aí a
    // mensagem do backend já vem em pt e é a única que explica o que houve —
    // substituir por "sua sessão expirou" mentiria pra quem só errou a senha.
    if (res.status === 401 && token && !opts.keepSessionOn401) {
      clearSession()
      throw new ApiError('Sua sessão expirou. Entre novamente.', 401)
    }
    const message =
      (body as { message?: string | string[] } | null)?.message ?? `Erro ${res.status}`
    throw new ApiError(Array.isArray(message) ? message.join(', ') : message, res.status)
  }
  return body as T
}
