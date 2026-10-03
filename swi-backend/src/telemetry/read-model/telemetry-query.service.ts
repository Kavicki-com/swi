import { HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT } from './history-limits'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type TelemetrySessionStatus } from '@prisma/client'
import type { JwtUser } from '../../auth/current-user.decorator'
import { parseTelemetryRetention } from '../../config/runtime-env'
import { PrismaService } from '../../prisma/prisma.service'
import { monitoredDayRange } from '../domain/metric-state'
import { closedDayCutoff, SUMMARIZER_SAMPLE_FIELDS } from '../lifecycle/telemetry-lifecycle.service'
import { healthStatusOf, type HealthStatus } from './health-status'
import { assembleSeries, seriesBuckets, type SeriesPeriod, type WorkerSeries } from './telemetry-series'
import type {
  ConditionKind,
  MeasurementSource,
  Sample,
  TelemetryOrigin,
} from '../domain/telemetry.types'
import {
  ENERGY_RATE_WINDOW_MS,
  projectAdminSummary,
  projectAdminWorkers,
  projectAggregateWorker,
  projectWorker,
  type AdminTelemetrySummary,
  type AdminWorkerInput,
  type AdminWorkersTelemetry,
  type AggregateWorkerInput,
  type DayTotals,
  type ProjectionAssessment,
  type ProjectionCondition,
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
  oxygenSaturationPct: true,
  oxygenSaturationAt: true,
  bodyTemperatureC: true,
  bodyTemperatureSource: true,
  bodyTemperatureAt: true,
} as const

const ASSESSMENT_FIELDS = {
  workerId: true,
  computedAt: true,
  effortPercent: true,
  wearPercent: true,
  fatigueEtaMin: true,
  formulaVersion: true,
} as const

const SAMPLE_FIELDS = {
  eventTime: true,
  stepDelta: true,
  activeEnergyKcal: true,
  motionCount: true,
} as const

/**
 * Teto de linhas da janela das taxas. A cadência do piloto é de cinco segundos,
 * então a janela de uma hora tem cerca de setecentas amostras; o teto dá quase
 * três vezes essa folga e existe para um produtor acelerado não transformar
 * cada aviso do socket numa varredura da tabela.
 *
 * Quando o teto morde, ficam as amostras mais recentes, e a cobertura que viaja
 * com a taxa encolhe junto: o número continua dizendo de quanto tempo ele fala,
 * que é a razão de a cobertura existir.
 */
export const WINDOW_MAX_SAMPLES = 2_000

/**
 * Teto de amostras de uma série por período. Só os dias ainda sem Resumo saem
 * das amostras, e são no máximo três (o de hoje e os dois que esperam fechar);
 * na cadência de cinco segundos isso dá cerca de 52 mil linhas. O teto cobre
 * isso com folga e existe para um produtor acelerado não virar varredura.
 */
export const SERIES_MAX_SAMPLES = 60_000

// Os limites moram em history-limits para que o DTO da rota os leia sem
// carregar este serviço, e com ele o cliente do Prisma. Reexportados porque
// chamadores de fora da rota já os importam daqui.
export { HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT }

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
  distanceDeltaM: number | null
  oxygenSaturationPct: number | null
  bodyTemperatureC: number | null
  bodyTemperatureSource: MeasurementSource | null
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
    retainedUntil: string
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
  oxygenSaturationPct: number | null
  oxygenSaturationAt: Date | null
  bodyTemperatureC: number | null
  bodyTemperatureSource: MeasurementSource | null
  bodyTemperatureAt: Date | null
}

interface AssessmentRow {
  computedAt: Date
  effortPercent: number | null
  wearPercent: number | null
  fatigueEtaMin: number | null
  formulaVersion: string
}

const CONDITION_FIELDS = {
  kind: true,
  origin: true,
  firstSeenAt: true,
  observedValue: true,
  thresholdValue: true,
} as const

interface ConditionRow {
  kind: ConditionKind
  origin: TelemetryOrigin
  firstSeenAt: Date
  observedValue: number | null
  thresholdValue: number | null
}

function toProjectionCondition(row: ConditionRow): ProjectionCondition {
  return {
    kind: row.kind,
    origin: row.origin,
    firstSeenAt: row.firstSeenAt.toISOString(),
    observedValue: row.observedValue,
    thresholdValue: row.thresholdValue,
  }
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

interface DistanceTotalRow {
  _sum: { distanceDeltaM: number | null }
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
    oxygenSaturationPct: row.oxygenSaturationPct,
    oxygenSaturationAt: iso(row.oxygenSaturationAt),
    bodyTemperatureC: row.bodyTemperatureC,
    bodyTemperatureSource: row.bodyTemperatureSource,
    bodyTemperatureAt: iso(row.bodyTemperatureAt),
  }
}

function toProjectionAssessment(row: AssessmentRow): ProjectionAssessment {
  return {
    computedAt: row.computedAt.toISOString(),
    effortPercent: row.effortPercent,
    wearPercent: row.wearPercent,
    fatigueEtaMin: row.fatigueEtaMin,
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

/** Mesma regra dos passos: distância é acumulado do dia, somado pelo banco. */
function toDistanceSample(row: DistanceTotalRow): Sample<number> | null {
  const total = row._sum.distanceDeltaM
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
          dayTotals: { steps: null, activeEnergy: null, distance: null },
          assessment: null,
          conditions: [],
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
    const [windowSamples, steps, energy, distance, assessments, conditions] = await Promise.all([
      this.prisma.telemetrySample.findMany({
        where: { ...scope, eventTime: { gte: new Date(now.getTime() - ENERGY_RATE_WINDOW_MS) } },
        select: SAMPLE_FIELDS,
        // Ordem para o banco percorrer o índice em vez de ordenar em memória, e
        // teto para a leitura ser limitada por contrato. Do mais recente para
        // trás porque é o recente que descreve o agora; a projeção reordena.
        orderBy: { eventTime: 'desc' },
        take: WINDOW_MAX_SAMPLES,
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
      this.prisma.telemetrySample.aggregate({
        where: { ...scope, eventTime: day, distanceDeltaM: { not: null } },
        _sum: { distanceDeltaM: true },
        _max: { eventTime: true },
      }),
      // Sem recorte por dia monitorado: a avaliação já tem prazo de atualidade
      // próprio, e cortar também pelo calendário fazia esforço e desgaste
      // sumirem nos primeiros minutos depois da meia-noite de Brasília, todo
      // dia. A mais recente pelo índice (workerId, computedAt) basta; quem diz
      // se ela ainda descreve o agora é o domínio, na projeção.
      this.prisma.telemetryAssessment.findMany({
        where: scope,
        select: ASSESSMENT_FIELDS,
        orderBy: { computedAt: 'desc' },
        take: 1,
      }),
      // Só as abertas e só da origem do snapshot. Poucas linhas por definição:
      // o índice único deixa no máximo uma ativa por tipo e origem.
      this.prisma.telemetryCondition.findMany({
        where: { ...scope, status: 'ACTIVE' },
        select: CONDITION_FIELDS,
        orderBy: { firstSeenAt: 'asc' },
      }),
    ])

    return projectWorker(
      {
        workerId,
        snapshot: toProjectionSnapshot(snapshot),
        windowSamples: windowSamples.map(toProjectionSample),
        dayTotals: {
          steps: toStepsSample(steps),
          activeEnergy: toEnergyTotal(energy),
          distance: toDistanceSample(distance),
        },
        assessment: assessments.length === 0 ? null : toProjectionAssessment(assessments[0]),
        conditions: conditions.map(toProjectionCondition),
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
   * Série por período de um funcionário. A origem é a do snapshot, como no
   * estado atual: as duas leituras nunca discordam sobre de onde vem o dado, e
   * a série nunca mistura real com demonstração.
   *
   * Dia fechado vem do Resumo do dia; só os dias que o ciclo de vida ainda não
   * resumiu saem das amostras, pela mesma conta. Assim a consulta bruta fica
   * limitada a poucos dias, mesmo no período de um mês.
   */
  async seriesForWorker(workerId: string, period: SeriesPeriod, now = new Date()): Promise<WorkerSeries> {
    const snapshot = await this.prisma.telemetrySnapshot.findUnique({
      where: { workerId },
      select: { origin: true },
    })
    const base = { workerId, period, now }
    if (snapshot === null) {
      return assembleSeries({ ...base, origin: null, summaries: [], samples: [], openFrom: now })
    }

    const { buckets } = seriesBuckets(period, now)
    const first = buckets[0]
    const last = buckets[buckets.length - 1]
    const scope = { workerId, origin: snapshot.origin }
    // "Hoje" nunca tem Resumo: o dia inteiro sai das amostras.
    const openFrom = period === 'day' ? first.start : closedDayCutoff(now)
    const samplesFrom = new Date(Math.max(first.start.getTime(), openFrom.getTime()))

    const [summaries, samples] = await Promise.all([
      period === 'day'
        ? Promise.resolve([])
        : this.prisma.telemetryDailySummary.findMany({
            where: { ...scope, day: { gte: first.day, lte: last.day } },
            select: {
              day: true,
              heartRateMin: true,
              heartRateMax: true,
              heartRateAvg: true,
              stepsTotal: true,
              distanceTotalM: true,
              activeEnergyKcalTotal: true,
              coveredMs: true,
            },
          }),
      this.prisma.telemetrySample.findMany({
        where: { ...scope, eventTime: { gte: samplesFrom, lte: now } },
        select: SUMMARIZER_SAMPLE_FIELDS,
        // Do mais recente para trás: se o teto morder, perde-se o começo do
        // período, nunca o agora. O resumidor reordena.
        orderBy: { eventTime: 'desc' },
        take: SERIES_MAX_SAMPLES,
      }),
    ])

    return assembleSeries({ ...base, origin: snapshot.origin, summaries, samples, openFrom })
  }

  /** A série de um funcionário no painel, dentro da empresa do administrador. */
  async seriesForAdmin(
    admin: JwtUser,
    workerId: string,
    period: SeriesPeriod,
    now = new Date(),
  ): Promise<WorkerSeries> {
    await this.requireSameCompany(admin, workerId)
    return this.seriesForWorker(workerId, period, now)
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
      this.latestAssessmentPerWorker(workerIds),
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
   * Todos os funcionários ativos da empresa numa leitura só, cada um com o
   * aparelho e a mesma projeção de workers/:id/current.
   *
   * Escala do piloto: dezenas de funcionários. O que é por pessoa e pequeno sai
   * em lote com `in` (snapshot, totais do dia, última avaliação, condições
   * abertas, aparelhos), cada um em uma consulta para a empresa inteira. A
   * janela das taxas continua uma consulta por funcionário que reporta, com o
   * mesmo teto de linhas da leitura individual: juntar todas numa só exigiria
   * um teto por pessoa que o `take` do Prisma não expressa, e sem ele um
   * produtor acelerado puxaria a janela inteira de todo mundo.
   */
  async adminWorkers(admin: JwtUser, now = new Date()): Promise<AdminWorkersTelemetry> {
    const companyId = this.companyOfPanelAdmin(admin)
    const people = await this.prisma.user.findMany({
      where: { companyId, role: 'WORKER', active: true },
      select: { id: true, name: true, profile: { select: { sector: true } } },
    })
    if (people.length === 0) return projectAdminWorkers([], now)

    const workerIds = people.map((p) => p.id)
    const ids = { workerId: { in: workerIds } }
    const { start, end } = monitoredDayRange(now)
    const day = { gte: start, lt: end }

    // Os totais e a avaliação vêm agrupados também por origem: cada funcionário
    // lê na origem do próprio snapshot, e a escolha da linha certa é feita em
    // memória, sobre poucas linhas por pessoa.
    const [devices, snapshots, steps, energy, distance, assessments, conditions] = await Promise.all([
      this.prisma.telemetryDevice.findMany({
        where: { revokedAt: null, ...ids },
        select: { workerId: true, lastSeenAt: true },
      }),
      this.prisma.telemetrySnapshot.findMany({ where: ids, select: SNAPSHOT_FIELDS }),
      this.prisma.telemetrySample.groupBy({
        by: ['workerId', 'origin'],
        where: { ...ids, eventTime: day, stepDelta: { not: null } },
        _sum: { stepDelta: true },
        _max: { eventTime: true },
      }),
      this.prisma.telemetrySample.groupBy({
        by: ['workerId', 'origin'],
        where: { ...ids, eventTime: day, activeEnergyKcal: { not: null } },
        _sum: { activeEnergyKcal: true },
        _max: { eventTime: true },
        _min: { eventTime: true },
      }),
      this.prisma.telemetrySample.groupBy({
        by: ['workerId', 'origin'],
        where: { ...ids, eventTime: day, distanceDeltaM: { not: null } },
        _sum: { distanceDeltaM: true },
        _max: { eventTime: true },
      }),
      this.latestAssessmentPerWorkerAndOrigin(workerIds),
      this.prisma.telemetryCondition.findMany({
        where: { ...ids, status: 'ACTIVE' },
        select: { workerId: true, ...CONDITION_FIELDS },
        orderBy: { firstSeenAt: 'asc' },
      }),
    ])

    const snapshotBy = new Map(snapshots.map((s) => [s.workerId, s]))
    const key = (workerId: string, origin: string) => `${workerId}|${origin}`
    const stepsBy = new Map(steps.map((r) => [key(r.workerId, r.origin), r]))
    const energyBy = new Map(energy.map((r) => [key(r.workerId, r.origin), r]))
    const distanceBy = new Map(distance.map((r) => [key(r.workerId, r.origin), r]))
    const assessmentBy = new Map(assessments.map((a) => [key(a.workerId, a.origin), a]))

    const windowStart = new Date(now.getTime() - ENERGY_RATE_WINDOW_MS)
    const windows = new Map(
      await Promise.all(
        snapshots.map(
          async (s) =>
            [
              s.workerId,
              await this.prisma.telemetrySample.findMany({
                where: { workerId: s.workerId, origin: s.origin, eventTime: { gte: windowStart } },
                select: SAMPLE_FIELDS,
                orderBy: { eventTime: 'desc' },
                take: WINDOW_MAX_SAMPLES,
              }),
            ] as const,
        ),
      ),
    )

    const inputs: AdminWorkerInput[] = people.map((person) => {
      const snapshot = snapshotBy.get(person.id)
      const own = (c: { workerId: string }) => c.workerId === person.id
      const base = {
        worker: { id: person.id, name: person.name, sector: person.profile?.sector ?? null },
        devices: devices.filter(own).map((d) => ({ lastSeenAt: iso(d.lastSeenAt) })),
      }
      if (snapshot === undefined) {
        return {
          ...base,
          projection: {
            workerId: person.id,
            snapshot: null,
            windowSamples: [],
            dayTotals: { steps: null, activeEnergy: null, distance: null },
            assessment: null,
            conditions: [],
          },
        }
      }
      const k = key(person.id, snapshot.origin)
      const energyRow = energyBy.get(k)
      const distanceRow = distanceBy.get(k)
      const assessment = assessmentBy.get(k)
      return {
        ...base,
        projection: {
          workerId: person.id,
          snapshot: toProjectionSnapshot(snapshot),
          windowSamples: (windows.get(person.id) ?? []).map(toProjectionSample),
          dayTotals: {
            steps: toStepsSample(stepsBy.get(k)),
            activeEnergy: energyRow === undefined ? null : toEnergyTotal(energyRow),
            distance: distanceRow === undefined ? null : toDistanceSample(distanceRow),
          },
          assessment: assessment === undefined ? null : toProjectionAssessment(assessment),
          conditions: conditions.filter(own).map(toProjectionCondition),
        },
      }
    })

    return projectAdminWorkers(inputs, now)
  }

  /**
   * Só o estado de saúde de cada pessoa pedida, para o mapa de colegas do app.
   * Passa pela mesma projeção da leitura individual, para a atualidade do
   * batimento e a origem das condições seguirem uma regra só, mas lê apenas
   * snapshot e condição aberta: o estado não depende de série nem de avaliação.
   * Quem chama decide de quem pode pedir; aqui não há recorte por empresa.
   */
  async healthStatusOfWorkers(
    workerIds: readonly string[],
    now = new Date(),
  ): Promise<Map<string, HealthStatus>> {
    if (workerIds.length === 0) return new Map()
    const ids = { workerId: { in: [...workerIds] } }
    const [snapshots, conditions] = await Promise.all([
      this.prisma.telemetrySnapshot.findMany({ where: ids, select: SNAPSHOT_FIELDS }),
      this.prisma.telemetryCondition.findMany({
        where: { ...ids, status: 'ACTIVE' },
        select: { workerId: true, ...CONDITION_FIELDS },
      }),
    ])
    const snapshotBy = new Map(snapshots.map((s) => [s.workerId, s]))
    return new Map(
      workerIds.map((workerId) => {
        const snapshot = snapshotBy.get(workerId)
        const telemetry = projectWorker(
          {
            workerId,
            snapshot: snapshot === undefined ? null : toProjectionSnapshot(snapshot),
            windowSamples: [],
            dayTotals: { steps: null, activeEnergy: null, distance: null },
            assessment: null,
            conditions: conditions.filter((c) => c.workerId === workerId).map(toProjectionCondition),
          },
          now,
        )
        return [workerId, healthStatusOf(telemetry)] as const
      }),
    )
  }

  /**
   * A última avaliação de cada funcionário em cada origem, escolhida pelo
   * banco pelo mesmo motivo de `latestAssessmentPerWorker`. A origem entra no
   * DISTINCT ON porque a lista lê cada pessoa na origem do próprio snapshot.
   */
  private latestAssessmentPerWorkerAndOrigin(
    workerIds: string[],
  ): Promise<(AssessmentRow & { workerId: string; origin: TelemetryOrigin })[]> {
    const query = Prisma.sql`
      SELECT DISTINCT ON ("workerId", "origin")
        "workerId", "origin", "computedAt", "effortPercent", "wearPercent", "fatigueEtaMin", "formulaVersion"
      FROM "TelemetryAssessment"
      WHERE "workerId" IN (${Prisma.join(workerIds)})
      ORDER BY "workerId", "origin", "computedAt" DESC
    `
    return this.prisma.$queryRaw(query)
  }

  /**
   * A última avaliação de cada funcionário, escolhida pelo banco.
   *
   * SQL cru de propósito. Trazer todas as avaliações para ficar com uma por
   * pessoa custaria milhares de linhas por refresh do painel, e o `distinct` do
   * Prisma não resolve: ele filtra em memória depois de buscar tudo.
   * `DISTINCT ON` com a ordenação certa devolve uma linha por funcionário
   * direto do Postgres. A origem vai por parâmetro, com o cast que o enum
   * exige; a tabela leva o nome do model porque nenhum deles usa @@map.
   *
   * Sem recorte por dia monitorado: esforço e desgaste já têm prazo de
   * atualidade próprio, e cortar também pelo calendário zerava a cobertura do
   * painel nos primeiros minutos depois da meia-noite de Brasília. A última
   * linha de cada funcionário sai pelo índice (workerId, computedAt), então a
   * busca continua barata sem o limite inferior.
   */
  private latestAssessmentPerWorker(
    workerIds: string[],
  ): Promise<(AssessmentRow & { workerId: string })[]> {
    const query = Prisma.sql`
      SELECT DISTINCT ON ("workerId")
        "workerId", "computedAt", "effortPercent", "wearPercent", "fatigueEtaMin", "formulaVersion"
      FROM "TelemetryAssessment"
      WHERE "workerId" IN (${Prisma.join(workerIds)})
        AND "origin" = CAST(${'REAL'} AS "TelemetryOrigin")
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
    // Até quando as Leituras desta sessão ficam retidas. Sem esse instante, a
    // auditoria não distingue "não houve leitura" de "já foi resumida e
    // apagada": as duas chegam como a mesma lista vazia. Sai de conta com o
    // que a sessão já trouxe, sem consulta a mais, porque esta é a rota mais
    // paginada do read model.
    //
    // O instante é anterior ao apagamento real, que compara dia monitorado e
    // só ocorre depois que o dia inteiro sai da janela. O erro é de propósito
    // para este lado: anunciar retenção mais longa do que a real esconderia um
    // apagamento de quem audita.
    const problems: string[] = []
    const { windowMs } = parseTelemetryRetention(process.env, problems)
    if (problems.length > 0) {
      // Nunca corrigir em silêncio: um instante de retenção calculado com a
      // janela padrão, sobre um ambiente que pediu outra, faria o auditor
      // concluir apagamento que não houve.
      throw new Error(`Configuração de retenção inválida:\n- ${problems.join('\n- ')}`)
    }
    const retainedUntil = new Date(session.startedAt.getTime() + windowMs).toISOString()

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
        distanceDeltaM: true,
        oxygenSaturationPct: true,
        bodyTemperatureC: true,
        bodyTemperatureSource: true,
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
        retainedUntil,
      },
      samples: samples.map((s) => ({
        ...s,
        eventTime: s.eventTime.toISOString(),
        receivedAt: s.receivedAt.toISOString(),
      })),
      // Página cheia é o único sinal de que pode haver mais. Página curta é o
      // fim da trilha, e oferecer cursor ali faria o cliente pedir o vazio.
      // Página vazia é sempre fim de trilha: sem a guarda de tamanho, um limite
      // zero faria "cheia" e "vazia" coincidirem e a busca pela última linha
      // derrubaria a rota. O DTO recusa esse limite antes de chegar aqui, mas
      // o serviço é público e não pode depender só de quem o chama hoje.
      nextCursor:
        samples.length > 0 && samples.length === limit
          ? samples[samples.length - 1].sequence
          : null,
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
