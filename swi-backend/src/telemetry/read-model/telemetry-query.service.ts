import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type TelemetrySessionStatus } from '@prisma/client'
import type { JwtUser } from '../../auth/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { monitoredDayRange } from '../domain/metric-state'
import type {
  ConditionKind,
  MeasurementSource,
  Sample,
  TelemetryOrigin,
} from '../domain/telemetry.types'
import {
  ENERGY_RATE_WINDOW_MS,
  projectAdminSummary,
  projectAggregateWorker,
  projectWorker,
  type AdminTelemetrySummary,
  type AggregateWorkerInput,
  type DayTotals,
  type ProjectionAssessment,
  type ProjectionSample,
  type ProjectionSnapshot,
  type WorkerTelemetry,
} from './telemetry-projector'

// Consultas do read model. Este serviço decide QUAIS LINHAS entram na conta; o
// que se faz com elas é do projetor, que é puro. A separação é o que permite
// provar as regras de apresentação sem banco e as regras de escopo sem cálculo.
//
// Duas regras congeladas vivem aqui:
//
// 1. Origem não se mistura. Toda consulta filtra por uma origem só, e a do
//    funcionário é a do snapshot dele. Sem esse filtro, uma amostra de
//    demonstração esquecida entraria numa taxa real.
// 2. Jornada e tarefa não filtram nada. Iniciar, pausar ou encerrar a Jornada
//    SWI não inicia, pausa nem encerra o monitoramento, então um `journeyId` no
//    where reintroduziria o acoplamento que a ADR-0003 removeu.

/** Colunas do snapshot que a projeção consome. */
const SNAPSHOT_FIELDS = {
  workerId: true,
  origin: true,
  sessionId: true,
  heartRateBpm: true,
  heartRateAt: true,
  batteryPercent: true,
  batteryAt: true,
  systolicMmHg: true,
  diastolicMmHg: true,
  bloodPressureSource: true,
  bloodPressureAt: true,
} as const

const ASSESSMENT_FIELDS = {
  workerId: true,
  computedAt: true,
  effortPercent: true,
  wearPercent: true,
  formulaVersion: true,
} as const

const SAMPLE_FIELDS = {
  eventTime: true,
  stepDelta: true,
  activeEnergyKcal: true,
  motionCount: true,
} as const

/** Teto de amostras por página de auditoria, e o padrão de quem não escolhe. */
export const HISTORY_MAX_LIMIT = 500
export const HISTORY_DEFAULT_LIMIT = 200

export interface SessionHistoryQuery {
  limit?: number
  /** Cursor de sequência: a página seguinte começa depois desta. */
  afterSequence?: number
}

export interface SessionHistorySample {
  id: string
  sequence: number
  eventTime: string
  receivedAt: string
  origin: TelemetryOrigin
  heartRateBpm: number | null
  stepDelta: number | null
  activeEnergyKcal: number | null
  motionCount: number | null
  batteryPercent: number | null
  systolicMmHg: number | null
  diastolicMmHg: number | null
  bloodPressureSource: MeasurementSource | null
  journeyId: string | null
  taskId: string | null
}

export interface SessionHistoryPage {
  session: {
    id: string
    workerId: string
    deviceId: string
    origin: TelemetryOrigin
    status: TelemetrySessionStatus
    startedAt: string
    endedAt: string | null
  }
  samples: SessionHistorySample[]
  /** Última sequência desta página, quando ela encheu. Nulo no fim da trilha. */
  nextCursor: number | null
}

interface SnapshotRow {
  origin: TelemetryOrigin
  sessionId: string | null
  heartRateBpm: number | null
  heartRateAt: Date | null
  batteryPercent: number | null
  batteryAt: Date | null
  systolicMmHg: number | null
  diastolicMmHg: number | null
  bloodPressureSource: MeasurementSource | null
  bloodPressureAt: Date | null
}

interface AssessmentRow {
  computedAt: Date
  effortPercent: number | null
  wearPercent: number | null
  formulaVersion: string
}

interface SampleRow {
  eventTime: Date
  stepDelta: number | null
  activeEnergyKcal: number | null
  motionCount: number | null
}

interface StepsTotalRow {
  _sum: { stepDelta: number | null }
  _max: { eventTime: Date | null }
}

interface EnergyTotalRow {
  _sum: { activeEnergyKcal: number | null }
  _max: { eventTime: Date | null }
  _min: { eventTime: Date | null }
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())

function toProjectionSnapshot(row: SnapshotRow): ProjectionSnapshot {
  return {
    origin: row.origin,
    sessionId: row.sessionId,
    heartRateBpm: row.heartRateBpm,
    heartRateAt: iso(row.heartRateAt),
    batteryPercent: row.batteryPercent,
    batteryAt: iso(row.batteryAt),
    systolicMmHg: row.systolicMmHg,
    diastolicMmHg: row.diastolicMmHg,
    bloodPressureSource: row.bloodPressureSource,
    bloodPressureAt: iso(row.bloodPressureAt),
  }
}

function toProjectionAssessment(row: AssessmentRow): ProjectionAssessment {
  return {
    computedAt: row.computedAt.toISOString(),
    effortPercent: row.effortPercent,
    wearPercent: row.wearPercent,
    formulaVersion: row.formulaVersion,
  }
}

function toProjectionSample(row: SampleRow): ProjectionSample {
  return {
    eventTime: row.eventTime.toISOString(),
    stepDelta: row.stepDelta,
    activeEnergyKcal: row.activeEnergyKcal,
    motionCount: row.motionCount,
  }
}

/** O total do dia como o banco o somou, no formato que a projeção consome. */
function toStepsSample(row: StepsTotalRow | undefined): Sample<number> | null {
  if (row === undefined) return null
  const total = row._sum.stepDelta
  const latestAt = row._max.eventTime
  if (total === null || latestAt === null) return null
  return { value: total, measuredAt: latestAt.toISOString(), source: 'APPLE_WATCH' }
}

function toEnergyTotal(row: EnergyTotalRow): DayTotals['activeEnergy'] {
  const total = row._sum.activeEnergyKcal
  const latestAt = row._max.eventTime
  const earliestAt = row._min.eventTime
  if (total === null || latestAt === null || earliestAt === null) return null
  return {
    value: total,
    measuredAt: latestAt.toISOString(),
    source: 'APPLE_WATCH',
    earliestAt: earliestAt.toISOString(),
  }
}

@Injectable()
export class TelemetryQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estado atual de um funcionário. Sem snapshot devolve leitura vazia, e não
   * erro: quem ainda não reportou não é quem não existe, e a tela precisa poder
   * dizer "sem dados" em vez de falhar.
   */
  async currentForWorker(workerId: string, now = new Date()): Promise<WorkerTelemetry> {
    const snapshot = await this.prisma.telemetrySnapshot.findUnique({
      where: { workerId },
      select: SNAPSHOT_FIELDS,
    })

    if (snapshot === null) {
      return projectWorker(
        {
          workerId,
          snapshot: null,
          windowSamples: [],
          dayTotals: { steps: null, activeEnergy: null },
          assessment: null,
        },
        now,
      )
    }

    // A origem do snapshot manda em tudo que vier depois. Ela é única por
    // funcionário porque a ingestão limpa o snapshot quando a origem muda.
    const scope = { workerId, origin: snapshot.origin }
    const { start, end } = monitoredDayRange(now)
    const day = { gte: start, lt: end }

    // Esta rota é chamada a cada aviso do socket, ou seja, a cada evento. Por
    // isso a série que vem é só a janela das taxas, e os acumulados do dia
    // chegam somados pelo banco: o dia inteiro seriam milhares de linhas por
    // chamada, multiplicadas pelo número de funcionários a cada cinco segundos.
    const [windowSamples, steps, energy, assessments] = await Promise.all([
      this.prisma.telemetrySample.findMany({
        where: { ...scope, eventTime: { gte: new Date(now.getTime() - ENERGY_RATE_WINDOW_MS) } },
        select: SAMPLE_FIELDS,
      }),
      // Cada total filtra pela própria coluna não nula: é o que faz o _max ser o
      // horário da última amostra DAQUELA medição, e não de um evento só de
      // bateria que deixaria o acumulado parecer mais fresco do que é.
      this.prisma.telemetrySample.aggregate({
        where: { ...scope, eventTime: day, stepDelta: { not: null } },
        _sum: { stepDelta: true },
        _max: { eventTime: true },
      }),
      this.prisma.telemetrySample.aggregate({
        where: { ...scope, eventTime: day, activeEnergyKcal: { not: null } },
        _sum: { activeEnergyKcal: true },
        _max: { eventTime: true },
        // A primeira amostra de energia do dia separa começo de lacuna.
        _min: { eventTime: true },
      }),
      this.prisma.telemetryAssessment.findMany({
        where: { ...scope, computedAt: day },
        select: ASSESSMENT_FIELDS,
        orderBy: { computedAt: 'desc' },
        take: 1,
      }),
    ])

    return projectWorker(
      {
        workerId,
        snapshot: toProjectionSnapshot(snapshot),
        windowSamples: windowSamples.map(toProjectionSample),
        dayTotals: { steps: toStepsSample(steps), activeEnergy: toEnergyTotal(energy) },
        assessment: assessments.length === 0 ? null : toProjectionAssessment(assessments[0]),
      },
      now,
    )
  }

  /** Mesma leitura, com o escopo de empresa do administrador aplicado antes. */
  async currentForAdmin(admin: JwtUser, workerId: string, now = new Date()): Promise<WorkerTelemetry> {
    await this.requireSameCompany(admin, workerId)
    return this.currentForWorker(workerId, now)
  }

  /**
   * Cards do painel. A população são os funcionários da empresa com aparelho
   * ativo: é deles que se espera telemetria, e é contra esse denominador que a
   * cobertura significa alguma coisa. Quem nunca pareou não é "não avaliado",
   * está fora do piloto.
   */
  async adminSummary(admin: JwtUser, now = new Date()): Promise<AdminTelemetrySummary> {
    const companyId = this.companyOfPanelAdmin(admin)
    const devices = await this.prisma.telemetryDevice.findMany({
      where: { revokedAt: null, worker: { companyId } },
      select: { workerId: true },
      distinct: ['workerId'],
    })
    const workerIds = devices.map((d) => d.workerId)
    if (workerIds.length === 0) return projectAdminSummary([], now)

    const { start, end } = monitoredDayRange(now)
    const day = { gte: start, lt: end }
    const scope = { workerId: { in: workerIds }, origin: 'REAL' as const }

    const [snapshots, steps, latestAssessments, conditions] = await Promise.all([
      this.prisma.telemetrySnapshot.findMany({ where: scope, select: SNAPSHOT_FIELDS }),
      // Soma no banco, e não em memória: um dia de amostras por funcionário são
      // milhares de linhas que viriam só para virar um total. O filtro por
      // stepDelta não-nulo é o que faz o _max ser o horário da última amostra
      // DE PASSOS: sem ele, um evento só de bateria deixaria o acumulado
      // parecer mais fresco do que é.
      this.prisma.telemetrySample.groupBy({
        by: ['workerId'],
        where: { ...scope, eventTime: day, stepDelta: { not: null } },
        _sum: { stepDelta: true },
        _max: { eventTime: true },
      }),
      this.latestAssessmentPerWorker(workerIds, day),
      this.prisma.telemetryCondition.findMany({
        where: { ...scope, status: 'ACTIVE' },
        select: { workerId: true, kind: true },
      }),
    ])

    const snapshotBy = new Map(snapshots.map((s) => [s.workerId, s]))
    const stepsBy = new Map(steps.map((s) => [s.workerId, s]))
    const assessmentBy = new Map(latestAssessments.map((a) => [a.workerId, a]))
    // Sem cast: o enum do Prisma e a união do domínio são o mesmo vocabulário,
    // e se um dia divergirem é aqui que o compilador tem de reclamar.
    const conditionsBy = new Map<string, ConditionKind[]>()
    for (const { workerId, kind } of conditions) {
      const known = conditionsBy.get(workerId)
      if (known === undefined) conditionsBy.set(workerId, [kind])
      else known.push(kind)
    }

    const workers: AggregateWorkerInput[] = workerIds.map((workerId) => {
      const snapshot = snapshotBy.get(workerId)
      const assessment = assessmentBy.get(workerId)
      return projectAggregateWorker(
        {
          workerId,
          snapshot: snapshot === undefined ? null : toProjectionSnapshot(snapshot),
          steps: toStepsSample(stepsBy.get(workerId)),
          assessment: assessment === undefined ? null : toProjectionAssessment(assessment),
          activeConditions: conditionsBy.get(workerId) ?? [],
        },
        now,
      )
    })

    return projectAdminSummary(workers, now)
  }

  /**
   * A última avaliação do dia de cada funcionário, escolhida pelo banco.
   *
   * SQL cru de propósito. Trazer todas as avaliações do dia para ficar com uma
   * por pessoa custaria milhares de linhas por refresh do painel, e o
   * `distinct` do Prisma não resolve: ele filtra em memória depois de buscar
   * tudo. `DISTINCT ON` com a ordenação certa devolve uma linha por
   * funcionário direto do Postgres. A origem vai por parâmetro, com o cast que
   * o enum exige; a tabela leva o nome do model porque nenhum deles usa @@map.
   */
  private latestAssessmentPerWorker(
    workerIds: string[],
    day: { gte: Date; lt: Date },
  ): Promise<(AssessmentRow & { workerId: string })[]> {
    const query = Prisma.sql`
      SELECT DISTINCT ON ("workerId")
        "workerId", "computedAt", "effortPercent", "wearPercent", "formulaVersion"
      FROM "TelemetryAssessment"
      WHERE "workerId" IN (${Prisma.join(workerIds)})
        AND "origin" = CAST(${'REAL'} AS "TelemetryOrigin")
        AND "computedAt" >= ${day.gte}
        AND "computedAt" < ${day.lt}
      ORDER BY "workerId", "computedAt" DESC
    `
    return this.prisma.$queryRaw(query)
  }

  /**
   * Trilha de auditoria de uma sessão. Em ordem de sequência de propósito: é
   * assim que uma lacuna de fila fica visível, e a lacuna é justamente o que
   * uma auditoria procura.
   */
  async sessionHistory(
    user: JwtUser,
    sessionId: string,
    query: SessionHistoryQuery,
  ): Promise<SessionHistoryPage> {
    const session = await this.prisma.telemetrySession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        workerId: true,
        deviceId: true,
        origin: true,
        status: true,
        startedAt: true,
        endedAt: true,
        worker: { select: { companyId: true } },
      },
    })
    // Inexistente, de outro funcionário e de outra empresa devolvem a mesma
    // recusa. Distinguir contaria a quem sonda quais sessões existem.
    const notFound = new NotFoundException('Sessão de monitoramento não encontrada')
    if (session === null) throw notFound
    const isOwner = session.workerId === user.userId
    const sameCompany =
      user.role === 'ADMIN' &&
      user.companyId !== null &&
      session.worker.companyId === user.companyId
    if (!isOwner && !sameCompany) throw notFound

    // Só o padrão, sem reconferir o teto: quem valida `limit` é o DTO da rota,
    // e repetir a faixa aqui criaria duas listas de validade que podem divergir
    // em silêncio, além de trocar uma recusa clara por um corte mudo.
    const limit = query.limit ?? HISTORY_DEFAULT_LIMIT
    const samples = await this.prisma.telemetrySample.findMany({
      where: {
        sessionId,
        ...(query.afterSequence === undefined ? {} : { sequence: { gt: query.afterSequence } }),
      },
      select: {
        id: true,
        sequence: true,
        eventTime: true,
        receivedAt: true,
        origin: true,
        heartRateBpm: true,
        stepDelta: true,
        activeEnergyKcal: true,
        motionCount: true,
        batteryPercent: true,
        systolicMmHg: true,
        diastolicMmHg: true,
        bloodPressureSource: true,
        journeyId: true,
        taskId: true,
      },
      orderBy: { sequence: 'asc' },
      take: limit,
    })

    return {
      session: {
        id: session.id,
        workerId: session.workerId,
        deviceId: session.deviceId,
        origin: session.origin,
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        endedAt: iso(session.endedAt),
      },
      samples: samples.map((s) => ({
        ...s,
        eventTime: s.eventTime.toISOString(),
        receivedAt: s.receivedAt.toISOString(),
      })),
      // Página cheia é o único sinal de que pode haver mais. Página curta é o
      // fim da trilha, e oferecer cursor ali faria o cliente pedir o vazio.
      nextCursor: samples.length === limit ? samples[samples.length - 1].sequence : null,
    }
  }

  /**
   * Empresa do administrador que pede o próprio painel.
   *
   * Recusa com Forbidden, e não com NotFound como o resto do módulo, porque
   * aqui não há recurso sondável: o pedido é sobre a conta de quem chama, que
   * já sabe que ela existe. A regra "fora do escopo responde igual a
   * inexistente" existe para não contar se um id alheio existe, e é o que
   * `requireSameCompany` faz logo abaixo, onde o id vem de fora.
   */
  private companyOfPanelAdmin(admin: JwtUser): string {
    if (admin.companyId === null) {
      throw new ForbiddenException('Administrador sem empresa não tem painel de telemetria')
    }
    return admin.companyId
  }

  private async requireSameCompany(admin: JwtUser, workerId: string): Promise<void> {
    const worker = await this.prisma.user.findUnique({
      where: { id: workerId },
      select: { id: true, companyId: true },
    })
    // Fora do escopo responde igual a inexistente, como no resto do backend.
    if (admin.companyId === null || worker === null || worker.companyId !== admin.companyId) {
      throw new NotFoundException('Funcionário não encontrado')
    }
  }
}
