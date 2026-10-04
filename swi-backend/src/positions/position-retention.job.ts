import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { parsePositionRetention } from '../config/runtime-env'
import { PositionHistoryService } from './position-history.service'
import { describeError } from '../common/describe-error'

// Agendamento da retenção da trilha de posições, no padrão do ciclo de vida
// da telemetria: o job só agenda e delega; a regra de apagar mora no serviço.

/**
 * 06:45 UTC, logo depois da rodada da telemetria (06:30): madrugada em
 * Brasília, com o banco ocioso. Outro fuso ajusta pela variável.
 */
export const DEFAULT_POSITION_RETENTION_CRON = '0 45 6 * * *'

/** `||` e não `??`: variável declarada e vazia é ausência, não expressão vazia. */
export function positionRetentionCron(env: NodeJS.ProcessEnv): string {
  return env.POSITION_RETENTION_CRON || DEFAULT_POSITION_RETENTION_CRON
}

@Injectable()
export class PositionRetentionJob {
  private readonly logger = new Logger(PositionRetentionJob.name)

  constructor(private readonly history: PositionHistoryService) {}

  @Cron(positionRetentionCron(process.env))
  async run(): Promise<void> {
    try {
      const problems: string[] = []
      const retention = parsePositionRetention(process.env, problems)
      if (problems.length > 0) {
        // Rede de segurança: a subida do processo já teria recusado a variável.
        throw new Error(`Configuração de retenção inválida:\n- ${problems.join('\n- ')}`)
      }
      const { deleted, stoppedByBudget } = await this.history.purge(new Date(), retention)
      this.logger.log(
        `Retenção de posições: ${deleted} amostras apagadas, ` +
          `${stoppedByBudget ? 'parou no orçamento de tempo' : 'orçamento de tempo folgado'}`,
      )
    } catch (error) {
      // Melhor esforço: o que ficou de fora entra na rodada de amanhã.
      this.logger.warn(`Retenção de posições falhou: ${describeError(error)}`)
    }
  }
}
