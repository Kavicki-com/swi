import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PositionsService } from './positions.service'
import { advance, loopForWorker, type LngLat, type SimState } from './sim-route'

const TICK_MS = 3_000
const WALK_SPEED_MPS = 1.4

// Simulador DEV de posições (env SIM_POSITIONS=1; NUNCA ligar em produção —
// lá a fonte é o GPS do app mobile). Move cada worker ativo num loop crível
// dentro do site e alimenta o MESMO caminho de escrita do heartbeat real:
// upsert + push WS. Nada na cadeia é fake, só a origem do sinal.
@Injectable()
export class PositionSimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PositionSimulatorService.name)
  private timer: ReturnType<typeof setInterval> | null = null
  private workers: { id: string; route: LngLat[]; state: SimState }[] = []

  constructor(
    private readonly prisma: PrismaService,
    private readonly positions: PositionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SIM_POSITIONS !== '1') return
    const rows = await this.prisma.user.findMany({
      where: { role: 'WORKER', active: true },
      select: { id: true },
    })
    this.workers = rows.map((w: { id: string }, i: number) => ({
      id: w.id,
      route: loopForWorker(i),
      // Fase inicial espalhada pelo índice — os pinos não nascem empilhados.
      state: { seg: i % 4, t: (i % 5) / 5 },
    }))
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.logger.log(`Simulador de posições ligado (${this.workers.length} workers, tick ${TICK_MS} ms)`)
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  // Público pros testes dirigirem o relógio sem timers reais.
  async tick(): Promise<void> {
    for (const w of this.workers) {
      const { state, pos } = advance(w.route, w.state, TICK_MS / 1000, WALK_SPEED_MPS)
      w.state = state
      try {
        await this.positions.heartbeat(w.id, pos[1], pos[0])
      } catch {
        // Worker removido/desativado no meio da simulação — não derruba os demais.
      }
    }
  }
}
