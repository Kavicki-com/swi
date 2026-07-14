import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { IsCalendarDate } from '../profile/is-calendar-date'

// Item do checklist. `id` presente só no PATCH (reconciliação: casa com um item
// existente → update; ausente → cria).
export class WorkOrderItemDto {
  // Lido SÓ no PATCH (reconciliação); ignorado no create (item sempre novo).
  @IsOptional() @IsString() id?: string
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string
  @IsOptional() @IsString() @MaxLength(1000) description?: string
}

export class CreateWorkOrderDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title!: string
  @IsOptional() @IsString() @MaxLength(1000) summary?: string
  @IsOptional() @IsString() @MaxLength(8000) details?: string
  @IsOptional() @IsString() @MaxLength(120) sector?: string
  @IsOptional() @IsInt() @Min(1) estimatedMinutes?: number
  @IsOptional() @IsCalendarDate() startDate?: string
  @IsOptional() @IsCalendarDate() dueDate?: string
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @IsString({ each: true }) responsibleIds!: string[]
  // Só keys emitidas pelo presign (prefixo order/): impede referenciar objeto de
  // outro prefixo e trava o formato (paridade com o CreateReportDto).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^order\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true })
  imageKeys?: string[]
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => WorkOrderItemDto)
  items?: WorkOrderItemDto[]
}

// Mesmos campos do create, TODOS opcionais (patch parcial). Escrito à mão de
// propósito (sem @nestjs/mapped-types — não é dependência do projeto).
export class UpdateWorkOrderDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string
  @IsOptional() @IsString() @MaxLength(1000) summary?: string
  @IsOptional() @IsString() @MaxLength(8000) details?: string
  @IsOptional() @IsString() @MaxLength(120) sector?: string
  @IsOptional() @IsInt() @Min(1) estimatedMinutes?: number
  @IsOptional() @IsCalendarDate() startDate?: string
  @IsOptional() @IsCalendarDate() dueDate?: string
  // Opcional, mas se vier NÃO pode esvaziar os responsáveis (ArrayNotEmpty).
  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayMaxSize(50) @IsString({ each: true }) responsibleIds?: string[]
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^order\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true })
  imageKeys?: string[]
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => WorkOrderItemDto)
  items?: WorkOrderItemDto[]
}

export class ListWorkOrdersQueryDto {
  @IsOptional() @IsIn(['pending', 'in_progress', 'done']) status?: string
}
