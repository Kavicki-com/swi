import { TelemetryDomainError } from '../domain/telemetry.errors'
import type { TelemetryEvent, TelemetryOrigin } from '../domain/telemetry.types'

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

/** A sessão como a ingestão precisa vê-la: de quem ela é e em que origem corre. */
export interface TelemetrySessionRef {
  id: string
  deviceId: string
  workerId: string
  origin: TelemetryOrigin
}

/**
 * Abertura de sessão. Não há rota para iniciar monitoramento: quem nomeia a
 * sessão é o relógio, e o identificador chega dentro do primeiro evento. Por
 * isso a ingestão abre a sessão ao vê-la pela primeira vez, e o dono dela vem
 * da credencial, nunca do payload.
 *
 * Estende a referência em vez de repetir os campos: abrir e ler a sessão falam
 * das mesmas quatro coisas, e duas listas separadas divergiriam.
 */
export interface OpenSessionInput extends TelemetrySessionRef {
  startedAt: Date
}

/** Dono de uma sessão é o par aparelho e funcionário que a credencial afirma. */
export function sessionBelongsTo(
  session: TelemetrySessionRef,
  device: { deviceId: string; workerId: string },
): boolean {
  return session.deviceId === device.deviceId && session.workerId === device.workerId
}

export interface TelemetryRepository {
  /**
   * Devolve a sessão nomeada pelo aparelho, criando-a se ainda não existir.
   * Nunca sobrescreve dono nem origem de uma sessão já aberta: é o chamador que
   * compara o que voltou com a credencial e decide recusar.
   */
  ensureSession(input: OpenSessionInput): Promise<TelemetrySessionRef>

  /**
   * Grava o evento e, quando ele é o mais recente ao vivo, promove o snapshot
   * do funcionário. "now" é obrigatório, como em todo o domínio: a fronteira
   * entre ao vivo e backlog não pode depender do relógio da máquina.
   */
  saveEvent(event: TelemetryEvent, now: Date): Promise<SaveEventResult>
}

/**
 * Token de injeção da porta. A ingestão depende do contrato, não do adapter do
 * Prisma, e é isso que deixa o spec do serviço rodar sem banco.
 */
export const TELEMETRY_REPOSITORY = Symbol('TelemetryRepository')
