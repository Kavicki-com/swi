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

export function applyCors(app: INestApplication): void {
  // Hospedagem Cloudez (deploy 2026-07-29): o nginx do host injeta
  // `Access-Control-Allow-Origin: *` em TODA resposta, no nível do server, e o
  // conf é do root — não dá pra remover. Se a API emitir o próprio ACAO, o
  // navegador recebe DOIS valores ("https://..., *") e bloqueia. No modo proxy
  // a API delega o ACAO e responde só o que o nginx não põe: os headers e
  // métodos do preflight.
  //
  // Segurança: auth é Bearer token, sem cookie/sessão — o `*` do proxy não
  // abre CSRF; é o mesmo modelo do `credentials: false` abaixo.
  if (process.env.CORS_PROXY_SETS_ORIGIN === '1') {
    new Logger('Bootstrap').log('CORS: Access-Control-Allow-Origin delegado ao proxy (Cloudez injeta *)')
    app.use(
      (
        req: { method: string },
        res: { setHeader(k: string, v: string): void; statusCode: number; end(): void },
        next: () => void,
      ) => {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
        // ngrok-skip-browser-warning: relíquia da era ngrok que builds antigos
        // do painel (em cache de navegador) ainda mandam — permitir é inócuo.
        res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,ngrok-skip-browser-warning')
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          return res.end()
        }
        next()
      },
    )
    return
  }
  const origins = corsOrigins(process.env)
  // Origins visíveis no boot: sem isto, cair no default em produção (ou uma
  // origin com barra final, que nunca casa com o header Origin) vira só um erro
  // de CORS no browser, sem rastro no servidor.
  new Logger('Bootstrap').log(`CORS liberado para: ${origins.join(', ') || '(nenhuma origin — CORS fechado)'}`)
  app.enableCors({ origin: origins, credentials: false })
}
