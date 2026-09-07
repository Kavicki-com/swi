import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmpty,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator'
import type { TelemetryOrigin } from '../../domain/telemetry.types'

// Corpo de POST /telemetry/v1/batches. O caminho conectado manda um evento; a
// recuperação de backlog manda vários. É a mesma forma nos dois casos: um
// segundo formato só para o evento único criaria dois contratos para manter.
//
// O que este DTO valida é o envelope. Unidade, origem e faixa de cada medição
// são decisão do domínio (validateRawMeasurement), e repeti-las aqui criaria
// duas listas de validade que podem divergir em silêncio.

/**
 * Teto por requisição. Existe para limitar o tamanho de uma transação e o custo
 * de uma requisição só; o cliente com backlog maior manda em páginas, e a
 * idempotência por eventId torna repetir uma página inofensivo.
 */
export const MAX_BATCH_EVENTS = 200

// Record e não array literal: uma origem nova na união não compila até entrar
// aqui, enquanto uma lista escrita à mão envelheceria em silêncio.
const ORIGIN_VALUES: Record<TelemetryOrigin, true> = { REAL: true, DEMO: true }

export const TELEMETRY_ORIGINS = Object.keys(ORIGIN_VALUES) as TelemetryOrigin[]

export class TelemetryEventDto {
  /**
   * UUID e não string livre: eventId é único no banco inteiro, então dois
   * aparelhos que escolhessem o mesmo identificador se veriam como conflito de
   * integridade um do outro. Com UUID a colisão deixa de ser possível na
   * prática, e a idempotência de reenvio continua sendo do cliente.
   */
  @IsUUID() eventId!: string

  /** Nomeada no relógio, pelo mesmo motivo e com a mesma exigência. */
  @IsUUID() monitoringSessionId!: string

  @IsInt() @Min(0) sequence!: number

  /** Quando o aparelho mediu. O servidor carimba o recebimento por conta. */
  @IsISO8601() eventTime!: string

  @IsIn(TELEMETRY_ORIGINS) origin!: TelemetryOrigin

  // Objeto cru de propósito: as chaves e o conteúdo são conferidos pelo
  // domínio, que é quem sabe o que é uma medição válida. Chave desconhecida
  // vira recusa do evento, nunca descarte silencioso.
  @IsObject() measurements!: Record<string, unknown>

  // Contexto opcional. Jornada e tarefa não controlam o monitoramento, então
  // não podem impedir a telemetria de gravar.
  @IsOptional() @IsString() journeyId?: string | null
  @IsOptional() @IsString() taskId?: string | null

  /**
   * Declarado só para ser recusado. O funcionário sai da credencial do
   * pareamento, e um evento que traz workerId está tentando impor identidade.
   *
   * Precisa estar aqui, com decorador: o ValidationPipe global roda com
   * whitelist e removeria o campo caladamente, e aí o aparelho seguiria
   * mandando um workerId que nunca é lido nem recusado. Com o decorador, o
   * campo sobrevive à limpeza e reprova a validação.
   */
  @IsEmpty({ message: 'workerId não é aceito no evento' }) workerId?: never
}

export class TelemetryBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_EVENTS)
  @ValidateNested({ each: true })
  @Type(() => TelemetryEventDto)
  events!: TelemetryEventDto[]
}
