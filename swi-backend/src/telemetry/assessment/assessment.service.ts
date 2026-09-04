import { Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { monitoredDayOf } from '../domain/metric-state'
import { ageInYearsAt, maxHeartRateForAge, restingFromDailyMinima } from './assessment-baseline'
import { EXPERIMENTAL_PROFILE, type AssessmentProfile } from './assessment-profile'
import { assessWindow, type Baseline, type FormulaState } from './fatigue-formula'

// Serviço de avaliação: decide QUAIS LINHAS entram na conta e grava o
// resultado; a conta é da fórmula, que é pura. A cadeia é por sessão de
// monitoramento: cada linha guarda em inputs o estado que recebeu e o que
// devolveu, e a próxima parte dali. Reler o turno inteiro a cada 15 s na rota
// mais quente do backend foi recusado (ADR-0009).

/** Corte entre avaliações da mesma sessão. É a decisão da ADR-0006. */
export const ASSESSMENT_THROTTLE_MS = 15_000

const DAY_MS = 24 * 60 * 60 * 1000

export type AssessOutcome =
  | { outcome: 'assessed'; assessmentId: string }
  | { outcome: 'throttled' }
  | { outcome: 'nothing_new' }

type ChainStartReason = 'first_of_session' | 'version_changed'

function stateFrom(inputs: Prisma.JsonValue): FormulaState | null {
  const chain = (inputs as { chain?: { nextState?: unknown } } | null)?.chain
  const state = chain?.nextState as Partial<FormulaState> | undefined
  if (!state || typeof state.strainDose !== 'number') return null
  return {
    strainDose: state.strainDose,
    effortEma: typeof state.effortEma === 'number' ? state.effortEma : null,
    lastHeartRate: state.lastHeartRate ?? null,
    lastSampleAtMs: typeof state.lastSampleAtMs === 'number' ? state.lastSampleAtMs : null,
  }
}

@Injectable()
export class TelemetryAssessmentService {
  private readonly logger = new Logger(TelemetryAssessmentService.name)
  private readonly profile: AssessmentProfile = EXPERIMENTAL_PROFILE

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Avalia uma sessão a partir de um evento ao vivo. `triggerAt` é o eventTime
   * mais recente do lote; `now` é o relógio do servidor, e é contra ele que o
   * corte de 15 s e o computedAt são medidos.
   */
  async assessSession(sessionId: string, triggerAt: Date, now: Date): Promise<AssessOutcome> {
    const session = await this.prisma.telemetrySession.findUnique({
      where: { id: sessionId },
      select: { id: true, workerId: true, origin: true, startedAt: true },
    })
    if (session === null) throw new Error(`Sessão de monitoramento ${sessionId} não existe para avaliar`)

    const previous = await this.prisma.telemetryAssessment.findFirst({
      where: { sessionId },
      orderBy: { computedAt: 'desc' },
      select: { id: true, computedAt: true, windowEnd: true, formulaVersion: true, inputs: true },
    })

    if (previous !== null && now.getTime() - previous.computedAt.getTime() < ASSESSMENT_THROTTLE_MS) {
      return { outcome: 'throttled' }
    }

    // A cadeia continua só com a mesma versão: estado de outra fórmula não é
    // comparável, e reiniciar é a decisão ficando visível na linha.
    const continues = previous !== null && previous.formulaVersion === this.profile.version
    const previousState = continues ? stateFrom(previous.inputs) : null
    const reason: ChainStartReason | null =
      previous === null ? 'first_of_session' : continues && previousState !== null ? null : 'version_changed'

    const windowStart =
      reason === null && previous !== null
        ? previous.windowEnd
        : new Date(Math.max(session.startedAt.getTime(), triggerAt.getTime() - this.profile.chainLookbackMs))
    const windowEnd = triggerAt
    if (windowEnd.getTime() <= windowStart.getTime()) return { outcome: 'nothing_new' }

    const sinceDay = new Date(monitoredDayOf(now).getTime() - this.profile.restingDays * DAY_MS)
    const [samples, profile, summaries] = await Promise.all([
      this.prisma.telemetrySample.findMany({
        where: { sessionId, eventTime: { gt: windowStart, lte: windowEnd } },
        select: { eventTime: true, heartRateBpm: true, motionCount: true },
        orderBy: { eventTime: 'asc' },
      }),
      this.prisma.profile.findUnique({ where: { userId: session.workerId }, select: { birthDate: true } }),
      this.prisma.telemetryDailySummary.findMany({
        where: { workerId: session.workerId, origin: session.origin, day: { gte: sinceDay }, heartRateMin: { not: null } },
        select: { heartRateMin: true },
        orderBy: { day: 'desc' },
        take: this.profile.restingDays,
      }),
    ])

    const minima = summaries.flatMap((s) => (s.heartRateMin === null ? [] : [s.heartRateMin]))
    const restingBpm = restingFromDailyMinima(minima)
    const birthDate = profile?.birthDate ?? null
    const ageYears = birthDate === null ? null : ageInYearsAt(birthDate, now)
    const maxBpm = ageYears === null ? null : maxHeartRateForAge(ageYears)

    const baseline: Baseline =
      restingBpm === null
        ? { kind: 'unavailable', reason: 'no_resting_baseline' }
        : maxBpm === null
          ? { kind: 'unavailable', reason: 'no_birth_date' }
          : { kind: 'available', restingBpm, maxBpm }

    const result = assessWindow({
      profile: this.profile,
      previous: previousState,
      baseline,
      samples: samples.map((s) => ({ atMs: s.eventTime.getTime(), heartRateBpm: s.heartRateBpm, motionCount: s.motionCount })),
      window: { startMs: windowStart.getTime(), endMs: windowEnd.getTime() },
    })

    const inputs = {
      profile: this.profile,
      chain: {
        reason,
        previousAssessmentId: reason === null && previous !== null ? previous.id : null,
        previousState,
        nextState: result.nextState,
      },
      baseline: { restingBpm, days: minima.length, ageYears, maxBpm },
      window: {
        sampleCount: samples.length,
        heartRateSamples: samples.filter((s) => s.heartRateBpm !== null).length,
        motionAvailable: result.motionAvailable,
        reusedHeartRate: result.reusedHeartRate,
      },
      unavailableReason: result.unavailableReason,
    }

    const created = await this.prisma.telemetryAssessment.create({
      data: {
        workerId: session.workerId,
        sessionId: session.id,
        origin: session.origin,
        computedAt: now,
        windowStart,
        windowEnd,
        effortPercent: result.effortPercent,
        wearPercent: result.wearPercent,
        formulaVersion: this.profile.version,
        inputs: inputs as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    })

    this.logger.debug(
      `Avaliação ${created.id}: sessão ${session.id}, esforço ${result.effortPercent ?? 'indisponível'}, desgaste ${result.wearPercent ?? 'indisponível'}${result.unavailableReason ? ` (${result.unavailableReason})` : ''}`,
    )
    return { outcome: 'assessed', assessmentId: created.id }
  }
}
