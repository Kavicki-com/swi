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

export function applyCors(app: INestApplication): void {
  const origins = corsOrigins(process.env)
  // Origins visíveis no boot: sem isto, cair no default em produção (ou uma
  // origin com barra final, que nunca casa com o header Origin) vira só um erro
  // de CORS no browser, sem rastro no servidor.
  new Logger('Bootstrap').log(`CORS liberado para: ${origins.join(', ') || '(nenhuma origin — CORS fechado)'}`)
  app.enableCors({ origin: origins, credentials: false })
}
