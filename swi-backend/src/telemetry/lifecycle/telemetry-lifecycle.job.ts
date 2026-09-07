import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { TelemetryLifecycleService } from './telemetry-lifecycle.service'

// Agendamento do ciclo de vida, no padrão do alerta de clima. Este arquivo é
// de propósito a camada mais fina do módulo: ele não decide o que resumir nem
// o que apagar. Toda regra mora no serviço, que a suíte chama direto com um
// instante fixo, e é por isso que aqui não há nada além de delegar e registrar.

/**
 * 06:30 UTC, que é 03:30 em Brasília: a rodada acontece na madrugada, quando o
 * banco está ocioso e nenhum turno depende dele.
 *
 * A expressão é interpretada no fuso do processo, e nenhum TZ é fixado em
 * Dockerfile, compose ou CI: o processo herda o do host. O padrão assume UTC;
 * se o host estiver em Brasília, 06:30 continua sendo madrugada. Outro fuso
 * ajusta pela variável, em vez de a gente adivinhar aqui: o horário certo é
 * decisão de operação, não de código.
 */
export const DEFAULT_LIFECYCLE_CRON = '0 30 6 * * *'

/** `||` e não `??`: variável declarada e vazia é ausência, não expressão vazia. */
export function lifecycleCron(env: NodeJS.ProcessEnv): string {
  return env.TELEMETRY_LIFECYCLE_CRON || DEFAULT_LIFECYCLE_CRON
}

@Injectable()
export class TelemetryLifecycleJob {
  private readonly logger = new Logger(TelemetryLifecycleJob.name)

  constructor(private readonly lifecycle: TelemetryLifecycleService) {}

  /**
   * Deploy é instância única, então não há disputa entre processos pela mesma
   * rodada. Se um dia houver, o desempate é do banco: a gravação é upsert pela
   * tripla, e resumir duas vezes o mesmo dia produz a mesma linha.
   */
  @Cron(lifecycleCron(process.env))
  async run(): Promise<void> {
    const startedAt = Date.now()
    try {
      // Um instante só para a rodada inteira: com dois relógios, a retenção
      // mediria a janela contra um instante que a varredura não usou, e a
      // fronteira do dia poderia cair entre as duas etapas.
      const now = new Date()

      // A ordem é fixa e é a garantia central do ciclo de vida: resumir, e só
      // então apagar. Uma exceção na varredura pula a retenção de propósito,
      // porque não se sabe o que foi resumido nesta noite, e apagar sem saber
      // é o único erro daqui que não tem volta.
      const { summarized, failed } = await this.lifecycle.summarizeClosedDays(now)
      const purge = await this.lifecycle.purgeRetainedData(now)

      this.logger.log(
        `Ciclo de vida: ${summarized} dias resumidos, ${failed} falharam, ` +
          `${purge.daysPurged} dias limpos, ${purge.samplesDeleted} leituras e ` +
          `${purge.assessmentsDeleted} avaliações apagadas, ` +
          `${purge.stoppedByBudget ? 'parou no orçamento de tempo' : 'orçamento de tempo folgado'}, ` +
          `em ${Date.now() - startedAt} ms`,
      )
    } catch (error) {
      // Melhor esforço, como o alerta de clima: o job roda sem ninguém olhando,
      // e uma exceção solta viraria rejeição não tratada no processo. O que
      // ficou de fora entra na rodada de amanhã.
      this.logger.warn(`Ciclo de vida falhou: ${(error as Error).message}`)
    }
  }
}
