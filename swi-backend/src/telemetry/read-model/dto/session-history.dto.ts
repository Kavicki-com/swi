import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'
import { HISTORY_MAX_LIMIT } from '../telemetry-query.service'

// Parâmetros de GET /telemetry/v1/sessions/:id/history. Query string chega como
// texto, então o @Type converte antes de validar; sem ele, "limit=10" reprovaria
// no @IsInt e a rota devolveria 400 para um pedido correto.

export class SessionHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(HISTORY_MAX_LIMIT) limit?: number

  /**
   * Cursor de sequência: a página seguinte começa depois desta. A sequência é
   * única dentro da sessão, então ela pagina sem pular nem repetir linha, mesmo
   * que uma amostra atrasada chegue entre dois pedidos.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) afterSequence?: number
}
