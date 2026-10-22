import { IsOptional, IsUUID } from 'class-validator'

export class ConditionHistoryQueryDto {
  /** Id do último item da página anterior. */
  @IsOptional() @IsUUID() cursor?: string
}
