import { BadRequestException, UnprocessableEntityException } from '@nestjs/common'

// Hora em que uma ação da jornada vale.
//
// Sem sinal, o app guarda a ação na fila e envia depois. O tempo trabalhado
// tem de contar da hora do toque, não da hora em que o envio chegou. O app
// manda as duas horas do relógio dele: a do toque (`occurredAt`, no corpo) e
// a do envio (`X-Sent-At`, carimbada a cada tentativa). O servidor usa só a
// diferença entre elas, que é quanto o envio esperou, e desconta da própria
// hora. Relógio errado no aparelho erra as duas horas igual e não muda nada.

/** Espera máxima de uma ação na fila. Acima disso o servidor recusa. */
export const MAX_ACTION_AGE_MS = 72 * 60 * 60 * 1000

// Instante completo: data, hora e fuso. Data solta ou hora sem fuso mudariam
// de valor conforme o fuso de quem lê.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/

function parseInstant(raw: string, name: string): number {
  const value = raw.trim()
  const ms = INSTANT.test(value) ? Date.parse(value) : NaN
  if (Number.isNaN(ms)) throw new BadRequestException(`${name} inválida: use data e hora ISO-8601 com fuso`)
  return ms
}

/**
 * A hora do servidor menos o tempo que o envio esperou no aparelho.
 *
 * Sem `occurredAt` a ação vale agora, como sempre valeu: é o app antigo, ou
 * qualquer cliente que não usa fila. `X-Sent-At` sozinho é ignorado.
 *
 * Toque depois do envio acontece quando o aparelho acerta o relógio ao
 * recuperar o sinal. Vale como agora: recusar descartaria uma ação legítima.
 */
export function effectiveActionTime(
  occurredAt: string | null | undefined,
  rawSentAt: string | undefined,
  serverNowMs: number,
): number {
  if (occurredAt == null) return serverNowMs
  const touched = parseInstant(occurredAt, 'occurredAt')
  if (!rawSentAt?.trim()) throw new BadRequestException('X-Sent-At é obrigatório quando occurredAt é enviado')
  const sent = parseInstant(rawSentAt, 'X-Sent-At')
  const waited = Math.max(0, sent - touched)
  if (waited > MAX_ACTION_AGE_MS) {
    throw new UnprocessableEntityException('Ação feita há mais de 72 horas não é aceita')
  }
  return serverNowMs - waited
}
