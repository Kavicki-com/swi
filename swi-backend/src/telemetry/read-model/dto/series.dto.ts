import { IsIn } from 'class-validator'
import { SERIES_PERIODS, type SeriesPeriod } from '../telemetry-series'

// Parâmetros de GET /telemetry/v1/me/series e /workers/:id/series. O período é
// obrigatório: um padrão silencioso trocaria o mês pelo dia sem ninguém
// perceber, e o gráfico sempre sabe qual pediu.
export class SeriesQueryDto {
  @IsIn(SERIES_PERIODS) period!: SeriesPeriod
}
