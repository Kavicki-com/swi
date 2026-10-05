// Idade da posição de um funcionário, pela hora em que o celular a registrou
// (`recordedAt`). É informação neutra, nunca alarme: o painel não sabe se a
// pessoa está em jornada, e a cor do pino continua sendo a do estado de saúde.
// A conta usa o relógio do computador de quem está olhando.
import { whenLabel } from '@/lib/whenLabel'

/** Posição conta como velha depois de 5 minutos (decisão D1). */
export const STALE_POSITION_MS = 5 * 60_000

/** Intervalo do relógio de tela, para o texto envelhecer sem recarregar. */
export const POSITION_CLOCK_MS = 30_000

export type PositionAge = {
  stale: boolean
  /** "às 14:32" quando é de hoje; "em 03/10 às 14:32" em outro dia. */
  when: string
}

export function positionAge(recordedAt: string | undefined, now: number): PositionAge | null {
  if (!recordedAt) return null
  const when = whenLabel(recordedAt, now)
  if (when === null) return null
  return { stale: now - Date.parse(recordedAt) > STALE_POSITION_MS, when }
}

/** Texto do minimapa do detalhe; null com posição atual ou sem hora. */
export function stalePositionNote(recordedAt: string | undefined, now: number): string | null {
  const age = positionAge(recordedAt, now)
  return age?.stale ? `Última posição ${age.when}` : null
}

/** Texto do pino do mapa geral ao passar o mouse; nada com posição atual. */
export function stalePinTitle(
  name: string,
  recordedAt: string | undefined,
  now: number,
): string | undefined {
  const age = positionAge(recordedAt, now)
  return age?.stale ? `${name}, última posição ${age.when}` : undefined
}
