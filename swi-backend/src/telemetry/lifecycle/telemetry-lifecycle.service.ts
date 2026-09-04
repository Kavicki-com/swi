import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  BRT_OFFSET_MS,
  EVENT_AGE,
  monitoredDayRange,
  monitoredDayWindow,
} from '../domain/metric-state'
import type { TelemetryOrigin } from '../domain/telemetry.types'
import { summarizeDay, type DailySummary } from './telemetry-summarizer'

// Serviço do ciclo de vida do dado de telemetria. Ele decide QUAIS dias resumir
// e fala com o banco; a conta é do resumidor, que é puro. O job só delega, e
// "now" entra por parâmetro em tudo para a suíte poder fixar o instante.
//
// Nesta fatia ele só resume. A retenção (apagar o que já foi resumido) é o
// próximo ticket, e a ordem entre as duas é fixa de propósito: primeiro
// resumir, depois apagar.

/**
 * Teto de triplas por execução. Existe para a rodada ter tamanho previsível; o
 * que sobra entra na seguinte, porque o job roda todo dia.
 */
export const MAX_TRIPLES_PER_RUN = 200

/** Uma tripla a resumir, como a varredura a encontra. */
export interface SummaryCandidate {
  workerId: string
  day: Date
  origin: TelemetryOrigin
}

export interface SummarizeRunResult {
  summarized: number
  failed: number
}

/**
 * Instante antes do qual toda leitura pertence a um dia já fechado.
 *
 * Um dia fecha 48 horas depois da meia-noite que o encerrou, e o prazo não é
 * configurável: é o mesmo que separa backlog de histórico na ingestão, ou seja,
 * o contrato com a fila do relógio. Encurtá-lo resumiria um dia que ainda pode
 * receber evento atrasado, e o Resumo nasceria errado.
 */
export function closedDayCutoff(now: Date): Date {
  return monitoredDayRange(new Date(now.getTime() - EVENT_AGE.backlogMs)).start
}

/**
 * O deslocamento do dia monitorado como intervalo do Postgres. A regra continua
 * tendo uma fonte só: o número vem do domínio, e aqui ele só muda de notação
 * para o banco poder agrupar por dia sem trazer as linhas para a memória.
 */
const DAY_OFFSET_INTERVAL = `${BRT_OFFSET_MS} milliseconds`

const SAMPLE_FIELDS = {
  eventTime: true,
  sessionId: true,
  heartRateBpm: true,
  stepDelta: true,
} as const

const ASSESSMENT_FIELDS = {
  computedAt: true,
  effortPercent: true,
  wearPercent: true,
} as const

@Injectable()
export class TelemetryLifecycleService {
  private readonly logger = new Logger(TelemetryLifecycleService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resume os dias já fechados que ainda não têm linha. Uma tripla que falha é
   * registrada e não interrompe as demais: a rodada é diária e tem teto, então
   * parar na primeira falha deixaria a fila inteira presa atrás de um dia
   * problemático.
   */
  async summarizeClosedDays(now: Date): Promise<SummarizeRunResult> {
    const candidates = await this.findCandidates(closedDayCutoff(now))

    let summarized = 0
    let failed = 0
    for (const candidate of candidates) {
      try {
        if (await this.summarizeOne(candidate, now)) summarized++
      } catch (error) {
        failed++
        // Sem valor de saúde na mensagem: log é lugar onde dado sensível vaza
        // sem ninguém notar. Só a tripla, que é o que permite repetir a mão.
        this.logger.warn(
          `Resumo do dia falhou para ${candidate.workerId} em ${candidate.day.toISOString()} (${candidate.origin}): ${(error as Error).message}`,
        )
      }
    }
    return { summarized, failed }
  }

  /**
   * As triplas com leitura ou avaliação em dia fechado e ainda sem Resumo, das
   * mais antigas para as mais recentes.
   *
   * SQL cru de propósito. Agrupar por dia monitorado exige a fronteira de
   * Brasília dentro do banco; trazer as linhas para agrupar em memória seria
   * varrer a tabela de leituras inteira a cada execução. A exclusão por
   * NOT EXISTS é o que faz a rodada avançar: sem ela os mesmos dias voltariam
   * para sempre, porque a Leitura só some na retenção.
   */
  private async findCandidates(cutoff: Date): Promise<SummaryCandidate[]> {
    return this.prisma.$queryRaw<SummaryCandidate[]>(Prisma.sql`
      WITH candidatas AS (
        SELECT "workerId", "origin",
               ("eventTime" + CAST(${DAY_OFFSET_INTERVAL} AS interval))::date AS day
        FROM "TelemetrySample"
        WHERE "eventTime" < ${cutoff}
        GROUP BY 1, 2, 3
        UNION
        SELECT "workerId", "origin",
               ("computedAt" + CAST(${DAY_OFFSET_INTERVAL} AS interval))::date AS day
        FROM "TelemetryAssessment"
        WHERE "computedAt" < ${cutoff}
        GROUP BY 1, 2, 3
      )
      SELECT c."workerId", c."origin", c."day"
      FROM candidatas c
      WHERE NOT EXISTS (
        SELECT 1 FROM "TelemetryDailySummary" r
        WHERE r."workerId" = c."workerId"
          AND r."origin" = c."origin"
          AND r."day" = c."day"
      )
      ORDER BY c."day" ASC
      LIMIT ${MAX_TRIPLES_PER_RUN}
    `)
  }

  /** Devolve false quando o dia não tinha o que resumir. */
  private async summarizeOne(candidate: SummaryCandidate, now: Date): Promise<boolean> {
    const { workerId, day, origin } = candidate
    // A janela vem do domínio: o job não recalcula fronteira de dia por conta
    // própria, senão o Resumo discordaria do painel sobre a mesma leitura.
    const { start, end } = monitoredDayWindow(day)

    const [samples, assessments] = await Promise.all([
      this.prisma.telemetrySample.findMany({
        where: { workerId, origin, eventTime: { gte: start, lt: end } },
        select: SAMPLE_FIELDS,
      }),
      this.prisma.telemetryAssessment.findMany({
        where: { workerId, origin, computedAt: { gte: start, lt: end } },
        select: ASSESSMENT_FIELDS,
      }),
    ])

    const summary = summarizeDay({ workerId, day, origin, samples, assessments }, now)
    if (summary === null) {
      // Não é caso normal, é invariante quebrado: a varredura achou a tripla
      // porque havia linha abaixo do corte, e a janela do mesmo dia não trouxe
      // nada. Ou a conta de dia do SQL discordou da do domínio, ou alguém
      // apagou linhas no meio da rodada. Em silêncio, a tripla voltaria toda
      // noite sem ninguém notar.
      this.logger.warn(
        `Candidata sem leitura nem avaliação na janela: ${workerId} em ${day.toISOString()} (${origin})`,
      )
      return false
    }

    const data = toRow(summary)
    // Upsert pela tripla: recalcular sobrescreve, e é isso que torna o Resumo
    // recomputável depois de a Leitura bruta ter sido apagada.
    await this.prisma.telemetryDailySummary.upsert({
      where: { workerId_day_origin: { workerId, day, origin } },
      create: data,
      update: data,
    })
    return true
  }
}

/**
 * A linha como o banco a recebe. As colunas que esta fatia ainda não calcula
 * ficam de fora, e não zeradas: elas nascem nulas, que é o que "ninguém mediu"
 * quer dizer, e a fatia seguinte as preenche.
 */
function toRow(summary: DailySummary) {
  return {
    workerId: summary.workerId,
    day: summary.day,
    origin: summary.origin,
    heartRateMin: summary.heartRateMin,
    heartRateMax: summary.heartRateMax,
    heartRateAvg: summary.heartRateAvg,
    heartRateCount: summary.heartRateCount,
    heartRateCoveredMs: summary.heartRateCoveredMs,
    stepsTotal: summary.stepsTotal,
    stepsCount: summary.stepsCount,
    sampleCount: summary.sampleCount,
    firstSampleAt: summary.firstSampleAt,
    lastSampleAt: summary.lastSampleAt,
    coveredMs: summary.coveredMs,
    summarizerVersion: summary.summarizerVersion,
    computedAt: summary.computedAt,
  }
}
