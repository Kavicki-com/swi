import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { TelemetryConditionService } from './condition.service'

// Agendamento da varredura de silêncio, no molde do job do ciclo de vida. Este
// arquivo é de propósito a camada mais fina do módulo: ele não decide o que é
// silêncio, o que recupera nem o que abre. Toda regra mora no serviço, que a
// suíte chama direto com um instante fixo, e é por isso que aqui não há nada
// além de delegar e registrar.

/**
 * A cada 30 segundos. Perda de sinal abre com 120 s de silêncio, então varrer
 * nessa cadência deixa a latência máxima de detecção em 150 s: o painel diz
 * "sem sinal" em menos de três minutos, que é o que a operação espera de um
 * relógio que sumiu.
 *
 * O job do ciclo de vida não serve para isto: ele roda uma vez por dia, às
 * 06:30, e uma perda de sinal detectada na madrugada seguinte não é detecção, é
 * arqueologia. São dois agendamentos porque são duas cadências, não porque são
 * dois assuntos.
 *
 * Seis campos, e não cinco: o cron do Nest aceita segundos na primeira posição,
 * e é dela que a cadência abaixo de um minuto depende.
 */
export const DEFAULT_SWEEP_CRON = '*/30 * * * * *'

/** `||` e não `??`: variável declarada e vazia é ausência, não expressão vazia. */
export function conditionSweepCron(env: NodeJS.ProcessEnv): string {
  return env.TELEMETRY_CONDITION_SWEEP_CRON || DEFAULT_SWEEP_CRON
}

@Injectable()
export class TelemetryConditionSweepJob {
  private readonly logger = new Logger(TelemetryConditionSweepJob.name)

  constructor(private readonly conditions: TelemetryConditionService) {}

  /**
   * Deploy é instância única, então não há disputa entre processos pela mesma
   * rodada. Se um dia houver, o desempate é do banco: a varredura trava a
   * sessão antes de decidir, e a abertura da condição tem cláusula de conflito,
   * então varrer o mesmo silêncio duas vezes produz o mesmo estado.
   */
  @Cron(conditionSweepCron(process.env))
  async run(): Promise<void> {
    const startedAt = Date.now()
    try {
      // Um instante só para a rodada inteira, como no ciclo de vida: com dois
      // relógios, duas candidatas da mesma rodada mediriam silêncio contra
      // marcos diferentes.
      const outcome = await this.conditions.sweepSilentSessions(new Date())

      // Só quando houve trabalho. A rodada acontece a cada 30 s e quase sempre
      // não acha ninguém calado: registrar todas encheria o log de nada e
      // esconderia justamente as que importam.
      if (outcome.signalLost > 0 || outcome.recovered > 0) {
        this.logger.log(
          `Varredura de silêncio: ${outcome.scanned} sessões olhadas, ` +
            `${outcome.signalLost} perdas de sinal abertas, ` +
            `${outcome.recovered} condições recuperadas, em ${Date.now() - startedAt} ms`,
        )
      }
    } catch (error) {
      // Melhor esforço, como o ciclo de vida: o job roda sem ninguém olhando, e
      // uma exceção solta viraria rejeição não tratada no processo. O que ficou
      // de fora entra na rodada de daqui a 30 s, e o silêncio não some sozinho.
      this.logger.warn(`Varredura de silêncio falhou: ${(error as Error).message}`)
    }
  }
}
