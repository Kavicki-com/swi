import { TelemetryDomainError } from '../domain/telemetry.errors'
import type { TelemetryEvent } from '../domain/telemetry.types'

// Porta de persistência da telemetria. A ingestão fala com esta interface, não
// com o Prisma: o contrato de idempotência é o que importa para quem chama, e o
// adapter é que sabe traduzir isso em índice único.

/** STORED foi gravado agora; DUPLICATE já estava gravado com o mesmo conteúdo. */
export type SaveOutcome = 'STORED' | 'DUPLICATE'

export interface SaveEventResult {
  outcome: SaveOutcome
  sampleId: string
  /** true somente quando o evento virou o estado atual do funcionário. */
  snapshotPromoted: boolean
}

/**
 * Mesma base dos erros de domínio: quem traduz para HTTP pega uma família só,
 * e a persistência não precisa de um segundo jeito de ser um Error.
 */
export class TelemetryPersistenceError extends TelemetryDomainError {}

/** Evento apontando para uma sessão de monitoramento que não existe. */
export class TelemetrySessionNotFoundError extends TelemetryPersistenceError {
  constructor(readonly monitoringSessionId: string) {
    super(`Sessão de monitoramento ${monitoringSessionId} não existe`)
  }
}

/**
 * Mesmo identificador com conteúdo diferente, ou sequência já ocupada por outro
 * evento. Nunca é resolvido sobrescrevendo: a amostra é imutável, então o
 * segundo envio é recusado e a divergência fica visível em vez de silenciosa.
 */
export class TelemetryIntegrityConflictError extends TelemetryPersistenceError {
  constructor(
    readonly field: 'eventId' | 'sequence',
    readonly eventId: string,
    reason: string,
  ) {
    super(`Conflito de integridade em ${field} no evento ${eventId}: ${reason}`)
  }
}

export interface TelemetryRepository {
  /**
   * Grava o evento e, quando ele é o mais recente ao vivo, promove o snapshot
   * do funcionário. "now" é obrigatório, como em todo o domínio: a fronteira
   * entre ao vivo e backlog não pode depender do relógio da máquina.
   */
  saveEvent(event: TelemetryEvent, now: Date): Promise<SaveEventResult>
}
