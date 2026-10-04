import { BRT_OFFSET_MS } from '../common/brazil-time'

// O dia da jornada é o dia de Brasília. Pelo dia de UTC ele virava às 21h, e
// quem estava em turno ganhava uma jornada ociosa nova: o app lia "idle" e
// desligava o rastreio no meio do turno.

/**
 * Por quanto tempo, contado de quando abriu, uma jornada aberta num dia
 * anterior ainda é a jornada de hoje. Cobre um turno noturno de 12 h com
 * 2 h de folga. O teto não pode subir muito: o turno esquecido aberto não
 * pode prender quem chega para trabalhar na manhã seguinte, porque a janela
 * de rastreio do app (12 h) só reabre quando a jornada encerra, e ele
 * trabalharia sem GPS. Com 14 h, só turno aberto depois das 17h e esquecido
 * ainda aparece no começo da manhã.
 */
export const CARRY_OVER_MAX_MS = 14 * 60 * 60 * 1000

/**
 * O dia de Brasília a que um instante pertence, como data pura em meia-noite
 * UTC, que é como a coluna `Journey.date` guarda o dia.
 */
export function journeyDayOf(instant: Date): Date {
  const local = new Date(instant.getTime() + BRT_OFFSET_MS)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
}

/** Jornada de dia anterior aberta depois deste instante ainda vale. */
export function carryOverSince(now: Date): Date {
  return new Date(now.getTime() - CARRY_OVER_MAX_MS)
}
