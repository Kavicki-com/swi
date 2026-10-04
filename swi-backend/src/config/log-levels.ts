import type { LogLevel } from '@nestjs/common'
import type { NodeEnv } from './runtime-env'

// Sem esta lista o Nest liga todos os níveis em qualquer ambiente, e as linhas
// de depuração do motor de saúde (uma por sessão avaliada) iriam para o log de
// produção. Depuração fica para desenvolvimento e teste.
const PRODUCTION_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log']
const ALL_LEVELS: LogLevel[] = [...PRODUCTION_LEVELS, 'debug', 'verbose']

export function logLevelsFor(nodeEnv: NodeEnv): LogLevel[] {
  return nodeEnv === 'production' ? PRODUCTION_LEVELS : ALL_LEVELS
}
