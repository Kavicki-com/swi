import { BadRequestException } from '@nestjs/common'

/**
 * Códigos estáveis das recusas de pareamento. O app decide a frase por eles,
 * e não pelo texto: uma vírgula corrigida na mensagem não pode mudar o
 * conselho ao funcionário. `message` fica no corpo porque o app de hoje ainda
 * casa por texto, e ele não pode quebrar no intervalo entre esta mudança e a
 * dele.
 *
 * Inválido, de outro funcionário e inexistente são o MESMO código e a mesma
 * mensagem de propósito: sondar identificadores não pode revelar quais
 * existem nem de quem são.
 */
export type EnrollmentRejectionCode =
  | 'ENROLLMENT_INVALID'
  | 'ENROLLMENT_USED'
  | 'ENROLLMENT_EXPIRED'
  | 'ENROLLMENT_UNSUPPORTED_DEVICE'

// O corpo mantém a forma padrão do Nest (statusCode, error, message) e soma
// `code`: superconjunto do que quem lê hoje espera. Com objeto, o Nest devolve
// o objeto tal qual e tira `message` dele para `exception.message`, então os
// testes que leem a mensagem continuam valendo.
export function enrollmentRejection(
  code: EnrollmentRejectionCode,
  message: string,
): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message })
}
