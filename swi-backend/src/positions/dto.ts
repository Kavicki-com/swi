import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

export class HeartbeatDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number
  @IsNumber() @Min(-180) @Max(180) lng!: number
}

/**
 * Teto de pontos por requisição do reenvio. O app com fila maior manda em
 * páginas, e repetir uma página não duplica nada na trilha.
 */
export const MAX_BATCH_POINTS = 200

export class PositionPointDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number
  @IsNumber() @Min(-180) @Max(180) lng!: number
  /** Quando o aparelho mediu, e não quando conseguiu enviar. */
  @IsISO8601() recordedAt!: string
}

/**
 * Corpo de POST /positions/batch: as posições que o app guardou enquanto não
 * conseguia enviar. O heartbeat segue sendo o caminho da posição de agora.
 */
export class PositionBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_POINTS)
  @ValidateNested({ each: true })
  @Type(() => PositionPointDto)
  points!: PositionPointDto[]
}

/**
 * Janela e origem do mapa de calor. Sem janela, as últimas 24 horas. `all`
 * inclui as posições do simulador e só é aceito quando o servidor liga
 * POSITIONS_HEAT_INCLUDE_SIM, que existe para a homologação.
 */
export class HeatQueryDto {
  @IsOptional() @IsISO8601() from?: string
  @IsOptional() @IsISO8601() to?: string
  @IsOptional() @IsIn(['real', 'all']) source?: 'real' | 'all'
}
