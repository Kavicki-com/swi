import { OperationalAlertStatus } from '@prisma/client'
import { Transform, Type } from 'class-transformer'
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'
import { ALERT_QUEUE_MAX_LIMIT } from '../alert-queue.service'

// Parâmetros da fila de alertas. Query string chega como texto: `status` aceita
// lista separada por vírgula ou repetida (`status=OPEN&status=ACKNOWLEDGED`),
// e o @Type converte o limite antes de validar.

const STATUSES = Object.values(OperationalAlertStatus)

export class AlertQueueQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    (Array.isArray(value) ? value : String(value).split(','))
      .map((s: unknown) => String(s).trim())
      .filter((s: string) => s.length > 0),
  )
  @IsArray()
  @IsIn(STATUSES, { each: true })
  status?: OperationalAlertStatus[]

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(ALERT_QUEUE_MAX_LIMIT) limit?: number

  /** Id do último item da página anterior. */
  @IsOptional() @IsUUID() cursor?: string
}

export class AlertTriageDto {
  /** Registro do que foi feito; só a resolução grava. */
  @IsOptional() @IsString() @MaxLength(500) note?: string
}
