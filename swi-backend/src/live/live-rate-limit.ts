/**
 * Tetos por socket e por minuto. Ligar, parar, assistir e sair consultam o
 * banco e avisam pessoas: 20 folgam qualquer uso de verdade. O repasse de
 * oferta, resposta e candidatos é mais frequente (cada conexão troca algumas
 * dezenas de candidatos, e o celular atende até três painéis).
 */
export const LIVE_RATE_LIMITS = {
  control: { max: 20, windowMs: 60_000 },
  relay: { max: 600, windowMs: 60_000 },
} as const

export type LiveEventKind = keyof typeof LIVE_RATE_LIMITS

type Limits = Record<LiveEventKind, { max: number; windowMs: number }>

/**
 * Janela fixa por socket. Existe porque o ThrottlerGuard global só vale para
 * o REST: os eventos de socket chegam sem limite nenhum.
 */
export class LiveRateLimit {
  private readonly windows = new Map<string, { startedAt: number; count: number }>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limits: Limits = LIVE_RATE_LIMITS,
  ) {}

  take(socketId: string, kind: LiveEventKind): boolean {
    const { max, windowMs } = this.limits[kind]
    const key = `${socketId}:${kind}`
    const at = this.now()
    const current = this.windows.get(key)
    if (!current || at - current.startedAt >= windowMs) {
      this.windows.set(key, { startedAt: at, count: 1 })
      return true
    }
    if (current.count >= max) return false
    current.count += 1
    return true
  }

  forget(socketId: string): void {
    for (const kind of Object.keys(this.limits)) this.windows.delete(`${socketId}:${kind}`)
  }

  /** Quantas contas abertas; serve aos testes de limpeza. */
  size(): number {
    return this.windows.size
  }
}
