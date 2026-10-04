import { UnprocessableEntityException } from '@nestjs/common'
import { Prisma, type IdempotencyKey, type PrismaClient } from '@prisma/client'
import { requestHash, type IdempotencyScope } from './idempotency-key'

export interface WriteOnceInput<T> {
  userId: string
  /** Já lida por `parseIdempotencyKey`. Ausente: cria como sempre, sem proteção. */
  key: string | undefined
  scope: IdempotencyScope
  /**
   * O conteúdo que define "o mesmo envio", inclusive os parâmetros da rota.
   * Só valores JSON simples (texto, número, lista, objeto literal, null): data
   * ou instância de classe viraria `{}` na impressão.
   *
   * O cliente reenvia EXATAMENTE o mesmo corpo. Foto: sobe uma vez, guarda a
   * chave do arquivo na fila e reusa; subir de novo gera outra chave, outra
   * impressão e 422. E mudar a forma deste objeto (campo novo, outro padrão)
   * muda a impressão das chaves que ainda estão na fila do aparelho, que
   * passam a receber 422 depois do deploy.
   */
  request: unknown
  /** Cria o registro. Com chave, roda dentro da transação que grava a chave. */
  create: (db: Prisma.TransactionClient) => Promise<{ id: string; value: T }>
  /** Relê o registro criado pelo primeiro envio. */
  replay: (resourceId: string) => Promise<T>
}

export interface WriteOnceOutcome<T> {
  value: T
  /**
   * Verdadeiro quando o registro veio do primeiro envio: quem chama não repete
   * socket nem notificação. Consequência aceita: se o processo cair entre a
   * gravação e o aviso, o reenvio não avisa, e o aviso daquele envio se perde
   * (a notificação já era de melhor esforço).
   */
  replayed: boolean
}

/**
 * Cria um registro uma vez só por chave. O registro e a chave são gravados na
 * mesma transação, então não existe registro sem chave (que o reenvio criaria
 * de novo) nem chave sem registro. O reenvio relê o registro em vez de
 * devolver uma resposta guardada, que levaria endereços de imagem vencidos.
 */
export async function writeOnce<T>(prisma: PrismaClient, input: WriteOnceInput<T>): Promise<WriteOnceOutcome<T>> {
  const { userId, key, scope } = input
  if (!key) {
    const { value } = await input.create(prisma)
    return { value, replayed: false }
  }
  const hash = requestHash(scope, input.request)
  const find = () => prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } })

  const known = await find()
  if (known) return { value: await replayKnown(known, input, hash), replayed: true }

  try {
    const { value } = await prisma.$transaction(async (tx) => {
      const created = await input.create(tx)
      await tx.idempotencyKey.create({ data: { userId, key, scope, requestHash: hash, resourceId: created.id } })
      return created
    })
    return { value, replayed: false }
  } catch (error) {
    // Dois envios iguais ao mesmo tempo: o índice único recusa a chave do
    // segundo e a transação desfaz o registro dele. A releitura acha a chave
    // do primeiro. Sem chave na releitura, o P2002 veio de outro índice.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const raced = await find()
    if (!raced) throw error
    return { value: await replayKnown(raced, input, hash), replayed: true }
  }
}

function replayKnown<T>(known: IdempotencyKey, input: WriteOnceInput<T>, hash: string): Promise<T> {
  if (known.scope !== input.scope || known.requestHash !== hash) {
    throw new UnprocessableEntityException('Esta chave de envio já foi usada com outro conteúdo')
  }
  return input.replay(known.resourceId)
}
