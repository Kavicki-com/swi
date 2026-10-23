import { AuditAction } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'
import { AUDIT_EVENTS_MAX_LIMIT, ID_MAX_LENGTH } from '../audit.service'

// Filtros da consulta da trilha. A empresa não é filtro: sai sempre do token
// de quem pede. Query string chega como texto, e o @Type converte o limite
// antes de validar.

const ACTIONS = Object.values(AuditAction)

export class AuditEventsQueryDto {
  /** De quem são os dados. */
  @IsOptional() @IsString() @MaxLength(ID_MAX_LENGTH) subjectUserId?: string

  /** Quem agiu. */
  @IsOptional() @IsString() @MaxLength(ID_MAX_LENGTH) actorId?: string

  @IsOptional() @IsIn(ACTIONS) action?: AuditAction

  /** Instante inicial, inclusive (ISO 8601). */
  @IsOptional() @IsISO8601({ strict: true }) from?: string

  /** Instante final, inclusive (ISO 8601). */
  @IsOptional() @IsISO8601({ strict: true }) to?: string

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(AUDIT_EVENTS_MAX_LIMIT) limit?: number

  /** Id do último item da página anterior. */
  @IsOptional() @IsUUID() cursor?: string
}
