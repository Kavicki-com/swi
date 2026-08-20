import { Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'

// Origins do painel web (swi-admin). Default = dev server do Vite; em AWS o
// CORS_ORIGINS injetado lista os domínios reais. Setar a env vazia fecha o CORS
// de propósito (`??` só cai no default se ela estiver ausente).
export function corsOrigins(env: NodeJS.ProcessEnv): string[] {
  return (env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

// CORS do WebSocket (socket.io). No modo proxy devolve undefined: o handshake
// de polling é simple request (sem preflight), então o `*` do nginx basta — e
// o socket.io emitindo ACAO próprio duplicaria o header, igual ao HTTP.
export function wsCorsOptions(env: NodeJS.ProcessEnv): { origin: string[] } | undefined {
  if (env.CORS_PROXY_SETS_ORIGIN === '1') return undefined
  return { origin: corsOrigins(env) }
}

// O `add_header` do nginx, SEM a flag `always`, só carimba nesta lista de
// status. Foi a descoberta que explicou a sessão morta em produção: o curinga
// do host não sai em toda resposta, sai só aqui. Todo erro da API chega no
// navegador sem ele e vira promise rejeitada de status ilegível, então nem a
// mensagem do class-validator nem 'E-mail já cadastrado' alcançam a tela.
//
// Preencher exatamente o COMPLEMENTO desta lista devolve o erro legível ao
// painel sem nunca duplicar o header, porque os dois conjuntos são disjuntos.
const STATUS_COBERTOS_PELO_NGINX = new Set([200, 201, 204, 206, 301, 302, 303, 304, 307, 308])

type RespostaHttp = {
  setHeader(nome: string, valor: string): void
  statusCode: number
  end(): void
  writeHead?: (...args: unknown[]) => unknown
}

export function applyCors(app: INestApplication): void {
  // Hospedagem atual: o nginx do host injeta `Access-Control-Allow-Origin: *`
  // no nível do server, e o conf é do root, não dá pra remover. Se a API emitir
  // o próprio ACAO num status que ele já cobre, o navegador recebe DOIS valores
  // ('https://..., *') e bloqueia. No modo proxy a API delega o ACAO nesses
  // status e responde só o que o nginx não põe: os headers e métodos do
  // preflight, mais o ACAO nos status que ficam de fora da lista.
  //
  // Segurança: auth é Bearer token, sem cookie nem sessão, então o `*` não abre
  // CSRF; é o mesmo modelo do `credentials: false` abaixo.
  if (process.env.CORS_PROXY_SETS_ORIGIN === '1') {
    // Escape hatch sem deploy de código: se a hospedagem passar a carimbar em
    // erro também, os dois se somariam e o navegador voltaria a bloquear, agora
    // por 'multiple values'. Ligar esta env desliga o preenchimento.
    const preencherErro = process.env.CORS_PROXY_SETS_ORIGIN_ON_ERRORS !== '1'
    const log = new Logger('Bootstrap')
    log.log('CORS: Access-Control-Allow-Origin delegado ao proxy (Cloudez injeta *)')
    if (preencherErro) {
      log.log('CORS: a API preenche o Access-Control-Allow-Origin nos status que o proxy não cobre')
    }
    app.use((req: { method: string }, res: RespostaHttp, next: () => void) => {
      // PATCH entrou em 31/07/2026, junto com editar mensagem do chat. Sem
      // ele o preflight respondia 204 e mesmo assim o navegador bloqueava a
      // requisição real, sem deixar rastro no servidor. Esta lista é fixa, ou
      // seja, NÃO acompanha as rotas sozinha: verbo novo na API exige mexer
      // aqui, e é para isso que existe o teste que percorre os verbos.
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
      // ngrok-skip-browser-warning: relíquia da era ngrok que builds antigos
      // do painel (em cache de navegador) ainda mandam, e permitir é inócuo.
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,ngrok-skip-browser-warning')

      // O status ainda não existe neste ponto: quem o conhece é o writeHead,
      // por onde TODA resposta passa, inclusive a que o exception filter monta
      // e a que o Express despacha implicitamente pelo end(). Daí o gancho, em
      // vez de um setHeader direto aqui.
      if (preencherErro && typeof res.writeHead === 'function') {
        const despachar = res.writeHead.bind(res)
        res.writeHead = (...args: unknown[]) => {
          const status = typeof args[0] === 'number' ? args[0] : res.statusCode
          if (!STATUS_COBERTOS_PELO_NGINX.has(status)) {
            res.setHeader('Access-Control-Allow-Origin', '*')
          }
          return despachar(...args)
        }
      }

      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        return res.end()
      }
      next()
    })
    return
  }
  const origins = corsOrigins(process.env)
  // Origins visíveis no boot: sem isto, cair no default em produção (ou uma
  // origin com barra final, que nunca casa com o header Origin) vira só um erro
  // de CORS no browser, sem rastro no servidor.
  new Logger('Bootstrap').log(`CORS liberado para: ${origins.join(', ') || '(nenhuma origin — CORS fechado)'}`)
  app.enableCors({ origin: origins, credentials: false })
}
