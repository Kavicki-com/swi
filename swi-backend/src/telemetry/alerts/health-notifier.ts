import { Injectable, Logger } from '@nestjs/common'
import type { TelemetryConditionKind } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationService, type NotificationPayload } from '../../notifications/notification.service'
import { TelemetryAudienceService } from '../realtime/telemetry-audience.service'
import type { ConditionChange } from './condition.service'

/** O que a notificação precisa saber da condição que abriu. */
export interface OpenedConditionFacts {
  kind: TelemetryConditionKind
  observedValue: number | null
  thresholdValue: number | null
}

/** Uma mensagem para cada público; null quando aquele público não recebe. */
export interface HealthNotifications {
  worker: NotificationPayload | null
  admins: NotificationPayload | null
}

const health = (title: string, body: string): NotificationPayload => ({ domain: 'health', title, body })

const round = (value: number | null) => (value === null ? null : Math.round(value))

/**
 * Quem recebe cada condição e com que texto. Batimento, desgaste e pressão vão
 * ao funcionário e à administração. Bateria fraca vai só ao funcionário, que é
 * quem está com o relógio. Perda de sinal vai só à administração: sem sinal, o
 * aparelho do funcionário provavelmente nem recebe, e quem precisa saber que
 * alguém saiu do monitoramento é quem acompanha a equipe.
 *
 * O texto carrega só o que a condição gravou, nunca um valor de outra fonte;
 * a pressão não repete o valor porque a condição guarda um número só de um par.
 */
export function healthNotificationsFor(condition: OpenedConditionFacts, workerName: string): HealthNotifications {
  const observed = round(condition.observedValue)
  const threshold = round(condition.thresholdValue)
  switch (condition.kind) {
    case 'HEART_RATE_HIGH':
    case 'HEART_RATE_LOW': {
      const high = condition.kind === 'HEART_RATE_HIGH'
      const reading =
        observed === null
          ? null
          : threshold === null
            ? `${observed} bpm`
            : `${observed} bpm, ${high ? 'acima' : 'abaixo'} do limite de ${threshold} bpm`
      return {
        worker: health(
          `Batimento ${high ? 'acima' : 'abaixo'} do limite`,
          reading === null ? 'Seu batimento saiu da faixa esperada.' : `Seu batimento chegou a ${reading}.`,
        ),
        admins: health(
          `Batimento ${high ? 'alto' : 'baixo'}: ${workerName}`,
          reading === null ? 'O batimento saiu da faixa esperada.' : `${reading}.`,
        ),
      }
    }
    case 'WEAR_HIGH': {
      const estimate = observed === null ? null : `Desgaste estimado em ${observed}%.`
      return {
        worker: health('Desgaste alto', estimate === null ? 'Considere uma pausa.' : `${estimate} Considere uma pausa.`),
        admins: health(`Desgaste alto: ${workerName}`, estimate ?? 'O desgaste estimado passou do limite.'),
      }
    }
    case 'BLOOD_PRESSURE_REVIEW':
      return {
        worker: health('Pressão para revisar', 'A última medição de pressão pede revisão.'),
        admins: health(`Pressão para revisar: ${workerName}`, 'A última medição de pressão pede revisão.'),
      }
    case 'DEVICE_BATTERY_LOW':
      return {
        worker: health(
          'Bateria do relógio baixa',
          observed === null
            ? 'Carregue o relógio para seguir monitorado.'
            : `Bateria em ${observed}%. Carregue o relógio para seguir monitorado.`,
        ),
        admins: null,
      }
    case 'DEVICE_SIGNAL_LOST':
      return {
        worker: null,
        admins: health(`Sem sinal do relógio: ${workerName}`, 'O monitoramento parou de receber dados.'),
      }
  }
}

interface OpenedConditionRow extends OpenedConditionFacts {
  id: string
  workerId: string
  origin: string
  worker: { name: string }
}

/**
 * Transforma condição aberta em notificação do feed, depois do commit. Só
 * abertura notifica: recuperação mantém o feed quieto, e o estado atual segue
 * visível na leitura e na fila de alertas. Só origem real notifica, porque
 * demonstração nunca vira aviso para pessoa nenhuma.
 *
 * Nunca levanta: a condição já está gravada, e falhar aqui não pode desfazer a
 * escrita nem esconder o resultado de quem avaliou.
 */
@Injectable()
export class TelemetryHealthNotifier {
  private readonly logger = new Logger(TelemetryHealthNotifier.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly audience: TelemetryAudienceService,
  ) {}

  async notifyOpened(changes: readonly ConditionChange[]): Promise<void> {
    const opened = changes.filter((change) => change.change === 'OPENED')
    if (opened.length === 0) return

    let rows: OpenedConditionRow[]
    let alreadyNotified: Set<string>
    try {
      const ids = opened.map((change) => change.conditionId)
      rows = await this.prisma.telemetryCondition.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          workerId: true,
          origin: true,
          kind: true,
          observedValue: true,
          thresholdValue: true,
          worker: { select: { name: true } },
        },
      })
      // A condição é o alvo da notificação, então a mesma abertura nunca vira
      // duas: um reenvio encontra o que já foi notificado e para.
      const notified = await this.prisma.notification.findMany({
        where: { domain: 'health', targetId: { in: ids } },
        select: { targetId: true },
      })
      alreadyNotified = new Set(notified.map((n) => n.targetId).filter((id): id is string => id !== null))
    } catch (error) {
      this.logger.warn(`Falha ao preparar notificação de saúde: ${(error as Error).message}`)
      return
    }

    for (const row of rows) {
      if (row.origin !== 'REAL' || alreadyNotified.has(row.id)) continue
      try {
        await this.notifyOne(row)
      } catch (error) {
        this.logger.warn(`Falha ao notificar a condição ${row.id}: ${(error as Error).message}`)
      }
    }
  }

  private async notifyOne(row: OpenedConditionRow): Promise<void> {
    const messages = healthNotificationsFor(row, row.worker.name)
    if (messages.worker) {
      await this.notifications.enqueueForMany([row.workerId], { ...messages.worker, targetId: row.id })
    }
    if (messages.admins) {
      const recipients = await this.audience.recipientsFor(row.workerId)
      const admins = recipients.filter((id) => id !== row.workerId)
      if (admins.length > 0) {
        await this.notifications.enqueueForMany(admins, { ...messages.admins, targetId: row.id })
      }
    }
  }
}
