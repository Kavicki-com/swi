import { Injectable, Logger } from '@nestjs/common'
import type { Prisma, TelemetryOrigin } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { monitoredDayWindow } from '../domain/metric-state'
import { baselineFor, restingMinimaOf } from './assessment-baseline'
import { assessSparseDay } from './fatigue-formula-sparse'
import { SPARSE_PROFILE } from './sparse-profile'

// Avaliação esparsa: um dia de pulseira, do começo, a cada sincronização. Fica
// fora da rota ao vivo e fora da cadeia por sessão: a pulseira abre uma sessão
// por sincronização, e a conta é do dia do funcionário, não da sessão.

export type SparseOutcome =
  | { outcome: 'assessed'; assessmentId: string }
  | { outcome: 'throttled' }
  | { outcome: 'nothing_new' }

@Injectable()
export class SparseAssessmentService {
  private readonly logger = new Logger(SparseAssessmentService.name)
  private readonly profile = SPARSE_PROFILE

  constructor(private readonly prisma: PrismaService) {}

  /** `day` é a data pura do dia monitorado (meia-noite UTC), como o Resumo a guarda. */
  async assessDay(workerId: string, origin: TelemetryOrigin, day: Date, now: Date): Promise<SparseOutcome> {
    return this.prisma.$transaction((tx) => this.assessLocked(tx, workerId, origin, day, now))
  }

  private async assessLocked(
    tx: Prisma.TransactionClient,
    workerId: string,
    origin: TelemetryOrigin,
    day: Date,
    now: Date,
  ): Promise<SparseOutcome> {
    // Lock consultivo por funcionário, origem e dia: dois lotes da mesma
    // sincronização em voo recalculariam o mesmo dia ao mesmo tempo e gravariam
    // duas linhas, e o corte de um minuto não veria a outra. $executeRaw pelo
    // mesmo motivo do lock das condições: pg_advisory_xact_lock devolve void.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sparse:${workerId}:${origin}:${day.toISOString()}`}))`

    const { start, end } = monitoredDayWindow(day)
    const last = await tx.telemetryAssessment.findFirst({
      where: { workerId, origin, formulaVersion: this.profile.version, windowStart: start },
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    })
    if (last !== null && now.getTime() - last.computedAt.getTime() < this.profile.recomputeThrottleMs) {
      return { outcome: 'throttled' }
    }

    const [rows, profileRow, minima] = await Promise.all([
      tx.telemetrySample.findMany({
        where: { workerId, origin, eventTime: { gte: start, lt: end }, heartRateBpm: { not: null } },
        select: { eventTime: true, heartRateBpm: true, sessionId: true },
        orderBy: { eventTime: 'asc' },
      }),
      tx.profile.findUnique({ where: { userId: workerId }, select: { birthDate: true } }),
      restingMinimaOf(tx, workerId, origin, now, this.profile.restingDays),
    ])
    if (rows.length === 0) return { outcome: 'nothing_new' }

    // O piso provisório da pulseira é o mínimo do próprio dia: ela abre uma
    // sessão por sincronização, e o mínimo de uma sessão só diria pouco.
    const beats = rows.map((r) => ({ atMs: r.eventTime.getTime(), bpm: r.heartRateBpm as number }))
    const dayMin = beats.reduce((min, b) => Math.min(min, b.bpm), Number.POSITIVE_INFINITY)
    const { baseline, resting, ageYears, maxBpm } = baselineFor(
      { ...minima, sessionMinBpm: dayMin },
      profileRow?.birthDate ?? null,
      now,
    )
    const result = assessSparseDay({ profile: this.profile, baseline, samples: beats })
    const lastRow = rows[rows.length - 1]

    const created = await tx.telemetryAssessment.create({
      data: {
        workerId,
        sessionId: lastRow.sessionId,
        origin,
        computedAt: now,
        windowStart: start,
        windowEnd: lastRow.eventTime,
        effortPercent: result.effortPercent,
        wearPercent: result.wearPercent,
        fatigueEtaMin: null,
        formulaVersion: this.profile.version,
        baselineSource:
          baseline.kind === 'available' ? (resting.source === 'measured' ? 'MEASURED' : 'PROVISIONAL') : null,
        inputs: {
          profile: this.profile,
          chain: { reason: 'sparse_day' },
          baseline: { restingBpm: resting.restingBpm, source: resting.source, days: resting.days, ageYears, maxBpm },
          window: {
            day: day.toISOString(),
            sampleCount: rows.length,
            heartRateSamples: rows.length,
            gapsOverMax: result.gapsOverMax,
          },
          unavailableReason: result.unavailableReason,
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    })
    // Sem esforço nem desgaste na mensagem, como na avaliação do relógio.
    this.logger.debug(`Avaliação esparsa ${created.id}: funcionário ${workerId}, dia ${day.toISOString().slice(0, 10)}`)
    return { outcome: 'assessed', assessmentId: created.id }
  }
}
