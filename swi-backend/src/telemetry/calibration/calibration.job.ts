import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { describeError } from '../../common/describe-error'
import { CalibrationService } from './calibration.service'

// Agendamento do recálculo da calibração, no molde do ciclo de vida: a camada
// mais fina possível. Toda regra mora no serviço e no recálculo puro.

/**
 * 06:45 UTC, 15 minutos depois do ciclo de vida (06:30): o recálculo lê os
 * Resumos que aquela rodada acabou de fechar. Interpretada no fuso do
 * processo, como a do ciclo de vida.
 */
export const DEFAULT_CALIBRATION_CRON = '0 45 6 * * *'

/** `||` e não `??`: variável declarada e vazia é ausência, não expressão vazia. */
export function calibrationCron(env: NodeJS.ProcessEnv): string {
  return env.TELEMETRY_CALIBRATION_CRON || DEFAULT_CALIBRATION_CRON
}

@Injectable()
export class CalibrationJob {
  private readonly logger = new Logger(CalibrationJob.name)

  constructor(private readonly calibration: CalibrationService) {}

  @Cron(calibrationCron(process.env))
  async run(): Promise<void> {
    const startedAt = Date.now()
    try {
      const { recalculated, failed } = await this.calibration.recalculateAll(new Date())
      this.logger.log(`Calibração: ${recalculated} funcionários recalculados, ${failed} falharam, em ${Date.now() - startedAt} ms`)
    } catch (error) {
      // Melhor esforço: o que ficou de fora entra na rodada de amanhã.
      this.logger.warn(`Calibração falhou: ${describeError(error)}`)
    }
  }
}
