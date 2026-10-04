import { randomUUID } from 'node:crypto'
import { UnprocessableEntityException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { requestHash } from './idempotency-key'
import { writeOnce } from './write-once'

const KEY = randomUUID()
const REQUEST = { conversationId: 'a#b', body: 'oi', imageKey: null }

const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })

function fakePrisma() {
  const tx = { idempotencyKey: { create: jest.fn().mockResolvedValue({}) } }
  const prisma = {
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (db: unknown) => unknown) => fn(tx)),
  }
  return { prisma, tx }
}

const known = (over: Record<string, unknown> = {}) => ({
  id: 'k1', userId: 'u1', key: KEY, scope: 'chat.message',
  requestHash: requestHash('chat.message', REQUEST), resourceId: 'm1', createdAt: new Date(), ...over,
})

function write(prisma: unknown, over: Partial<Parameters<typeof writeOnce>[1]> = {}) {
  const create = jest.fn(async () => ({ id: 'm-new', value: 'criado' }))
  const replay = jest.fn(async (id: string) => `relido:${id}`)
  const out = writeOnce(prisma as never, {
    userId: 'u1', key: KEY, scope: 'chat.message', request: REQUEST, create, replay, ...over,
  })
  return { out, create, replay }
}

describe('writeOnce', () => {
  // Sem chave é o caminho de sempre: o painel e o app instalado não mandam
  // cabeçalho, e o envio não pode ganhar transação nem gravação nova.
  it('sem chave cria direto no prisma, sem transação e sem gravar chave', async () => {
    const { prisma, tx } = fakePrisma()
    const { out, create } = write(prisma, { key: undefined })
    await expect(out).resolves.toEqual({ value: 'criado', replayed: false })
    expect(create).toHaveBeenCalledWith(prisma)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled()
    expect(tx.idempotencyKey.create).not.toHaveBeenCalled()
  })

  // Registro e chave na mesma transação: ou existem os dois, ou nenhum. Sem
  // isso, uma queda entre os dois deixaria o registro sem chave e o reenvio o
  // criaria de novo.
  it('chave nova cria o registro e grava a chave na mesma transação', async () => {
    const { prisma, tx } = fakePrisma()
    const { out, create } = write(prisma)
    await expect(out).resolves.toEqual({ value: 'criado', replayed: false })
    expect(create).toHaveBeenCalledWith(tx)
    expect(tx.idempotencyKey.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1', key: KEY, scope: 'chat.message',
        requestHash: requestHash('chat.message', REQUEST), resourceId: 'm-new',
      },
    })
  })

  it('procura a chave pelo par usuário e chave', async () => {
    const { prisma } = fakePrisma()
    await write(prisma).out
    expect(prisma.idempotencyKey.findUnique).toHaveBeenCalledWith({ where: { userId_key: { userId: 'u1', key: KEY } } })
  })

  it('chave conhecida com o mesmo conteúdo relê o registro sem criar', async () => {
    const { prisma } = fakePrisma()
    prisma.idempotencyKey.findUnique.mockResolvedValue(known())
    const { out, create, replay } = write(prisma)
    await expect(out).resolves.toEqual({ value: 'relido:m1', replayed: true })
    expect(replay).toHaveBeenCalledWith('m1')
    expect(create).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  // Devolver o registro antigo como resposta de um conteúdo novo apagaria o
  // envio novo em silêncio.
  it('chave conhecida com outro conteúdo → 422, sem criar', async () => {
    const { prisma } = fakePrisma()
    prisma.idempotencyKey.findUnique.mockResolvedValue(known())
    const { out, create, replay } = write(prisma, { request: { ...REQUEST, body: 'outro' } })
    await expect(out).rejects.toThrow(UnprocessableEntityException)
    expect(create).not.toHaveBeenCalled()
    expect(replay).not.toHaveBeenCalled()
  })

  it('chave conhecida de outro escopo → 422, sem criar', async () => {
    const { prisma } = fakePrisma()
    prisma.idempotencyKey.findUnique.mockResolvedValue(known({ scope: 'report' }))
    const { out, create } = write(prisma)
    await expect(out).rejects.toThrow(UnprocessableEntityException)
    expect(create).not.toHaveBeenCalled()
  })

  // Dois envios iguais ao mesmo tempo: os dois passam pela leitura sem achar a
  // chave, o segundo esbarra no índice único e a transação dele desfaz o
  // registro que criou. Ele então relê e devolve o do primeiro.
  it('corrida: índice único recusa a chave, a releitura acha e devolve o registro do outro', async () => {
    const { prisma } = fakePrisma()
    prisma.idempotencyKey.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(known({ resourceId: 'm-outro' }))
    prisma.$transaction.mockRejectedValueOnce(p2002())
    const { out, replay } = write(prisma)
    await expect(out).resolves.toEqual({ value: 'relido:m-outro', replayed: true })
    expect(replay).toHaveBeenCalledWith('m-outro')
  })

  it('corrida com outro conteúdo → 422', async () => {
    const { prisma } = fakePrisma()
    prisma.idempotencyKey.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(known())
    prisma.$transaction.mockRejectedValueOnce(p2002())
    const { out } = write(prisma, { request: { ...REQUEST, body: 'outro' } })
    await expect(out).rejects.toThrow(UnprocessableEntityException)
  })

  // P2002 que não é da chave (outro índice único dentro do create): engolir
  // viraria 500 mais adiante ou resposta errada.
  it('P2002 sem chave na releitura relança o erro original', async () => {
    const { prisma } = fakePrisma()
    const err = p2002()
    prisma.$transaction.mockRejectedValueOnce(err)
    const { out } = write(prisma)
    await expect(out).rejects.toBe(err)
  })

  it('erro qualquer no create propaga sem reler', async () => {
    const { prisma } = fakePrisma()
    const err = new Error('banco caiu')
    prisma.$transaction.mockRejectedValueOnce(err)
    const { out } = write(prisma)
    await expect(out).rejects.toBe(err)
    expect(prisma.idempotencyKey.findUnique).toHaveBeenCalledTimes(1)
  })
})
