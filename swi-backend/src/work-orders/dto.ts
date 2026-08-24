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

// Anexo que o PATCH aceita DE VOLTA. O array de uma ordem tem duas origens, as
// duas gravadas pelo próprio servidor: `order/` é o que o admin subiu pelo
// painel (presign ADMIN-only) e `task/` é a foto que o funcionário tirou pela
// jornada, que o addTaskPhoto empurra pro pai (JourneyService, Decisão F). O
// form de edição carrega as duas cruas e devolve as duas no PATCH, então
// aceitar só `order/` respondia 400 e deixava os anexos INEDITÁVEIS em toda
// ordem que o funcionário tivesse fotografado.
//
// Continua sendo lista fechada: prefixo de outro domínio (reports/, chat/,
// exams/, avatars/) segue recusado, que é o que impede referenciar objeto
// alheio do bucket.
const ANEXO_ECOADO = /^(order|task)\/[0-9a-f-]{36}\.(jpg|png)$/

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
  //
  // Mais estreito que o do PATCH de propósito: a ordem ainda não existe, logo
  // não existe tarefa, jornada, nem foto de percurso pra ecoar. Aceitar `task/`
  // aqui só abriria caminho pra referenciar a foto de OUTRA ordem.
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
  @Matches(ANEXO_ECOADO, { each: true })
  imageKeys?: string[]
  // Snapshot dos anexos que o form carregou (ver UpdateReportDto.imageKeysBase):
  // preserva a foto que o worker anexou pela jornada depois do load, e só apaga
  // do bucket a remoção provada. Sem ele, substitui como sempre e nada é apagado.
  //
  // Mesmo alfabeto do imageKeys: o base é o espelho do que o form CARREGOU, e o
  // que ele carrega inclui a foto de percurso. Recusá-la aqui travava o mesmo
  // PATCH pelo outro campo.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(ANEXO_ECOADO, { each: true })
  imageKeysBase?: string[]
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => WorkOrderItemDto)
  items?: WorkOrderItemDto[]
}

export class ListWorkOrdersQueryDto {
  @IsOptional() @IsIn(['pending', 'in_progress', 'done']) status?: string
}
