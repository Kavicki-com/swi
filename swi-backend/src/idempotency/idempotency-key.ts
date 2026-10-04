import { BadRequestException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { isUUID } from 'class-validator'

// Chave de idempotência dos envios do app. O app gera um UUID por envio e o
// repete em cada nova tentativa da fila offline; o servidor usa a chave para
// devolver o registro já criado em vez de criar outro.

/** O que a chave protege. Entra no conteúdo: a mesma chave em outra rota é outro envio. */
export type IdempotencyScope = 'chat.message' | 'report' | 'report.comment'

/**
 * Lê o cabeçalho `Idempotency-Key`. Ausente ou em branco é `undefined`: o
 * envio segue sem proteção, como sempre foi. Presente e fora do formato é 400,
 * para o erro do cliente aparecer em vez de virar envio duplicado.
 *
 * Só UUID v4: o app gera um aleatório por envio. Valor fixo (UUID nulo, o
 * máximo, um v1 de relógio) é gerador quebrado, e aceitá-lo faria o segundo
 * envio igual e legítimo virar reenvio do primeiro em silêncio.
 */
export function parseIdempotencyKey(raw: string | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  if (!isUUID(value, '4')) throw new BadRequestException('Idempotency-Key inválida: use um UUID v4')
  return value.toLowerCase()
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        if (source[key] !== undefined) acc[key] = canonicalize(source[key])
        return acc
      }, {})
  }
  return value
}

/**
 * Impressão do conteúdo do envio. Mesma chave com outra impressão é outro
 * envio usando a chave errada, e o servidor recusa em vez de devolver o
 * registro antigo como se fosse a resposta do novo.
 */
export function requestHash(scope: IdempotencyScope, request: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize({ scope, request }))).digest('hex')
}
