import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { PositionsService } from './positions.service'
import { EvacuationEventsService } from '../evacuation/evacuation-events.service'
import {
  advance,
  loopForWorker,
  MUSTER_POINT,
  stepToward,
  type LngLat,
  type SimState,
} from './sim-route'

const TICK_MS = 3_000
const WALK_SPEED_MPS = 1.4

interface SimWorker {
  id: string
  companyId: string | null
  route: LngLat[]
  state: SimState
  pos: LngLat
}

// Simulador DEV de posições (env SIM_POSITIONS=1; NUNCA ligar em produção —
// lá a fonte é o GPS do app mobile). Move cada worker ativo num loop crível
// dentro do site e alimenta o MESMO caminho de escrita do heartbeat real:
// upsert + push WS. Nada na cadeia é fake, só a origem do sinal.
// Fase 2: com evacuação ATIVA na org do worker, ele abandona o loop e CONVERGE
// em linha reta pro muster point; na chegada, ack'a pelo MESMO service que o
// app mobile usará — o admin vê o X/N subir ao vivo.
@Injectable()
export class PositionSimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PositionSimulatorService.name)
  private timer: ReturnType<typeof setInterval> | null = null
  private workers: SimWorker[] = []
  // Chaves `${evacId}:${workerId}` já confirmadas — o ack do service é
  // idempotente, mas repetir spammaria o WS do admin a cada tick.
  private acked = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly positions: PositionsService,
    private readonly evacuations: EvacuationEventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Duas condições, não uma: a flag liga o simulador, e o ambiente decide se
    // ele pode existir. Uma flag esquecida no ambiente de produção colocaria
    // pinos falsos no mapa junto com a posição real dos trabalhadores.
    if (process.env.NODE_ENV === 'production' || process.env.SIM_POSITIONS !== '1') return
    const rows = await this.prisma.user.findMany({
      where: { role: 'WORKER', active: true },
      select: { id: true, companyId: true },
    })
    this.workers = rows.map((w: { id: string; companyId: string | null }, i: number) => {
      const route = loopForWorker(i)
      // Fase inicial espalhada pelo índice — os pinos não nascem empilhados.
      const state: SimState = { seg: i % 4, t: (i % 5) / 5 }
      return { id: w.id, companyId: w.companyId, route, state, pos: advance(route, state, 0, 0).pos }
    })
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.logger.log(`Simulador de posições ligado (${this.workers.length} workers, tick ${TICK_MS} ms)`)
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  // Público pros testes dirigirem o relógio sem timers reais.
  async tick(): Promise<void> {
    const evacByOrg = await this.activeEvacuations()
    // Quem tem GPS REAL recente é dono do próprio pino: o app no celular posta
    // no mesmo heartbeat, e sem esta cedência o simulador sobrescreveria a
    // posição verdadeira ~3s depois de ela chegar (decisão 2026-07-26). Janela
    // de 60s: app fechado → o pino congela 1 min e o simulador retoma.
    const liveReal = await this.recentRealWorkers()
    for (const w of this.workers) {
      if (liveReal.has(w.id)) continue
      const evacId = evacByOrg.get(w.companyId)
      if (evacId) {
        w.pos = stepToward(w.pos, MUSTER_POINT, TICK_MS / 1000, WALK_SPEED_MPS)
      } else {
        const { state, pos } = advance(w.route, w.state, TICK_MS / 1000, WALK_SPEED_MPS)
        w.state = state
        w.pos = pos
      }
      try {
        await this.positions.heartbeat(w.id, w.pos[1], w.pos[0], 'sim')
      } catch {
        // Worker removido/desativado no meio da simulação — não derruba os demais.
      }
      if (evacId) await this.maybeAck(w, evacId)
    }
  }

  // Ids com heartbeat REAL nos últimos 60s. Falha de leitura degrada pra
  // "ninguém real" — o simulador nunca pode morrer por uma query.
  private async recentRealWorkers(): Promise<Set<string>> {
    try {
      const rows = await this.prisma.workerPosition.findMany({
        where: { source: 'real', recordedAt: { gt: new Date(Date.now() - 60_000) } },
        select: { workerId: true },
      })
      return new Set(rows.map((r: { workerId: string }) => r.workerId))
    } catch {
      return new Set()
    }
  }

  // Map org→evacuação ativa. Falha de leitura degrada pra "sem evacuação"
  // neste tick — o simulador nunca pode morrer por uma query.
  private async activeEvacuations(): Promise<Map<string | null, string>> {
    try {
      const evacs = await this.prisma.evacuation.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, companyId: true },
      })
      return new Map(evacs.map((e: { id: string; companyId: string | null }) => [e.companyId, e.id]))
    } catch {
      return new Map()
    }
  }

  private async maybeAck(w: SimWorker, evacId: string): Promise<void> {
    const arrived = w.pos[0] === MUSTER_POINT[0] && w.pos[1] === MUSTER_POINT[1]
    const key = `${evacId}:${w.id}`
    if (!arrived || this.acked.has(key)) return
    // Marca ANTES do await: mesmo se o ack falhar (evacuação encerrada no
    // meio), não fica re-tentando/spammando a cada tick.
    this.acked.add(key)
    try {
      await this.evacuations.ack(w.id, evacId)
    } catch {
      // Encerrou/removida no meio — o pino já está no muster, segue o jogo.
    }
  }
}
