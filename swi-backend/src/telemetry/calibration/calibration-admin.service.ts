import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type CalibrationMetric, type SafetyRule, type CalibrationChangeAction } from '@prisma/client'
import type { JwtUser } from '../../auth/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { ageInYearsAt, maxHeartRateForAge } from '../assessment/assessment-baseline'
import {
  defaultSafetyLabel,
  defaultSafetyValues,
  safetyValuesOf,
  validateSafety,
  type SafetyValues,
} from '../alerts/safety-limits'
import { CALIBRATION_METRICS, cutsOf, effectiveCuts, startCutsV1, type Cuts } from './calibration-bands'
import { validateCuts } from './calibration-override'
import { calibrationDayOf } from './calibration-thresholds'

// Leitura e correção da calibração pelo painel. O recálculo diário mora em
// CalibrationService; aqui só o que o gestor vê e muda. Toda escrita grava a
// linha do histórico na mesma transação.
//
// Remover o que não existe (correção ausente, trava sem linha) é idempotente:
// devolve o detalhe como está e não grava histórico, porque nada mudou.

export const SAFETY_RULES = [
  'HEART_RATE_HIGH',
  'HEART_RATE_LOW',
  'OXYGEN_LOW',
  'BLOOD_PRESSURE_HIGH',
  'WEAR_HIGH',
] as const satisfies readonly SafetyRule[]

export const CALIBRATION_HISTORY_PAGE = 50

export interface CalibrationMetricDetail {
  metric: CalibrationMetric
  validDays: number
  start: Cuts
  learned: Cuts
  override: Cuts | null
  effective: Cuts
  /** De onde vem o efetivo: correção do gestor, aprendido, ou partida v1.0 sem recálculo ainda. */
  source: 'OVERRIDE' | 'LEARNED' | 'START'
}

export interface SafetyDetail {
  rule: SafetyRule
  defaultLabel: string
  defaultValues: SafetyValues
  effective: SafetyValues
  custom: boolean
  updatedAt: Date | null
}

export interface CalibrationDetail {
  workerId: string
  version: string | null
  phase: 'CALIBRATING' | 'CALIBRATED'
  day: number | null
  recalibrating: boolean
  deviceFamily: string | null
  ruler: {
    restingBpm: number | null
    peakBpm: number | null
    peakPersonalBpm: number | null
    peakStartBpm: number | null
    maxBpmByAge: number | null
  }
  metrics: CalibrationMetricDetail[]
  safety: SafetyDetail[]
}

export interface CalibrationHistoryItem {
  id: string
  action: CalibrationChangeAction
  metric: CalibrationMetric | null
  rule: SafetyRule | null
  from: Prisma.JsonValue
  to: Prisma.JsonValue
  actor: { id: string; name: string } | null
  at: Date
}

export interface CalibrationHistoryPage {
  items: CalibrationHistoryItem[]
  nextCursor: string | null
}

type Db = Prisma.TransactionClient | PrismaService
type JsonIn = Prisma.JsonValue | Cuts | SafetyValues | null

const jsonOrNull = (value: JsonIn) => (value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue))

@Injectable()
export class CalibrationAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async detail(caller: JwtUser, workerId: string, now = new Date()): Promise<CalibrationDetail> {
    await this.requireWorker(caller, workerId)
    return this.load(this.prisma, workerId, now)
  }

  async history(caller: JwtUser, workerId: string, cursor?: string): Promise<CalibrationHistoryPage> {
    await this.requireWorker(caller, workerId)
    // Um a mais que a página: diz se há próxima sem contar à parte.
    const rows = await this.prisma.workerCalibrationChange.findMany({
      where: { workerId },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: CALIBRATION_HISTORY_PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    const page = rows.slice(0, CALIBRATION_HISTORY_PAGE)
    const actorIds = [...new Set(page.flatMap((r) => (r.actorId === null ? [] : [r.actorId])))]
    const actors =
      actorIds.length === 0
        ? []
        : await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    const nameOf = new Map(actors.map((a) => [a.id, a.name]))
    return {
      items: page.map((r) => ({
        id: r.id,
        action: r.action,
        metric: r.metric,
        rule: r.rule,
        from: r.from,
        to: r.to,
        // Quem fez e depois foi apagado ainda aparece pelo id, sem nome.
        actor: r.actorId === null ? null : { id: r.actorId, name: nameOf.get(r.actorId) ?? '' },
        at: r.at,
      })),
      nextCursor: rows.length > CALIBRATION_HISTORY_PAGE ? page[page.length - 1].id : null,
    }
  }

  async setBand(caller: JwtUser, workerId: string, metric: CalibrationMetric, body: unknown, now = new Date()) {
    await this.requireWorker(caller, workerId)
    const error = validateCuts(metric, body)
    if (error !== null) throw new BadRequestException(error)
    // O que se grava é o lido por cutsOf: chave a mais no corpo fica de fora.
    const cuts = cutsOf(metric, body)!
    await this.prisma.$transaction(async (tx) => {
      const where = { workerId_metric: { workerId, metric } }
      const existing = await tx.workerCalibrationBand.findUnique({ where })
      const override = { overrideCuts: cuts as Prisma.InputJsonObject, overrideById: caller.userId, overrideAt: now }
      if (existing === null) {
        // Antes do primeiro recálculo: a linha nasce da partida v1.0, com a correção.
        const start = startCutsV1(metric, await this.maxBpmByAge(tx, workerId, now)) as Prisma.InputJsonObject
        await tx.workerCalibrationBand.create({
          data: { workerId, metric, validDays: 0, startCuts: start, learnedCuts: start, computedAt: now, ...override },
        })
      } else {
        await tx.workerCalibrationBand.update({ where, data: override })
      }
      await this.record(tx, workerId, caller, 'BAND_OVERRIDE', { metric }, existing?.overrideCuts ?? null, cuts)
    })
    return this.load(this.prisma, workerId, now)
  }

  async clearBand(caller: JwtUser, workerId: string, metric: CalibrationMetric, now = new Date()) {
    await this.requireWorker(caller, workerId)
    await this.prisma.$transaction(async (tx) => {
      const where = { workerId_metric: { workerId, metric } }
      const existing = await tx.workerCalibrationBand.findUnique({ where })
      if (existing === null || existing.overrideCuts === null) return
      await tx.workerCalibrationBand.update({
        where,
        data: { overrideCuts: Prisma.DbNull, overrideById: null, overrideAt: null },
      })
      await this.record(tx, workerId, caller, 'BAND_REVERT', { metric }, existing.overrideCuts, null)
    })
    return this.load(this.prisma, workerId, now)
  }

  async setSafety(caller: JwtUser, workerId: string, rule: SafetyRule, body: unknown, now = new Date()) {
    await this.requireWorker(caller, workerId)
    const error = validateSafety(rule, body)
    if (error !== null) throw new BadRequestException(error)
    const values = safetyValuesOf(rule, body)!
    await this.prisma.$transaction(async (tx) => {
      const where = { workerId_rule: { workerId, rule } }
      const existing = await tx.workerSafetyLimit.findUnique({ where })
      const data = { values: values as unknown as Prisma.InputJsonObject, updatedById: caller.userId }
      await tx.workerSafetyLimit.upsert({ where, create: { workerId, rule, ...data }, update: data })
      await this.record(tx, workerId, caller, 'SAFETY_SET', { rule }, existing?.values ?? null, values)
    })
    return this.load(this.prisma, workerId, now)
  }

  async clearSafety(caller: JwtUser, workerId: string, rule: SafetyRule, now = new Date()) {
    await this.requireWorker(caller, workerId)
    await this.prisma.$transaction(async (tx) => {
      const where = { workerId_rule: { workerId, rule } }
      const existing = await tx.workerSafetyLimit.findUnique({ where })
      if (existing === null) return
      await tx.workerSafetyLimit.delete({ where })
      await this.record(tx, workerId, caller, 'SAFETY_REVERT', { rule }, existing.values, null)
    })
    return this.load(this.prisma, workerId, now)
  }

  /**
   * Só funcionário da mesma empresa. Inexistente, de outra empresa, quem chama
   * sem empresa e id que não é de funcionário respondem o mesmo 404, para não
   * revelar quem existe.
   */
  private async requireWorker(caller: JwtUser, workerId: string): Promise<void> {
    const user =
      caller.companyId === null
        ? null
        : await this.prisma.user.findUnique({ where: { id: workerId }, select: { companyId: true, role: true } })
    if (user === null || user.companyId !== caller.companyId || user.role !== 'WORKER') {
      throw new NotFoundException('Funcionário não encontrado')
    }
  }

  private async record(
    tx: Prisma.TransactionClient,
    workerId: string,
    caller: JwtUser,
    action: CalibrationChangeAction,
    target: { metric?: CalibrationMetric; rule?: SafetyRule },
    from: JsonIn,
    to: JsonIn,
  ) {
    await tx.workerCalibrationChange.create({
      data: { workerId, action, ...target, actorId: caller.userId, from: jsonOrNull(from), to: jsonOrNull(to) },
    })
  }

  private async maxBpmByAge(db: Db, workerId: string, now: Date): Promise<number | null> {
    const profile = await db.profile.findUnique({ where: { userId: workerId }, select: { birthDate: true } })
    const birthDate = profile?.birthDate ?? null
    return birthDate === null ? null : maxHeartRateForAge(ageInYearsAt(birthDate, now))
  }

  private async load(db: Db, workerId: string, now: Date): Promise<CalibrationDetail> {
    const [calibration, bands, limits, maxBpmByAge] = await Promise.all([
      db.workerCalibration.findUnique({ where: { workerId } }),
      db.workerCalibrationBand.findMany({ where: { workerId } }),
      db.workerSafetyLimit.findMany({ where: { workerId } }),
      this.maxBpmByAge(db, workerId, now),
    ])
    const day = calibrationDayOf(calibration)
    const restingBpm = calibration?.restingBpm ?? null

    const metrics = CALIBRATION_METRICS.map((metric): CalibrationMetricDetail => {
      const v1 = startCutsV1(metric, maxBpmByAge)
      const row = bands.find((b) => b.metric === metric)
      // Linha torta vale como ausente, como no recálculo e no motor.
      const start = row === undefined ? v1 : (cutsOf(metric, row.startCuts) ?? v1)
      const learned = row === undefined ? v1 : (cutsOf(metric, row.learnedCuts) ?? v1)
      const override = row === undefined || row.overrideCuts === null ? null : cutsOf(metric, row.overrideCuts)
      const source = override !== null ? 'OVERRIDE' : row === undefined ? 'START' : 'LEARNED'
      return {
        metric,
        validDays: row?.validDays ?? 0,
        start,
        learned,
        override,
        effective: effectiveCuts(learned, override),
        source,
      }
    })

    const safety = SAFETY_RULES.map((rule): SafetyDetail => {
      const defaultValues = defaultSafetyValues(rule, { maxBpm: maxBpmByAge, restingBpm })
      const row = limits.find((l) => l.rule === rule)
      const custom = row === undefined ? null : safetyValuesOf(rule, row.values)
      return {
        rule,
        defaultLabel: defaultSafetyLabel(rule, { maxBpm: maxBpmByAge }),
        defaultValues,
        effective: custom ?? defaultValues,
        custom: custom !== null,
        updatedAt: custom === null ? null : row!.updatedAt,
      }
    })

    return {
      workerId,
      version: calibration?.version ?? null,
      phase: day === null ? 'CALIBRATED' : 'CALIBRATING',
      day,
      recalibrating: calibration?.recalibrating ?? false,
      deviceFamily: calibration?.deviceFamily ?? null,
      ruler: {
        restingBpm,
        peakBpm: calibration?.peakBpm ?? null,
        peakPersonalBpm: calibration?.peakPersonalBpm ?? null,
        peakStartBpm: calibration?.peakStartBpm ?? null,
        maxBpmByAge,
      },
      metrics,
      safety,
    }
  }
}
