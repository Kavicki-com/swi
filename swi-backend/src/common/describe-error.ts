import { Prisma } from '@prisma/client'

// Erro descrito para o log sem o dado que o provocou.
//
// A mensagem de um erro do Prisma repete a chamada que falhou: o erro de
// validação imprime os argumentos inteiros, e o de consulta direta traz o
// texto do banco, que em violação de restrição inclui a linha recusada. Nesta
// API os argumentos são batimento, pressão, posição e alergia, e log é lugar
// onde dado sensível vaza sem ninguém notar. Do Prisma só saem o tipo e o
// código, que bastam para achar a causa; dos outros erros a mensagem segue.

const PRISMA_ERRORS = [
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
]

export function isPrismaError(error: unknown): error is Error {
  return PRISMA_ERRORS.some((type) => error instanceof type)
}

export function describeError(error: unknown): string {
  if (isPrismaError(error)) {
    // `code` no erro conhecido (P2002), `errorCode` no de inicialização (P1001).
    const { code, errorCode } = error as { code?: unknown; errorCode?: unknown }
    const known = typeof code === 'string' ? code : typeof errorCode === 'string' ? errorCode : null
    return known === null ? error.name : `${error.name} ${known}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Só os quadros da pilha. A primeira linha de `stack` é a própria mensagem, e
 * a do Prisma ocupa várias: registrar a pilha crua devolveria ao log o que
 * `describeError` tirou.
 */
export function stackFramesOf(error: Error): string {
  return (error.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .join('\n')
}
