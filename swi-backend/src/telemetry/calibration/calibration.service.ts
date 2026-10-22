import { Injectable, Logger } from '@nestjs/common'
import type { CalibrationMetric, Prisma } from '@prisma/client'
import { describeError } from '../../common/describe-error'
import { PrismaService } from '../../prisma/prisma.service'
import { ageInYearsAt, maxHeartRateForAge } from '../assessment/assessment-baseline'
import { monitoredDayOf } from '../domain/metric-state'
import { CALIBRATION_METRICS, CALIBRATION_VERSION, cutsOf, type CalibrationDay } from './calibration-bands'
import { recalculate, type StoredBand, type StoredCalibration } from './recalculate'

// Recálculo diário da calibração individual. Toda regra mora em
// `recalculate` (puro); aqui só se lê, chama e grava. Só origem REAL: DEMO
// fica na partida mínima e nunca ganha calibração gravada.

const DAY_MS = 24 * 60 * 60 * 1000

/** Quantos Resumos o recálculo lê: folga sobre os 30 dias válidos da janela. */
const SUMMARY_LOOKBACK = 120

/** Quem entra na rodada geral: quem teve Resumo REAL nestes dias. */
const ACTIVE_WITHIN_DAYS = 60

/** As colunas do Resumo que o recálculo lê. O `satisfies` cobra cada campo de `CalibrationDay`. */
const CALIBRATION_DAY_FIELDS = {
  day: true,
  deviceFamily: true,
  heartRateCoveredMs: true,
  heartRateMin: true,
  heartRateMax: true,
  heartRateP25: true,
  heartRateP90: true,
  oxygenSaturationP10: true,
  oxygenSaturationP50: true,
  oxygenSaturationCount: true,
  bodyTemperatureP10: true,
  bodyTemperatureP25: true,
  bodyTemperatureP75: true,
  bodyTemperatureP90: true,
  bodyTemperatureCount: true,
  systolicAvg: true,
  diastolicAvg: true,
  bloodPressureCount: true,
  effortP25: true,
  effortP90: true,
  wearMax: true,
  stepsTotal: true,
  distanceTotalM: true,
  activeEnergyKcalTotal: true,
  movementPerMinuteMedian: true,
} as const satisfies Record<keyof CalibrationDay, true>

export interface RecalculateRunResult {
  recalculated: number
  failed: number
}

@Injectable()
export class CalibrationService {
  private readonly logger = new Logger(CalibrationService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** Refaz a calibração de um funcionário. Devolve se gravou. */
  async recalculateWorker(workerId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const previous = await this.loadStored(tx, workerId)
      const profile = await tx.profile.findUnique({ where: { userId: workerId }, select: { birthDate: true } })
      const birthDate = profile?.birthDate ?? null
      // Dias terminados, provisórios ou não: o dia em andamento ainda cresce.
      const days = await tx.telemetryDailySummary.findMany({
        where: { workerId, origin: 'REAL', day: { lt: monitoredDayOf(now) } },
        orderBy: { day: 'desc' },
        take: SUMMARY_LOOKBACK,
        select: CALIBRATION_DAY_FIELDS,
      })

      const result = recalculate({
        previous,
        days,
        maxBpmByAge: birthDate === null ? null : maxHeartRateForAge(ageInYearsAt(birthDate, now)),
      })
      if (result === null) return false

      const calibration = {
        version: CALIBRATION_VERSION,
        deviceFamily: result.deviceFamily,
        phaseStartedAt: result.phaseStartedAt,
        recalibrating: result.recalibrating,
        validDays: result.validDays,
        restingBpm: result.restingBpm,
        peakBpm: result.peakBpm,
        peakPersonalBpm: result.peakPersonalBpm,
        peakStartBpm: result.peakStartBpm,
        computedAt: now,
      }
      await tx.workerCalibration.upsert({
        where: { workerId },
        create: { workerId, ...calibration },
        update: calibration,
      })

      // A correção do gestor (`overrideCuts`) nunca é tocada aqui: o job
      // atualiza o aprendido e o efetivo continua o corrigido.
      for (const metric of CALIBRATION_METRICS) {
        const band = result.bands[metric]
        const data = {
          validDays: band.validDays,
          startCuts: band.start as Prisma.InputJsonObject,
          learnedCuts: band.learned as Prisma.InputJsonObject,
          computedAt: now,
        }
        await tx.workerCalibrationBand.upsert({
          where: { workerId_metric: { workerId, metric } },
          create: { workerId, metric, ...data },
          update: data,
        })
      }

      if (result.deviceChanged && previous !== null) {
        await tx.workerCalibrationChange.create({
          data: {
            workerId,
            action: 'RECALIBRATE_DEVICE',
            actorId: null,
            from: { deviceFamily: previous.deviceFamily },
            to: { deviceFamily: result.deviceFamily },
          },
        })
      }
      return true
    })
  }

  /** Um funcionário por vez; o erro de um não para os outros, como no ciclo de vida. */
  async recalculateAll(now: Date): Promise<RecalculateRunResult> {
    const since = new Date(monitoredDayOf(now).getTime() - ACTIVE_WITHIN_DAYS * DAY_MS)
    const workers = await this.prisma.telemetryDailySummary.findMany({
      where: { origin: 'REAL', day: { gte: since } },
      distinct: ['workerId'],
      select: { workerId: true },
    })
    let recalculated = 0
    let failed = 0
    for (const { workerId } of workers) {
      try {
        if (await this.recalculateWorker(workerId, now)) recalculated++
      } catch (error) {
        failed++
        this.logger.warn(`Calibração falhou para ${workerId}: ${describeError(error)}`)
      }
    }
    return { recalculated, failed }
  }

  private async loadStored(tx: Prisma.TransactionClient, workerId: string): Promise<StoredCalibration | null> {
    const stored = await tx.workerCalibration.findUnique({ where: { workerId } })
    if (stored === null) return null
    const rows = await tx.workerCalibrationBand.findMany({ where: { workerId } })

    const bands: Partial<Record<CalibrationMetric, StoredBand>> = {}
    for (const row of rows) {
      const start = cutsOf(row.metric, row.startCuts)
      const learned = cutsOf(row.metric, row.learnedCuts)
      if (start === null || learned === null) {
        // Faixa torta vale como ausente: o recálculo a refaz da partida. Sem
        // valor no log, só a chave.
        this.logger.warn(`Faixa de calibração ilegível para ${workerId} (${row.metric}); refeita da partida`)
        continue
      }
      bands[row.metric] = { validDays: row.validDays, start, learned }
    }
    return {
      deviceFamily: stored.deviceFamily,
      phaseStartedAt: stored.phaseStartedAt,
      recalibrating: stored.recalibrating,
      peakBpm: stored.peakBpm,
      peakStartBpm: stored.peakStartBpm,
      bands,
    }
  }
}
