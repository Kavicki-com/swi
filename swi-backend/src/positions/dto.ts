import { IsIn, IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator'

export class HeartbeatDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number
  @IsNumber() @Min(-180) @Max(180) lng!: number
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
