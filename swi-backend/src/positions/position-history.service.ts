import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { TelemetryRetentionEnv } from '../config/runtime-env'
import {
  cellCenter,
  HEAT_CELL_SIZE_M,
  latStepDeg,
  METERS_PER_DEGREE,
  shouldRecordSample,
  type HeatCell,
} from './position-history'

// Trilha de posições: grava a amostra do heartbeat, monta o mapa de calor da
// empresa e apaga o que passou da janela de retenção. As regras (espaçamento,
// grade, peso) moram em position-history.ts; aqui só há banco.

/** Janela padrão do mapa de calor quando a consulta não diz qual. */
export const HEAT_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000
/** Maior janela aceita numa consulta: o mesmo prazo da retenção padrão. */
export const HEAT_MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
/**
 * Quanto tempo uma rodada de retenção pode gastar apagando, como na telemetria:
 * o que sobra entra na rodada seguinte.
 */
export const POSITION_RETENTION_BUDGET_MS = 60_000

export const POSITION_HISTORY_CLOCK = Symbol('POSITION_HISTORY_CLOCK')

export type SampleSource = 'real' | 'sim'

export interface HeatQuery {
  from?: string
  to?: string
}

export interface HeatResponse {
  cellSizeM: number
  /** ISO-8601 da janela efetivamente consultada. */
  from: string
  to: string
  /** Mais quentes primeiro. Peso = minutos distintos de funcionário na célula. */
  cells: HeatCell[]
}

interface HeatRow {
  row: bigint | number
  col: bigint | number
  weight: bigint | number
}

@Injectable()
export class PositionHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(POSITION_HISTORY_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  /** Grava a posição como amostra quando ela traz movimento ou tempo novo. */
  async record(
    worker: { id: string; companyId: string | null },
    lat: number,
    lng: number,
    source: SampleSource,
    now: Date,
  ): Promise<void> {
    const last = await this.prisma.workerPositionSample.findFirst({
      where: { workerId: worker.id },
      orderBy: { recordedAt: 'desc' },
      select: { lat: true, lng: true, recordedAt: true },
    })
    if (!shouldRecordSample(last, { lat, lng }, now)) return
    await this.prisma.workerPositionSample.create({
      data: { workerId: worker.id, companyId: worker.companyId, lat, lng, source, recordedAt: now },
    })
  }

  /**
   * Mapa de calor da empresa, nunca trilhas: só sai a contagem por célula. A
   * grade é calculada no banco com as mesmas constantes de
   * position-history.ts, para a consulta não trazer as amostras para a
   * memória numa janela de até 30 dias. Admin sem empresa lê o balde sem
   * empresa, como a lista de posições.
   */
  async heat(
    companyId: string | null,
    query: HeatQuery,
    options: { includeSim: boolean },
    now: Date,
  ): Promise<HeatResponse> {
    const to = query.to ? new Date(query.to) : now
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - HEAT_DEFAULT_WINDOW_MS)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Janela inválida')
    }
    if (from.getTime() >= to.getTime()) {
      throw new BadRequestException('O início da janela precisa ser anterior ao fim')
    }
    if (to.getTime() - from.getTime() > HEAT_MAX_WINDOW_MS) {
      throw new BadRequestException('A janela do mapa de calor vai até 30 dias')
    }

    const sources: SampleSource[] = options.includeSim ? ['real', 'sim'] : ['real']
    const company =
      companyId === null ? Prisma.sql`"companyId" IS NULL` : Prisma.sql`"companyId" = ${companyId}`
    const latStep = latStepDeg()

    const rows = await this.prisma.$queryRaw<HeatRow[]>(Prisma.sql`
      WITH s AS (
        SELECT "workerId",
               floor("lat" / ${latStep}::float8) AS "row",
               "lng",
               date_trunc('minute', "recordedAt") AS "minute"
        FROM "WorkerPositionSample"
        WHERE ${company}
          AND "recordedAt" >= ${from}
          AND "recordedAt" < ${to}
          AND "source" = ANY(${sources})
      )
      SELECT "row",
             floor("lng" / (${HEAT_CELL_SIZE_M}::float8 /
               (${METERS_PER_DEGREE}::float8 * cos(radians(("row" + 0.5) * ${latStep}::float8))))) AS "col",
             count(DISTINCT ("workerId" || '|' || "minute"::text)) AS "weight"
      FROM s
      GROUP BY "row", "col"
    `)

    const cells = rows
      .map((r) => ({ ...cellCenter(Number(r.row), Number(r.col)), weight: Number(r.weight) }))
      .sort((a, b) => b.weight - a.weight)

    return { cellSizeM: HEAT_CELL_SIZE_M, from: from.toISOString(), to: to.toISOString(), cells }
  }

  /** Apaga as amostras anteriores à janela, em lotes, até o orçamento de tempo. */
  async purge(
    now: Date,
    retention: TelemetryRetentionEnv,
  ): Promise<{ deleted: number; stoppedByBudget: boolean }> {
    const cutoff = new Date(now.getTime() - retention.windowMs)
    const startedAt = this.clock()
    let deleted = 0
    for (;;) {
      if (this.clock() - startedAt >= POSITION_RETENTION_BUDGET_MS) {
        return { deleted, stoppedByBudget: true }
      }
      const count = await this.prisma.$executeRaw(Prisma.sql`
        DELETE FROM "WorkerPositionSample"
        WHERE "id" IN (
          SELECT "id" FROM "WorkerPositionSample"
          WHERE "recordedAt" < ${cutoff}
          ORDER BY "recordedAt"
          LIMIT ${retention.batchSize}
        )
      `)
      deleted += count
      // Lote curto é o fim do que estava fora da janela.
      if (count < retention.batchSize) return { deleted, stoppedByBudget: false }
    }
  }
}
