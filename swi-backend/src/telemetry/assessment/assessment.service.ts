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
    return this.prisma.$transaction((tx) => this.assessLocked(tx, sessionId, triggerAt, now))
  }

  /**
   * O corpo da avaliação, já dentro da transação. Separado porque o que garante
   * a cadeia é a transação inteira, e misturar abertura e conta na mesma função
   * esconderia que toda leitura daqui para baixo acontece com a sessão travada.
   */
  private async assessLocked(
    tx: Prisma.TransactionClient,
    sessionId: string,
    triggerAt: Date,
    now: Date,
  ): Promise<AssessOutcome> {
    // Lock na linha da sessão antes de ler qualquer coisa. Sem ele, dois lotes
    // da mesma sessão em voo ao mesmo tempo leem a mesma anterior, passam os
    // dois pelo corte e gravam duas avaliações apontando para o mesmo pai, o
    // que bifurca a cadeia. Com ele, o segundo espera, lê o que o primeiro
    // acabou de gravar e cai no corte. A garantia é do banco porque tem de
    // valer para qualquer cliente, não só para um companion bem comportado.
    // NO KEY porque inserir amostra pega FOR KEY SHARE na sessão pela chave
    // estrangeira, e FOR UPDATE seguraria a ingestão de outro lote da mesma
    // sessão enquanto esta avaliação roda. Só as avaliações precisam se
    // enfileirar entre si.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "TelemetrySession" WHERE id = ${sessionId} FOR NO KEY UPDATE
    `
    if (locked.length === 0) throw new Error(`Sessão de monitoramento ${sessionId} não existe para avaliar`)

    // Sondagem leve do corte, pelo índice (sessionId, computedAt). Esta é a
    // rota mais quente do backend e na maioria das chamadas o corte segura;
    // carregar o JSON de inputs para depois descartá-lo seria desperdício.
    const probe = await tx.telemetryAssessment.findFirst({
      where: { sessionId },
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    })
    if (probe !== null && now.getTime() - probe.computedAt.getTime() < ASSESSMENT_THROTTLE_MS) {
      return { outcome: 'throttled' }
    }

    const session = await tx.telemetrySession.findUnique({
      where: { id: sessionId },
      select: { id: true, workerId: true, origin: true, startedAt: true },
    })
    if (session === null) throw new Error(`Sessão de monitoramento ${sessionId} não existe para avaliar`)

    const previous =
      probe === null
        ? null
        : await tx.telemetryAssessment.findFirst({
            where: { sessionId },
            orderBy: { computedAt: 'desc' },
            select: { id: true, windowEnd: true, formulaVersion: true, inputs: true },
          })

    // A cadeia continua só com a mesma versão: estado de outra fórmula não é
    // comparável, e reiniciar é a decisão ficando visível na linha.
    const continues = previous !== null && previous.formulaVersion === this.profile.version
    const previousState = continues ? stateFrom(previous.inputs) : null
    const reason: ChainStartReason | null =
      previous === null ? 'first_of_session' : continues && previousState !== null ? null : 'version_changed'

    // Teto da janela. Sem ele, um relógio que ficou horas fora do ar e despeja
    // o backlog junto com um evento ao vivo puxa milhares de amostras para
    // dentro da conta, e como o backlog vem espaçado de poucos segundos ele
    // passa pelo gapMaxMs e vira dose. O mesmo dado enviado no lote anterior
    // não seria avaliado, então o desgaste dependeria de como o cliente
    // empacotou. O teto é a mesma fronteira que o perfil já usa para lacuna.
    const floor = triggerAt.getTime() - this.profile.chainLookbackMs
    const windowStart =
      reason === null && previous !== null
        ? new Date(Math.max(previous.windowEnd.getTime(), floor))
        : new Date(Math.max(session.startedAt.getTime(), floor))
    const windowEnd = triggerAt
    if (windowEnd.getTime() <= windowStart.getTime()) return { outcome: 'nothing_new' }

    // Quanto da cadeia contínua ficou fora da janela, para a linha contar o que
    // aconteceu. Fora da cadeia contínua não há de onde medir, e o valor é zero.
    const skippedMs =
      reason === null && previous !== null ? Math.max(0, windowStart.getTime() - previous.windowEnd.getTime()) : 0

    const sinceDay = new Date(monitoredDayOf(now).getTime() - this.profile.restingDays * DAY_MS)
    const [samples, profile, summaries] = await Promise.all([
      tx.telemetrySample.findMany({
        where: { sessionId, eventTime: { gt: windowStart, lte: windowEnd } },
        select: { eventTime: true, heartRateBpm: true, motionCount: true },
        orderBy: { eventTime: 'asc' },
      }),
      tx.profile.findUnique({ where: { userId: session.workerId }, select: { birthDate: true } }),
      tx.telemetryDailySummary.findMany({
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
        skippedMs,
        sampleCount: samples.length,
        heartRateSamples: samples.filter((s) => s.heartRateBpm !== null).length,
        motionAvailable: result.motionAvailable,
        reusedHeartRate: result.reusedHeartRate,
      },
      unavailableReason: result.unavailableReason,
    }

    const created = await tx.telemetryAssessment.create({
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
