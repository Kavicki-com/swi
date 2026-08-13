import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
// pg-boss v12 é ESM-only ("type":"module") e exporta { PgBoss } (sem default).
// Usamos `import type` (apagado no emit) + `await import(...)` preguiçoso dentro
// de onModuleInit, para o pacote ESM nunca ser carregado no caminho de teste
// (inline seam) — mantém os e2e/unit determinísticos sob jest (CommonJS).
import type { PgBoss as PgBossType } from 'pg-boss'

// Genérico no formato do payload: quem registra o worker é quem sabe o que a
// fila carrega naquele nome. O mapa interno guarda a forma apagada (`unknown`),
// porque a fila em si não tem tipo: o dado volta do pg-boss como JSON.
type Handler<T = unknown> = (data: T) => Promise<void>

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(QueueService.name)
  private boss: PgBossType | null = null
  private readonly handlers = new Map<string, Handler>()
  private readonly inline = process.env.NODE_ENV === 'test' // seam: roda inline nos testes

  async onModuleInit() {
    if (this.inline) return // sem pg-boss em test-env (determinismo dos e2e)
    // `new Function` esconde o import() do tsc: com module=commonjs ele
    // transpilaria pra require(), que explode com ERR_REQUIRE_ESM no Node <22
    // (pg-boss v12 é ESM-only). O Docker local roda Node 22 e mascarava isso;
    // a hospedagem Cloudez roda Node 18 e revelou (deploy 2026-07-29).
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- o `new Function` abaixo não é dinamismo gratuito: é o que esconde o import() do tsc. Trocar por import() direto o faz virar require() sob module=commonjs, que estoura ERR_REQUIRE_ESM no Node 18 da hospedagem (incidente de 2026-07-29).
    const { PgBoss } = await (new Function("return import('pg-boss')")() as Promise<
      typeof import('pg-boss')
    >)
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('QueueService: DATABASE_URL é obrigatório fora de test-env')
    this.boss = new PgBoss(url)
    this.boss.on('error', (e) => this.log.error(`pg-boss: ${e.message}`))
    await this.boss.start()
    for (const [name, handler] of this.handlers) await this.wire(name, handler)
  }

  async onModuleDestroy() {
    if (this.boss) await this.boss.stop({ graceful: true })
  }

  async registerWorker<T>(name: string, handler: Handler<T>) {
    const isNew = !this.handlers.has(name)
    // A asserção é a fronteira: daqui pra dentro o payload é JSON sem tipo, e
    // quem declarou `T` no registro é quem responde pelo formato.
    const apagado = handler as Handler
    this.handlers.set(name, apagado)
    if (this.boss && isNew) await this.wire(name, apagado) // idempotente: 1 poller por nome
  }

  private async wire(name: string, handler: Handler) {
    await this.boss!.createQueue(name)
    // Entrega at-least-once: retryLimit + batch podem re-rodar um job (crash mid-lote) →
    // o handler DEVE ser idempotente ou aceitar duplicatas (as notifs são best-effort).
    await this.boss!.work(name, async (jobs) => {
      for (const job of jobs) await handler(job.data)
    })
  }

  async enqueue(name: string, data: object): Promise<void> {
    if (this.inline || !this.boss) {
      // Inline (test-env): roda o handler registrado. NB: o pg-boss real LANÇA se o nome
      // não foi createQueue'd — aqui é no-op p/ nome desconhecido (nomes vêm de constantes).
      const h = this.handlers.get(name)
      if (h) await h(data)
      return
    }
    await this.boss.send(name, data, { retryLimit: 2, retryBackoff: true })
  }
}
