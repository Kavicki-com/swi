import { Inject, Injectable, Logger } from '@nestjs/common'
import { RealtimeGateway } from '../../realtime/realtime.gateway'
import { TelemetryAssessmentService } from '../assessment/assessment.service'
import type { DeviceIdentity } from '../devices/device-auth.service'
import {
  assertEventTimeUsable,
  assertMeasuresSomething,
  isBacklog,
  rejectWorkerIdAuthority,
  validateRawMeasurement,
} from '../domain/metric-state'
import {
  InvalidMeasurementError,
  InvalidTelemetryEventError,
  TelemetryOriginMismatchError,
} from '../domain/telemetry.errors'
import type { TelemetryEvent } from '../domain/telemetry.types'
import {
  TelemetryIntegrityConflictError,
  TelemetrySessionNotFoundError,
  sessionBelongsTo,
  TELEMETRY_REPOSITORY,
  type TelemetryRepository,
  type TelemetrySessionRef,
} from '../persistence/telemetry.repository'
import type { TelemetryBatchDto, TelemetryEventDto } from './dto/telemetry-batch.dto'

// Ingestão do piloto. Um evento entra, é conferido, gravado e só então
// confirmado. A avaliação de esforço e desgaste roda depois do laço, uma vez
// por sessão ao vivo, com corte de 15 s no serviço de avaliação; a gravação do
// evento nunca espera por ela.

/** Motivos estáveis de recusa. O cliente decide o que fazer lendo este código. */
export type TelemetryRejectionReason =
  | 'invalid_event'
  | 'invalid_measurement'
  | 'origin_mismatch'
  | 'event_id_conflict'
  | 'sequence_conflict'
  | 'session_unavailable'

export interface TelemetryRejection {
  eventId: string
  reason: TelemetryRejectionReason
  detail: string
}

export interface TelemetryBatchAck {
  acceptedEventIds: string[]
  duplicateEventIds: string[]
  conflicts: TelemetryRejection[]
  /** ISO-8601. É o relógio contra o qual o cliente mede a própria defasagem. */
  serverTime: string
}

/**
 * Recusa igual para sessão inexistente e sessão de outro aparelho. Distinguir
 * as duas contaria a quem sonda quais identificadores existem, e o cliente
 * legítimo faz a mesma coisa nos dois casos: abrir sessão nova.
 */
const SESSION_UNAVAILABLE = 'Sessão de monitoramento não disponível para este aparelho'

/** O que o socket anuncia: houve mudança, vá reconciliar pelo REST. */
interface PromotedEvent {
  eventId: string
  monitoringSessionId: string
  /**
   * Token de ordem do aviso, opaco para o cliente, que só o usa para descartar
   * revisão anterior à que já aplicou. Hoje é o instante da medição promovida,
   * porque é exatamente por ele que a promoção do snapshot se ordena; a Task 13
   * pode trocá-lo por um contador sem quebrar quem o trata como opaco.
   */
  revision: string
}

/**
 * Todas as recusas aqui são permanentes: reenviar o mesmo evento dá o mesmo
 * resultado. É isso que autoriza o cliente a descartá-lo da fila em vez de
 * tentar para sempre.
 *
 * Erro que não é destes sobe e vira 500. O lote perde o ACK do que já tinha
 * sido gravado, e é de propósito: falha de infraestrutura não é recusa do
 * evento, e transformá-la em 200 faria um banco fora do ar parecer um lote
 * vazio. O reenvio inteiro é barato porque o que já entrou volta como
 * repetição, que é o contrato de idempotência da Task 3.
 */
function rejectionFor(eventId: string, error: unknown): TelemetryRejection {
  if (error instanceof TelemetryIntegrityConflictError) {
    return {
      eventId,
      reason: error.field === 'eventId' ? 'event_id_conflict' : 'sequence_conflict',
      detail: error.message,
    }
  }
  if (error instanceof TelemetrySessionNotFoundError) {
    return { eventId, reason: 'session_unavailable', detail: SESSION_UNAVAILABLE }
  }
  if (error instanceof TelemetryOriginMismatchError) {
    return { eventId, reason: 'origin_mismatch', detail: error.message }
  }
  if (error instanceof InvalidMeasurementError) {
    return { eventId, reason: 'invalid_measurement', detail: error.message }
  }
  if (error instanceof InvalidTelemetryEventError) {
    return { eventId, reason: 'invalid_event', detail: error.message }
  }
  throw error
}

/**
 * Início mais antigo que o lote conhece para cada sessão. Numa recuperação de
 * backlog a fila pode chegar embaralhada, e abrir a sessão com o horário do
 * primeiro evento visto deixaria o início depender da ordem de envio. Horário
 * que não parseia é ignorado aqui: o evento será recusado adiante de qualquer
 * jeito.
 */
function earliestEventTimeBySession(events: readonly TelemetryEventDto[]): Map<string, Date> {
  const earliest = new Map<string, number>()
  for (const { monitoringSessionId, eventTime } of events) {
    const at = Date.parse(eventTime)
    if (Number.isNaN(at)) continue
    const known = earliest.get(monitoringSessionId)
    if (known === undefined || at < known) earliest.set(monitoringSessionId, at)
  }
  return new Map([...earliest].map(([id, at]) => [id, new Date(at)]))
}

function isAtLeastAsRecent(current: PromotedEvent | null, candidate: PromotedEvent): boolean {
  if (current === null) return true
  return Date.parse(candidate.revision) >= Date.parse(current.revision)
}

@Injectable()
export class TelemetryIngestionService {
  private readonly logger = new Logger(TelemetryIngestionService.name)

  constructor(
    @Inject(TELEMETRY_REPOSITORY) private readonly repository: TelemetryRepository,
    private readonly realtime: RealtimeGateway,
    private readonly assessment: TelemetryAssessmentService,
  ) {}

  async ingest(device: DeviceIdentity, batch: TelemetryBatchDto): Promise<TelemetryBatchAck> {
    // Um instante só para o lote inteiro: receivedAt, a fronteira de backlog e
    // o serverTime da resposta têm de contar a mesma história.
    const now = new Date()
    const receivedAt = now.toISOString()

    const acceptedEventIds: string[] = []
    const duplicateEventIds: string[] = []
    const conflicts: TelemetryRejection[] = []
    const sessions = new Map<string, TelemetrySessionRef>()
    const sessionStarts = earliestEventTimeBySession(batch.events)
    const liveTriggers = new Map<string, Date>()
    let promoted: PromotedEvent | null = null

    for (const raw of batch.events) {
      try {
        const event = this.toEvent(device, raw, now, receivedAt)
        // Sempre presente: o evento chegou até aqui, então o eventTime dele
        // parseou e entrou no mapa. O ?? só cobre o tipo do Map.
        const startedAt = sessionStarts.get(event.monitoringSessionId) ?? new Date(event.eventTime)
        await this.requireOwnSession(sessions, device, event, startedAt)

        const result = await this.repository.saveEvent(event, now)
        if (result.outcome === 'DUPLICATE') {
          duplicateEventIds.push(event.eventId)
          continue
        }
        acceptedEventIds.push(event.eventId)

        // Só evento ao vivo dispara avaliação; backlog vai ao histórico sem
        // tocar o atual, e avaliar o passado produziria uma cadeia fora de ordem.
        if (!isBacklog(event.eventTime, now)) {
          const at = new Date(event.eventTime)
          const known = liveTriggers.get(event.monitoringSessionId)
          if (known === undefined || at > known) liveTriggers.set(event.monitoringSessionId, at)
        }

        const candidate: PromotedEvent = {
          eventId: event.eventId,
          monitoringSessionId: event.monitoringSessionId,
          revision: event.eventTime,
        }
        if (result.snapshotPromoted && isAtLeastAsRecent(promoted, candidate)) promoted = candidate
      } catch (error) {
        conflicts.push(rejectionFor(raw.eventId, error))
      }
    }

    // Uma avaliação por sessão e por lote, antes do aviso: o painel busca o
    // estado ao receber o aviso, e ele precisa já incluir a avaliação. O corte
    // de 15 s é do serviço. Falha aqui nunca derruba o ACK: o evento já está
    // gravado, e reenviá-lo só produziria duplicata.
    for (const [sessionId, triggerAt] of liveTriggers) {
      try {
        await this.assessment.assessSession(sessionId, triggerAt, now)
      } catch (error) {
        this.logger.error(`Falha ao avaliar a sessão ${sessionId}: ${(error as Error).message}`)
      }
    }

    // Depois do commit, sempre. Antes, o painel buscaria um estado que ainda
    // não existe e concluiria que nada mudou.
    if (promoted !== null) this.announce(device.workerId, promoted)

    return { acceptedEventIds, duplicateEventIds, conflicts, serverTime: receivedAt }
  }

  /**
   * Traduz o que o aparelho mandou no evento do domínio. Funcionário e aparelho
   * saem da credencial, e receivedAt do relógio do servidor: os três são o que
   * o cliente não tem autoridade para afirmar.
   */
  private toEvent(
    device: DeviceIdentity,
    raw: TelemetryEventDto,
    now: Date,
    receivedAt: string,
  ): TelemetryEvent {
    rejectWorkerIdAuthority(raw)
    assertEventTimeUsable(raw.eventTime, now)

    const measurements = raw.measurements ?? {}
    assertMeasuresSomething(measurements)
    for (const [key, measurement] of Object.entries(measurements)) {
      validateRawMeasurement(key, measurement)
    }

    return {
      eventId: raw.eventId,
      deviceId: device.deviceId,
      monitoringSessionId: raw.monitoringSessionId,
      sequence: raw.sequence,
      eventTime: raw.eventTime,
      receivedAt,
      origin: raw.origin,
      // Já conferidas uma a uma logo acima: chave conhecida, unidade, origem e
      // faixa. O que passa daqui é medição válida, não objeto qualquer.
      measurements,
      journeyId: raw.journeyId ?? null,
      taskId: raw.taskId ?? null,
    }
  }

  /**
   * Abre a sessão nomeada pelo aparelho e confere que ela é dele.
   *
   * Sem esta conferência, um aparelho que acertasse o identificador de sessão
   * de outro gravaria amostras atribuídas ao funcionário daquela sessão: a
   * persistência tira workerId e deviceId da sessão, não de quem chamou.
   *
   * O cache por lote existe para não repetir a consulta a cada evento da mesma
   * sessão, que é o caso normal da recuperação de backlog.
   */
  private async requireOwnSession(
    cache: Map<string, TelemetrySessionRef>,
    device: DeviceIdentity,
    event: TelemetryEvent,
    startedAt: Date,
  ): Promise<void> {
    const known = cache.get(event.monitoringSessionId)
    const session =
      known ??
      (await this.repository.ensureSession({
        id: event.monitoringSessionId,
        deviceId: device.deviceId,
        workerId: device.workerId,
        // A origem é declarada pelo aparelho, e hoje não há de onde derivá-la:
        // TelemetryDevice não guarda se aquele aparelho é real ou de
        // demonstração. O que fica garantido é a decisão congelada, que proíbe
        // MISTURAR origens: a sessão fixa a sua no primeiro evento e a
        // persistência recusa evento de origem diferente. Fechar a brecha exige
        // coluna de origem no dispositivo, o que é migration e sai da Task 5.
        origin: event.origin,
        // O evento mais antigo do lote é o mais perto que se tem do início
        // real. Entre lotes, quem diz o intervalo de fato é a tabela de
        // amostras; isto é uma âncora, não a verdade.
        startedAt,
      }))
    cache.set(session.id, session)

    if (!sessionBelongsTo(session, device)) {
      throw new TelemetrySessionNotFoundError(event.monitoringSessionId)
    }
  }

  /**
   * Aviso, não leitura: só identificadores. O valor vem pelo read model, que é
   * onde mora o controle de acesso; mandá-lo aqui criaria uma segunda fonte da
   * verdade viajando por fora dele.
   */
  private announce(workerId: string, promoted: PromotedEvent): void {
    try {
      this.realtime.emitToUsers([workerId], 'telemetry.snapshot.updated', {
        workerId,
        monitoringSessionId: promoted.monitoringSessionId,
        eventId: promoted.eventId,
        revision: promoted.revision,
      })
    } catch (error) {
      // O evento já está gravado e já foi confirmado. Derrubar a resposta agora
      // faria o cliente reenviar o que está salvo; quando o socket falha, o
      // cliente reconcilia pelo REST.
      this.logger.warn(`Falha ao anunciar telemetria: ${(error as Error).message}`)
    }
  }
}
