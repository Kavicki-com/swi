import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { writeOnce } from '../src/idempotency/write-once'

// Fila offline do app: o mesmo envio pode chegar mais de uma vez (o primeiro
// passou, mas a resposta se perdeu no caminho). Com `Idempotency-Key`, o
// reenvio devolve o registro do primeiro, sem duplicar nem avisar de novo.
// Aqui contra o banco de verdade: a transação, o índice único e a corrida só
// se provam no Postgres.

describe('Idempotência dos envios do app (e2e)', () => {
  let app: INestApplication, prisma: PrismaService
  const eA = 'idem-a@ex.com', eB = 'idem-b@ex.com'
  let idA = '', idB = '', convId = ''
  let authA: Record<string, string> = {}, authB: Record<string, string> = {}
  const cpath = (id: string) => `/chat/conversations/${encodeURIComponent(id)}` // ids têm '#'
  const http = () => request(app.getHttpServer())

  const login = async (email: string) => {
    const { body } = await http().post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }

  // Apaga o que os dois usuários deixaram: as chaves saem em cascata com eles.
  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: [eA, eB] } } })
    const ids = users.map((u) => u.id)
    if (ids.length) {
      await prisma.notification.deleteMany({ where: { workerId: { in: ids } } })
      // "Novo relatório" vai para todo funcionário sem empresa, não só para B.
      const reports = await prisma.report.findMany({ where: { authorId: { in: ids } }, select: { id: true } })
      if (reports.length) await prisma.notification.deleteMany({ where: { targetId: { in: reports.map((r) => r.id) } } })
      await prisma.comment.deleteMany({ where: { OR: [{ authorId: { in: ids } }, { report: { authorId: { in: ids } } }] } })
      await prisma.report.deleteMany({ where: { authorId: { in: ids } } })
      const convs = await prisma.conversation.findMany({ where: { participants: { hasSome: ids } } })
      const convIds = convs.map((c) => c.id)
      if (convIds.length) await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } })
      await prisma.message.deleteMany({ where: { senderId: { in: ids } } })
      if (convIds.length) await prisma.conversation.deleteMany({ where: { id: { in: convIds } } })
    }
    await prisma.user.deleteMany({ where: { email: { in: [eA, eB] } } })
  }

  const resetConversation = async () => {
    await prisma.message.deleteMany({ where: { conversationId: convId } })
    await prisma.notification.deleteMany({ where: { workerId: { in: [idA, idB] } } })
    await prisma.conversation.deleteMany({ where: { id: convId } })
  }

  const unreadOfB = async () => {
    const conv = await prisma.conversation.findUnique({ where: { id: convId } })
    return ((conv?.unreadByJson ?? {}) as Record<string, number>)[idB] ?? 0
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    const mk = async (email: string, name: string) =>
      (await prisma.user.create({
        data: { email, name, passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },
      })).id
    idA = await mk(eA, 'Idem A')
    idB = await mk(eB, 'Idem B')
    convId = [idA, idB].sort().join('#')
    authA = await login(eA)
    authB = await login(eB)
  })
  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  describe('mensagem do chat', () => {
    beforeEach(resetConversation)

    it('mesma chave duas vezes: 201 nas duas, a mesma mensagem, contador em 1 e uma notificação', async () => {
      const key = randomUUID()
      const send = () => http().post(`${cpath(convId)}/messages`).set({ ...authA, 'Idempotency-Key': key }).send({ body: 'sem sinal' })
      const first = await send().expect(201)
      const second = await send().expect(201)
      expect(second.body.id).toBe(first.body.id)
      expect(await prisma.message.count({ where: { conversationId: convId } })).toBe(1)
      expect(await unreadOfB()).toBe(1)
      expect(await prisma.notification.count({ where: { workerId: idB, domain: 'chat', targetId: convId } })).toBe(1)
    })

    // Dois reenvios ao mesmo tempo (o app voltou do segundo plano no meio de
    // uma tentativa). O índice único decide, e o perdedor devolve a do outro.
    it('mesma chave em paralelo: uma mensagem só', async () => {
      const key = randomUUID()
      const send = () => http().post(`${cpath(convId)}/messages`).set({ ...authA, 'Idempotency-Key': key }).send({ body: 'corrida' })
      const [r1, r2] = await Promise.all([send(), send()])
      expect([r1.status, r2.status]).toEqual([201, 201])
      expect(r2.body.id).toBe(r1.body.id)
      expect(await prisma.message.count({ where: { conversationId: convId } })).toBe(1)
      expect(await unreadOfB()).toBe(1)
    })

    it('mesma chave com outro texto → 422 e nada novo', async () => {
      const key = randomUUID()
      await http().post(`${cpath(convId)}/messages`).set({ ...authA, 'Idempotency-Key': key }).send({ body: 'um' }).expect(201)
      await http().post(`${cpath(convId)}/messages`).set({ ...authA, 'Idempotency-Key': key }).send({ body: 'dois' }).expect(422)
      expect(await prisma.message.count({ where: { conversationId: convId } })).toBe(1)
    })

    it('chave fora do formato → 400 e nada criado', async () => {
      await http().post(`${cpath(convId)}/messages`).set({ ...authA, 'Idempotency-Key': 'nao-e-uuid' }).send({ body: 'x' }).expect(400)
      expect(await prisma.message.count({ where: { conversationId: convId } })).toBe(0)
    })

    // O painel e o app instalado não mandam chave: nada pode mudar para eles.
    it('sem chave, dois envios iguais continuam sendo duas mensagens', async () => {
      await http().post(`${cpath(convId)}/messages`).set(authA).send({ body: 'igual' }).expect(201)
      await http().post(`${cpath(convId)}/messages`).set(authA).send({ body: 'igual' }).expect(201)
      expect(await prisma.message.count({ where: { conversationId: convId } })).toBe(2)
    })

    // A chave vale por usuário: o UUID é gerado em cada aparelho, e um não
    // pode ler nem bloquear o envio do outro.
    it('a mesma chave usada por outro usuário cria a mensagem dele', async () => {
      const key = randomUUID()
      const a = await http().post(`${cpath(convId)}/messages`).set({ ...authA, 'Idempotency-Key': key }).send({ body: 'oi' }).expect(201)
      const b = await http().post(`${cpath(convId)}/messages`).set({ ...authB, 'Idempotency-Key': key }).send({ body: 'oi' }).expect(201)
      expect(b.body.id).not.toBe(a.body.id)
      expect(b.body.senderId).toBe(idB)
      expect(await prisma.message.count({ where: { conversationId: convId } })).toBe(2)
    })
  })

  describe('relatório e comentário', () => {
    it('relatório com a mesma chave duas vezes: um registro e o colega avisado uma vez', async () => {
      const key = randomUUID()
      const send = () => http().post('/reports').set({ ...authA, 'Idempotency-Key': key }).send({ title: 'Vazamento no setor 3', summary: 'Óleo no piso' })
      const first = await send().expect(201)
      const second = await send().expect(201)
      expect(second.body.id).toBe(first.body.id)
      expect(await prisma.report.count({ where: { authorId: idA, title: 'Vazamento no setor 3' } })).toBe(1)
      expect(await prisma.notification.count({ where: { workerId: idB, domain: 'reports', targetId: first.body.id } })).toBe(1)
    })

    it('relatório com a mesma chave e outro conteúdo → 422', async () => {
      const key = randomUUID()
      await http().post('/reports').set({ ...authA, 'Idempotency-Key': key }).send({ title: 'Primeiro' }).expect(201)
      await http().post('/reports').set({ ...authA, 'Idempotency-Key': key }).send({ title: 'Segundo' }).expect(422)
      expect(await prisma.report.count({ where: { authorId: idA, title: 'Segundo' } })).toBe(0)
    })

    it('comentário com a mesma chave duas vezes: um registro', async () => {
      const { body: report } = await http().post('/reports').set(authA).send({ title: 'Para comentar' }).expect(201)
      const key = randomUUID()
      const send = () => http().post(`/reports/${report.id}/comments`).set({ ...authB, 'Idempotency-Key': key }).send({ body: 'Visto' })
      const first = await send().expect(201)
      const second = await send().expect(201)
      expect(second.body.id).toBe(first.body.id)
      expect(await prisma.comment.count({ where: { reportId: report.id } })).toBe(1)
    })

    // A corrida pelas rotas pode acontecer em sequência e passar sem provar
    // nada. Aqui as duas transações ficam abertas ao mesmo tempo, as duas já
    // com o registro criado: só o índice único decide, e a perdedora tem de
    // desfazer o dela e devolver o da outra.
    it('corrida forçada no Postgres: duas transações abertas com a mesma chave deixam um registro só', async () => {
      const key = randomUUID()
      const title = `Corrida ${key}`
      let arrived = 0
      let release!: () => void
      const bothInside = new Promise<void>((resolve) => { release = resolve })
      const run = () => writeOnce(prisma, {
        userId: idA, key, scope: 'report', request: { title },
        create: async (db) => {
          arrived += 1
          if (arrived === 2) release()
          await bothInside
          const created = await db.report.create({ data: { authorId: idA, title } })
          return { id: created.id, value: created.id }
        },
        replay: async (id) => id,
      })
      const [a, b] = await Promise.all([run(), run()])
      expect(arrived).toBe(2)
      expect(b.value).toBe(a.value)
      expect([a.replayed, b.replayed].sort()).toEqual([false, true])
      expect(await prisma.report.count({ where: { title } })).toBe(1)
      expect(await prisma.idempotencyKey.count({ where: { userId: idA, key } })).toBe(1)
    })

    // A mesma chave em rotas diferentes é outro envio usando a chave errada.
    it('chave de um relatório reaproveitada num comentário → 422', async () => {
      const key = randomUUID()
      const { body: report } = await http().post('/reports').set({ ...authA, 'Idempotency-Key': key }).send({ title: 'Chave reaproveitada' }).expect(201)
      await http().post(`/reports/${report.id}/comments`).set({ ...authA, 'Idempotency-Key': key }).send({ body: 'x' }).expect(422)
      expect(await prisma.comment.count({ where: { reportId: report.id } })).toBe(0)
    })
  })
})
