// Client HTTP único do swi-admin contra o backend Nest. Todos os domínios que
// migrarem do mock pro backend real passam por aqui — política de token e de
// erro fica em um lugar só.
import { getApiUrl } from './apiConfig'

export const TOKEN_STORAGE_KEY = 'swi.admin.token'
// Mesmo valor do mock (mockApi/auth.ts): a sessão do usuário continua na chave
// existente; só o token JWT é chave nova.
export const SESSION_STORAGE_KEY = 'swi.admin.session'

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
  // Sem nada guardado não há sessão a derrubar. A saída antecipada mantém o
  // evento proporcional ao fato: N chamadas simultâneas que descobrem a MESMA
  // morte de sessão avisam o AuthContext uma vez, não N.
  const guardado =
    window.localStorage.getItem(TOKEN_STORAGE_KEY) !== null ||
    window.localStorage.getItem(SESSION_STORAGE_KEY) !== null
  if (!guardado) return

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

// Um erro bloqueado por CORS e um servidor fora do ar chegam idênticos no catch
// do fetch: os dois rejeitam e o navegador não deixa ler o status. A diferença
// decide o destino de quem está usando o painel, então sondamos o servidor.
//
// Isso não é hipotético. O nginx da API pública carimba
// `Access-Control-Allow-Origin` só em resposta 2xx (falta `always` no
// `add_header`), então TODA resposta de erro dela volta sem o header. Sem
// sondagem, um token expirado prendia o painel: nada carregava, o RequireAuth
// não redirecionava porque ninguém o avisava da sessão morta, e digitar /login
// devolvia pra /. Sobrava um painel zerado sem saída visível.
//
// A correção durável é no servidor (`add_header ... always`). Enquanto ela não
// vem, a sondagem daqui tem que ser específica: perguntar ao /health responde
// só "o host está de pé", e isso é verdade em 401, 403, 409 e 500 igualmente.
// Quem separa é o /auth/me, porque ele responde sobre a CREDENCIAL.
const TEMPO_LIMITE_SONDAGEM = 4000

// Resultado da sondagem em três estados, e não Response-ou-null, porque
// 'rejeitou' e 'expirou' são evidências OPOSTAS: rejeição instantânea é o que
// o navegador faz com resposta não-2xx sem header de CORS, enquanto silêncio
// até o prazo é ausência de resposta. Colapsar os dois em null fazia banco
// travado ser lido como token morto.
type Sondagem = Response | 'rejeitou' | 'expirou'

const leu = (s: Sondagem): s is Response => typeof s !== 'string'

// O prazo é próprio porque host blackholed (pacote engolido, sem RST) pendura o
// fetch até o timeout do navegador, e esse tempo entraria inteiro na espera do
// usuário, somado ao da chamada que já falhou.
async function sondar(url: string, init: RequestInit = {}): Promise<Sondagem> {
  const cancelar = new AbortController()
  let prazo: ReturnType<typeof setTimeout> | undefined
  const expirou = new Promise<'expirou'>((resolve) => {
    prazo = setTimeout(() => {
      // Resolve ANTES de abortar: o abort rejeita o fetch, e se essa rejeição
      // ganhasse a corrida o veredito viraria 'rejeitou', que é exatamente o
      // estado oposto do que acabou de acontecer.
      resolve('expirou')
      cancelar.abort()
    }, TEMPO_LIMITE_SONDAGEM)
  })
  try {
    // no-store: um 200 guardado do /health provaria o passado, não o agora.
    return await Promise.race([
      fetch(url, { ...init, cache: 'no-store', signal: cancelar.signal }),
      expirou,
    ])
  } catch {
    return 'rejeitou'
  } finally {
    clearTimeout(prazo)
  }
}

type Veredito = 'sessao-morta' | 'sessao-viva' | 'sem-resposta'

async function diagnosticar(baseUrl: string, token: string): Promise<Veredito> {
  const eu = await sondar(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })

  // Legível = o servidor respondeu SOBRE ESTE token. Só 401 condena a sessão;
  // 429 ou 500 na sondagem não são prova de credencial morta, e na dúvida a
  // sessão fica de pé (deslogar por engano custa o formulário aberto).
  if (leu(eu)) return eu.status === 401 ? 'sessao-morta' : 'sessao-viva'

  // Prazo estourado não condena nada: um 401 com o header suprimido rejeita na
  // hora, não fica mudo até o prazo. Silêncio aponta pra servidor em sofrimento,
  // e aí o /health responder rápido não prova credencial morta, prova só que ele
  // não depende do que travou (o /auth/me consulta o banco, o /health não).
  if (eu === 'expirou') return 'sem-resposta'

  // Rejeitou. Se o /health (público, 2xx, portanto com o header de CORS
  // presente) responde, o host está de pé e o CORS funciona, logo a resposta
  // que sumiu era da chamada autenticada, com o header suprimido por não ser
  // 2xx, e a sondagem autenticada sumiu junto pelo mesmo motivo.
  const saude = await sondar(`${baseUrl}/health`)
  return leu(saude) && saude.ok ? 'sessao-morta' : 'sem-resposta'
}

// Uma tela carrega várias coleções de uma vez. Sem compartilhar a sondagem,
// cada falha abria a própria rodada de rede e derrubava o contexto de novo pelo
// mesmo fato: N sondagens e N redirecionamentos para um único token morto.
let diagnosticoEmVoo: Promise<Veredito> | null = null

function diagnosticarUmaVez(baseUrl: string, token: string): Promise<Veredito> {
  diagnosticoEmVoo ??= diagnosticar(baseUrl, token).finally(() => {
    diagnosticoEmVoo = null
  })
  return diagnosticoEmVoo
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  // keepSessionOn401: pra rotas onde 401 é resposta de NEGÓCIO e não sessão
  // morta (ex.: /auth/password/change com a senha atual errada). Sem isso,
  // errar a senha atual desloga o admin.
  // onResponse: gancho pra ler a Response crua (headers) sem duplicar a
  // política de token/erro daqui. Usado pela paginação, que traz o total da
  // coleção em `X-Total-Count` enquanto o corpo continua sendo só o array.
  opts: { keepSessionOn401?: boolean; onResponse?: (res: Response) => void } = {},
): Promise<T> {
  const baseUrl = getApiUrl()
  const token = readToken()
  let res: Response
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: mergeHeaders(
        {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        init.headers,
      ),
    })
  } catch (erro) {
    // Sem resposta do servidor (offline, DNS, CORS, abort: convertemos tudo de
    // propósito pra manter o contrato "todo erro de apiFetch é ApiError").
    // status 0 = nenhuma resposta pôde ser lida.
    //
    // Cancelamento cai neste mesmo catch e NÃO diz nada sobre o servidor nem
    // sobre o token: quem aborta é o próprio painel, ao desmontar a tela ou
    // trocar de filtro. Sondar aqui deslogava quem só saiu da tela no meio do
    // carregamento.
    const cancelado =
      init.signal?.aborted === true || (erro as { name?: string } | null)?.name === 'AbortError'

    if (token && !opts.keepSessionOn401 && !cancelado) {
      const veredito = await diagnosticarUmaVez(baseUrl, token)
      // Token morto tratado igual ao 401 legível: é o que impede a sessão morta
      // de prender o painel (ver diagnosticar acima).
      if (veredito === 'sessao-morta') {
        clearSession()
        throw new ApiError('Sua sessão expirou. Entre novamente.', 401)
      }
      // Token vivo e ainda assim ilegível: era 403, 409, 400 ou 500 com o header
      // de CORS suprimido. O motivo real morreu no navegador e não há como
      // recuperá-lo daqui, mas dizer "não foi possível conectar" mandaria o
      // admin caçar rede, e derrubar a sessão custaria o formulário aberto.
      if (veredito === 'sessao-viva') {
        throw new ApiError(
          'O servidor recusou a operação e não informou o motivo. Sua sessão continua ativa.',
          0,
        )
      }
    }
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
