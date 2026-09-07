import { Injectable, Logger } from '@nestjs/common'
import type { Prisma, TelemetryConditionKind, TelemetryOrigin } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ageInYearsAt, maxHeartRateForAge, restingFromDailyMinima } from '../assessment/assessment-baseline'
import { monitoredDayOf } from '../domain/metric-state'
import { EXPERIMENTAL_ALERT_PROFILE, type AlertProfile } from './alert-profile'
import {
  decideBattery,
  decideBloodPressure,
  decideHeartRate,
  heartRateLimits,
  type Decision,
  type EngineSample,
} from './condition-engine'

// Serviço de condições: decide QUAIS LINHAS entram na conta e grava o
// resultado; a conta é do motor, que é puro. Condição e alerta são máquinas
// separadas: a condição diz o que o corpo ou o aparelho está fazendo agora, e
// recupera sozinha; o alerta diz que um humano precisa olhar, e só fecha na mão.

const DAY_MS = 24 * 60 * 60 * 1000

/** Tipos que viram item de fila. Bateria e sinal são estado, não item. */
const ALERTING_KINDS: ReadonlySet<TelemetryConditionKind> = new Set<TelemetryConditionKind>([
  'HEART_RATE_HIGH',
  'HEART_RATE_LOW',
  'BLOOD_PRESSURE_REVIEW',
])

export interface EvaluateOutcome {
  opened: TelemetryConditionKind[]
  recovered: TelemetryConditionKind[]
  alerts: number
}

interface ActiveRow {
  id: string
  kind: TelemetryConditionKind
}

@Injectable()
export class TelemetryConditionService {
  private readonly logger = new Logger(TelemetryConditionService.name)
  private readonly profile: AlertProfile = EXPERIMENTAL_ALERT_PROFILE

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Avalia as condições de VALOR de uma sessão a partir de um evento ao vivo.
   * `triggerAt` é o eventTime mais recente do lote; `now` é o relógio do
   * servidor, e é contra ele que os carimbos são gravados.
   */
  async evaluateSession(sessionId: string, triggerAt: Date, now: Date): Promise<EvaluateOutcome> {
    return this.prisma.$transaction((tx) => this.evaluateLocked(tx, sessionId, triggerAt, now))
  }

  private async evaluateLocked(
    tx: Prisma.TransactionClient,
    sessionId: string,
    triggerAt: Date,
    now: Date,
  ): Promise<EvaluateOutcome> {
    // Mesmo lock da avaliação de esforço, pelo mesmo motivo: dois lotes da
    // mesma sessão em voo ao mesmo tempo abririam a mesma condição duas vezes.
    // NO KEY para não segurar a inserção de amostra, que pega FOR KEY SHARE.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "TelemetrySession" WHERE id = ${sessionId} FOR NO KEY UPDATE
    `
    if (locked.length === 0) throw new Error(`Sessão de monitoramento ${sessionId} não existe para avaliar condições`)

    const session = await tx.telemetrySession.findUnique({
      where: { id: sessionId },
      select: { id: true, workerId: true, origin: true },
    })
    if (session === null) throw new Error(`Sessão de monitoramento ${sessionId} não existe para avaliar condições`)

    // Por funcionário e origem, e não por sessão: uma condição aberta numa
    // sessão continua sendo dele na seguinte, mas real e demonstração nunca se
    // misturam, e sem o filtro uma condição de demonstração ativa faria o
    // motor concluir que a real já está aberta e nunca abri-la.
    const active = (await tx.telemetryCondition.findMany({
      where: { workerId: session.workerId, origin: session.origin, status: 'ACTIVE' },
      select: { id: true, kind: true },
    })) as ActiveRow[]
    const activeByKind = new Map(active.map((c) => [c.kind, c]))

    const windowStart = new Date(triggerAt.getTime() - this.profile.persistence.windowMs)
    const sinceDay = new Date(monitoredDayOf(now).getTime() - this.profile.restingDays * DAY_MS)
    const [rows, profile, summaries] = await Promise.all([
      // Fronteira de baixo fechada, como a do motor: aberta, a amostra que cai
      // exatamente no início da janela ficaria de fora e o trecho medido seria
      // menor que o que o perfil declara.
      tx.telemetrySample.findMany({
        where: { sessionId, eventTime: { gte: windowStart, lte: triggerAt } },
        select: { eventTime: true, heartRateBpm: true, batteryPercent: true, systolicMmHg: true, diastolicMmHg: true },
        orderBy: { eventTime: 'asc' },
      }),
      tx.profile.findUnique({ where: { userId: session.workerId }, select: { birthDate: true } }),
      tx.telemetryDailySummary.findMany({
        where: {
          workerId: session.workerId,
          origin: session.origin,
          day: { gte: sinceDay },
          heartRateMin: { not: null },
        },
        select: { heartRateMin: true },
        orderBy: { day: 'desc' },
        take: this.profile.restingDays,
      }),
    ])

    const restingBpm = restingFromDailyMinima(
      summaries.flatMap((s) => (s.heartRateMin === null ? [] : [s.heartRateMin])),
    )
    const birthDate = profile?.birthDate ?? null
    const maxBpm = birthDate === null ? null : maxHeartRateForAge(ageInYearsAt(birthDate, now))
    const limits = heartRateLimits(this.profile, { maxBpm, restingBpm })

    const samples: EngineSample[] = rows.map((r) => ({
      atMs: r.eventTime.getTime(),
      heartRateBpm: r.heartRateBpm,
      batteryPercent: r.batteryPercent,
    }))
    // Bateria e pressão vêm da leitura mais recente DENTRO da janela, e é isso
    // que lhes dá frescor: o motor recebe um escalar sem instante, então quem
    // garante que ele descreve o agora é este recorte. Bateria chega a cada
    // cinco minutos, então na maioria das avaliações não há leitura na janela
    // e nada é decidido sobre ela, o que é correto.
    const latestBattery = [...rows].reverse().find((r) => r.batteryPercent !== null)?.batteryPercent ?? null
    const latestPressure = [...rows].reverse().find((r) => r.systolicMmHg !== null && r.diastolicMmHg !== null)
    const pressure =
      latestPressure === undefined
        ? null
        : { systolic: latestPressure.systolicMmHg as number, diastolic: latestPressure.diastolicMmHg as number }

    const nowMs = triggerAt.getTime()
    const decisions: Decision[] = [
      decideHeartRate('HEART_RATE_HIGH', samples, limits.high, activeByKind.has('HEART_RATE_HIGH'), this.profile, nowMs),
      decideHeartRate('HEART_RATE_LOW', samples, limits.low, activeByKind.has('HEART_RATE_LOW'), this.profile, nowMs),
      decideBattery(latestBattery, activeByKind.has('DEVICE_BATTERY_LOW'), this.profile),
      decideBloodPressure(pressure, activeByKind.has('BLOOD_PRESSURE_REVIEW'), this.profile),
    ].flatMap((d) => (d === null ? [] : [d]))

    // Evento ao vivo é sinal de volta: perda de sinal ativa recupera aqui, e
    // não na varredura, que só enxerga o silêncio.
    if (activeByKind.has('DEVICE_SIGNAL_LOST')) {
      decisions.push({ kind: 'DEVICE_SIGNAL_LOST', action: 'RECOVER', observedValue: null, threshold: null })
    }

    const outcome: EvaluateOutcome = { opened: [], recovered: [], alerts: 0 }
    for (const decision of decisions) {
      if (decision.action === 'RECOVER') {
        const row = activeByKind.get(decision.kind)
        if (row === undefined) continue
        // observedValue não é reescrito: ele guarda o valor que ABRIU a
        // condição, que é o que a auditoria quer saber. O valor da
        // recuperação já está no histórico de amostras.
        await tx.telemetryCondition.update({
          where: { id: row.id },
          data: { status: 'RECOVERED', recoveredAt: now, recoveryReason: 'NORMALIZED', lastSeenAt: now },
        })
        outcome.recovered.push(decision.kind)
        continue
      }

      const created = await tx.telemetryCondition.create({
        data: {
          workerId: session.workerId,
          sessionId: session.id,
          origin: session.origin,
          kind: decision.kind,
          status: 'ACTIVE',
          firstSeenAt: now,
          lastSeenAt: now,
          thresholdProfile: this.profile.version,
          thresholdRule: decision.threshold?.rule ?? null,
          thresholdValue: decision.threshold?.value ?? null,
          observedValue: decision.observedValue,
        },
        select: { id: true },
      })
      outcome.opened.push(decision.kind)
      if (await this.openAlert(tx, created.id, session.workerId, session.origin, decision.kind)) outcome.alerts += 1
    }

    if (outcome.opened.length > 0 || outcome.recovered.length > 0) {
      this.logger.debug(
        `Condições da sessão ${session.id}: abriu ${outcome.opened.join(',') || 'nada'}, recuperou ${outcome.recovered.join(',') || 'nada'}, ${outcome.alerts} alerta(s)`,
      )
    }
    return outcome
  }

  /**
   * Alerta nasce na mesma transação da condição, e só para os tipos que
   * exigem gente. Não nasce enquanto houver um não resolvido do mesmo
   * funcionário e tipo: a fila não empilha o mesmo problema, e o alerta antigo
   * já diz "olhe este funcionário".
   */
  private async openAlert(
    tx: Prisma.TransactionClient,
    conditionId: string,
    workerId: string,
    origin: TelemetryOrigin,
    kind: TelemetryConditionKind,
  ): Promise<boolean> {
    if (!ALERTING_KINDS.has(kind)) return false
    const unresolved = await tx.operationalAlert.findFirst({
      where: { workerId, status: { in: ['OPEN', 'ACKNOWLEDGED'] }, condition: { kind } },
      select: { id: true },
    })
    if (unresolved !== null) return false
    await tx.operationalAlert.create({ data: { conditionId, workerId, origin, status: 'OPEN' } })
    return true
  }
}
