import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { journeyDayOf } from '../src/journey/journey-day'

// Jornada vinda da fila offline do app. Sem sinal, a ação fica guardada no
// aparelho e chega depois, às vezes mais de uma vez. Ela tem de valer na hora
// do toque e uma vez só. Contra o banco de verdade: a escolha da jornada pelo
// dia, a transação da chave e a condição da foto só se provam no Postgres.

describe('Jornada offline (e2e)', () => {
  let app: INestApplication, prisma: PrismaService
  const eA = 'jornada-off-a@ex.com'
  let aId = ''
  let auth: Record<string, string> = {}
  let itemId = '', orderId = ''
  const http = () => request(app.getHttpServer())
  const MIN = 60_000, HOUR = 60 * MIN

  /** Cabeçalhos e corpo de uma ação tocada `waitedMs` antes de sair do aparelho. */
  const queued = (waitedMs: number, key: string = randomUUID()) => {
    const sent = Date.now()
    return {
      headers: { ...auth, 'Idempotency-Key': key, 'X-Sent-At': new Date(sent).toISOString() },
      body: { occurredAt: new Date(sent - waitedMs).toISOString() },
    }
  }
  const post = (path: string, q: ReturnType<typeof queued>) => http().post(path).set(q.headers).send(q.body)

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: eA }, select: { id: true } })
    const ids = users.map((u) => u.id)
    if (ids.length) {
      await prisma.notification.deleteMany({ where: { workerId: { in: ids } } })
      await prisma.workOrder.deleteMany({ where: { authorId: { in: ids } } })
      await prisma.journey.deleteMany({ where: { workerId: { in: ids } } })
    }
    await prisma.user.deleteMany({ where: { email: eA } }) // as chaves de envio saem em cascata
  }

  // Cada teste parte do zero: sem jornada, sem chave e com a tarefa parada.
  const reset = async () => {
    await prisma.idempotencyKey.deleteMany({ where: { userId: aId } })
    await prisma.journey.deleteMany({ where: { workerId: aId } })
    await prisma.task.update({ where: { id: itemId }, data: { status: 'pending', startedAt: null, accumulatedSeconds: 0, progressPct: 0 } })
    await prisma.workOrder.update({ where: { id: orderId }, data: { status: 'pending', imageKeys: [] } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    aId = (await prisma.user.create({
      data: { email: eA, name: 'Jornada Offline', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },
    })).id
    const order = await prisma.workOrder.create({
      data: {
        authorId: aId, title: 'Ordem da fila', summary: 'objetivo',
        responsibles: { connect: [{ id: aId }] },
        items: { create: [{ title: 'Item', position: 0, estimatedMinutes: 600 }] },
      },
      include: { items: true },
    })
    orderId = order.id
    itemId = order.items[0].id
    const { body } = await http().post('/auth/login').send({ email: eA, password: 'test1234' }).expect(200)
    auth = { Authorization: `Bearer ${body.accessToken}` }
  })
  beforeEach(reset)
  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  describe('hora do toque', () => {
    it('iniciar e pausar feitos sem sinal, enviados juntos, contam o tempo entre os toques', async () => {
      await post(`/journey/tasks/${itemId}/start`, queued(60 * MIN)).expect(201)
      const { body: paused } = await post('/journey/pause', queued(30 * MIN)).expect(201)

      // 30 min entre os toques. A folga cobre o tempo entre as duas chamadas.
      expect(paused.state).toBe('paused')
      expect(paused.accumulatedSeconds).toBeGreaterThanOrEqual(30 * 60)
      expect(paused.accumulatedSeconds).toBeLessThan(30 * 60 + 10)
      const task = await prisma.task.findUniqueOrThrow({ where: { id: itemId } })
      expect(task.status).toBe('paused')
      expect(task.accumulatedSeconds).toBeGreaterThanOrEqual(30 * 60)
      expect(task.accumulatedSeconds).toBeLessThan(30 * 60 + 10)
    })

    it('iniciar grava a hora do toque como começo da tarefa e do turno', async () => {
      const before = Date.now()
      const { body } = await post(`/journey/tasks/${itemId}/start`, queued(45 * MIN)).expect(201)
      const startedAt = Date.parse(body.task.startedAt)
      expect(startedAt).toBeGreaterThanOrEqual(before - 45 * MIN - 1000)
      expect(startedAt).toBeLessThan(Date.now() - 45 * MIN + 1000)
      expect(body.journey.startedAt).toBe(body.task.startedAt)
    })

    // O caso que motivou a hora do toque: turno de ontem que ficou aberto
    // porque o "encerrar" não tinha sinal para sair.
    it('encerrar tocado ontem e enviado hoje fecha a jornada de ontem e para a tarefa na hora do toque', async () => {
      const yesterday = new Date(journeyDayOf(new Date()).getTime() - 24 * HOUR)
      const opened = new Date(yesterday.getTime() + 11 * HOUR) // 08h de Brasília, ontem
      const touchedAt = yesterday.getTime() + 20 * HOUR // 17h de Brasília, ontem
      const old = await prisma.journey.create({
        data: { workerId: aId, date: yesterday, state: 'ongoing', activeTaskId: itemId, startedAt: opened, openedAt: opened },
      })
      await prisma.task.update({ where: { id: itemId }, data: { status: 'in_progress', startedAt: opened } })

      // Aberta há mais de 14 h: para quem lê agora, a jornada é a ociosa de hoje.
      const { body: today } = await http().get('/journey').set(auth).expect(200)
      expect(today.state).toBe('idle')

      const sent = Date.now()
      await http().post('/journey/end')
        .set({ ...auth, 'Idempotency-Key': randomUUID(), 'X-Sent-At': new Date(sent).toISOString() })
        .send({ occurredAt: new Date(touchedAt).toISOString() })
        .expect(201)

      const closed = await prisma.journey.findUniqueOrThrow({ where: { id: old.id } })
      expect(closed.state).toBe('idle')
      expect(closed.openedAt).toBeNull()
      expect(closed.activeTaskId).toBeNull()
      const task = await prisma.task.findUniqueOrThrow({ where: { id: itemId } })
      expect(task.status).toBe('paused')
      expect(task.accumulatedSeconds).toBeGreaterThanOrEqual(9 * 3600) // das 08h às 17h
      expect(task.accumulatedSeconds).toBeLessThan(9 * 3600 + 10)
    })

    // Turno noturno: aberto há 15 h, já fora do prazo para quem lê agora, mas
    // dentro dele na hora do toque (há 2 h). A pausa tem de cair nesse turno.
    it('pausar tocado quando o turno de ontem ainda valia cai nesse turno', async () => {
      const touchDay = journeyDayOf(new Date(Date.now() - 2 * HOUR))
      const opened = new Date(Date.now() - 15 * HOUR)
      const old = await prisma.journey.create({
        data: { workerId: aId, date: new Date(touchDay.getTime() - 24 * HOUR), state: 'ongoing', startedAt: opened, openedAt: opened },
      })
      const { body: today } = await http().get('/journey').set(auth).expect(200)
      expect(today.state).toBe('idle') // pela hora de agora o turno já não volta

      await post('/journey/pause', queued(2 * HOUR)).expect(201)

      const paused = await prisma.journey.findUniqueOrThrow({ where: { id: old.id } })
      expect(paused.state).toBe('paused')
      expect(paused.accumulatedSeconds).toBeGreaterThanOrEqual(13 * 3600) // das 15 h atrás até o toque
      expect(paused.accumulatedSeconds).toBeLessThan(13 * 3600 + 10)
    })

    it('hora do toque nula no corpo é o mesmo que ausente', async () => {
      const { body } = await http().post(`/journey/tasks/${itemId}/start`).set(auth).send({ occurredAt: null }).expect(201)
      expect(Date.now() - Date.parse(body.task.startedAt)).toBeLessThan(5000)
    })

    it('sem a hora do toque, o mesmo encerrar cai na jornada de hoje e a de ontem fica aberta', async () => {
      const yesterday = new Date(journeyDayOf(new Date()).getTime() - 24 * HOUR)
      const opened = new Date(yesterday.getTime() + 11 * HOUR)
      const old = await prisma.journey.create({
        data: { workerId: aId, date: yesterday, state: 'ongoing', startedAt: opened, openedAt: opened },
      })
      await http().post('/journey/end').set(auth).expect(201)
      expect((await prisma.journey.findUniqueOrThrow({ where: { id: old.id } })).state).toBe('ongoing')
    })

    it('ação tocada há mais de 72 h → 422, e nada muda', async () => {
      await post(`/journey/tasks/${itemId}/start`, queued(72 * HOUR + MIN)).expect(422)
      expect((await prisma.task.findUniqueOrThrow({ where: { id: itemId } })).status).toBe('pending')
      expect(await prisma.idempotencyKey.count({ where: { userId: aId } })).toBe(0)
    })

    it('hora do toque sem X-Sent-At → 400', async () => {
      await http().post('/journey/pause').set(auth).send({ occurredAt: new Date().toISOString() }).expect(400)
    })

    it('hora do toque ou do envio fora do formato → 400', async () => {
      const sentAt = new Date().toISOString()
      await http().post('/journey/pause').set({ ...auth, 'X-Sent-At': sentAt }).send({ occurredAt: 'ontem' }).expect(400)
      await http().post('/journey/pause').set({ ...auth, 'X-Sent-At': sentAt }).send({ occurredAt: 1759586400000 }).expect(400)
      await http().post('/journey/pause').set({ ...auth, 'X-Sent-At': 'agora' }).send({ occurredAt: sentAt }).expect(400)
    })

    it('X-Sent-At sozinho é ignorado: a ação vale agora', async () => {
      const { body } = await http().post(`/journey/tasks/${itemId}/start`)
        .set({ ...auth, 'X-Sent-At': new Date(Date.now() - 5 * HOUR).toISOString() })
        .expect(201)
      expect(Date.now() - Date.parse(body.task.startedAt)).toBeLessThan(5000)
    })
  })

  describe('envio repetido', () => {
    // Entre o envio e o reenvio entra outra ação: se o reenvio reaplicasse o
    // "iniciar", a tarefa cancelada voltaria a correr.
    it('iniciar, cancelar e reenviar o iniciar não põe a tarefa para correr de novo', async () => {
      const start = queued(60 * MIN)
      await post(`/journey/tasks/${itemId}/start`, start).expect(201)
      await post(`/journey/tasks/${itemId}/cancel`, queued(30 * MIN)).expect(201)
      // A segunda tentativa sai mais tarde: só a hora do envio muda.
      const again = { ...start, headers: { ...start.headers, 'X-Sent-At': new Date(Date.now() + 5 * MIN).toISOString() } }
      const { body } = await post(`/journey/tasks/${itemId}/start`, again).expect(201)

      expect(body.task.status).toBe('pending')
      expect(body.journey.activeTaskId).toBeNull()
      const task = await prisma.task.findUniqueOrThrow({ where: { id: itemId } })
      expect(task.status).toBe('pending')
      expect(task.startedAt).toBeNull()
      expect(await prisma.idempotencyKey.count({ where: { userId: aId, scope: 'journey.task.start' } })).toBe(1)
    })

    // Sem a chave, o "encerrar" repetido fecharia o turno que começou depois dele.
    it('encerrar, iniciar e reenviar o encerrar não fecha o turno novo', async () => {
      await post(`/journey/tasks/${itemId}/start`, queued(3 * HOUR)).expect(201)
      const end = queued(2 * HOUR)
      await post('/journey/end', end).expect(201)
      await post(`/journey/tasks/${itemId}/start`, queued(1 * HOUR)).expect(201)

      const { body: replayed } = await post('/journey/end', end).expect(201)
      expect(replayed.state).toBe('ongoing') // o estado de agora, não o de quando encerrou
      const { body: now } = await http().get('/journey').set(auth).expect(200)
      expect(now.state).toBe('ongoing')
      expect(now.activeTaskId).toBe(itemId)
    })

    // Se o reenvio reaplicasse a pausa, o turno retomado pararia de novo e o
    // tempo entre a retomada e o reenvio entraria na conta.
    it('pausar, retomar e reenviar o pausar não pausa de novo', async () => {
      await post(`/journey/tasks/${itemId}/start`, queued(60 * MIN)).expect(201)
      const pause = queued(30 * MIN)
      const { body: first } = await post('/journey/pause', pause).expect(201)
      await post('/journey/resume', queued(20 * MIN)).expect(201)

      const { body: replayed } = await post('/journey/pause', pause).expect(201)
      expect(replayed.state).toBe('ongoing')
      expect(replayed.accumulatedSeconds).toBe(first.accumulatedSeconds)
      expect(replayed.startedAt).not.toBeNull()
      const task = await prisma.task.findUniqueOrThrow({ where: { id: itemId } })
      expect(task.status).toBe('in_progress')
      expect(task.accumulatedSeconds).toBe(first.accumulatedSeconds)
    })

    // Prova que a corrida pela chave vira releitura, e não erro. Que a ação
    // não se repete está nos dois testes acima e no "encerrar".
    it('duas tentativas ao mesmo tempo com a mesma chave aplicam a ação uma vez', async () => {
      await post(`/journey/tasks/${itemId}/start`, queued(60 * MIN)).expect(201)
      const pause = queued(30 * MIN)
      const [a, b] = await Promise.all([post('/journey/pause', pause), post('/journey/pause', pause)])
      expect([a.status, b.status]).toEqual([201, 201])
      expect(a.body).toEqual(b.body)
      expect(await prisma.idempotencyKey.count({ where: { userId: aId, scope: 'journey.pause' } })).toBe(1)
    })

    it('mesma chave com outra hora do toque → 422', async () => {
      const key = randomUUID()
      await post(`/journey/tasks/${itemId}/start`, queued(60 * MIN, key)).expect(201)
      await post(`/journey/tasks/${itemId}/start`, queued(50 * MIN, key)).expect(422)
    })

    it('mesma chave em outra ação → 422, e a ação não roda', async () => {
      await post(`/journey/tasks/${itemId}/start`, queued(60 * MIN)).expect(201)
      const pause = queued(30 * MIN)
      await post('/journey/pause', pause).expect(201)
      await post('/journey/resume', pause).expect(422)
      const { body: now } = await http().get('/journey').set(auth).expect(200)
      expect(now.state).toBe('paused')
    })

    it('ação recusada não gasta a chave: iniciar tarefa já concluída segue 409', async () => {
      await prisma.task.update({ where: { id: itemId }, data: { status: 'done' } })
      const start = queued(MIN)
      await post(`/journey/tasks/${itemId}/start`, start).expect(409)
      await post(`/journey/tasks/${itemId}/start`, start).expect(409)
      expect(await prisma.idempotencyKey.count({ where: { userId: aId } })).toBe(0)
    })

    it('chave fora do formato → 400', async () => {
      await http().post('/journey/pause').set({ ...auth, 'Idempotency-Key': 'nao-e-uuid' }).expect(400)
    })

    it('sem chave nada muda: duas pausas seguidas são duas ações', async () => {
      await http().post(`/journey/tasks/${itemId}/start`).set(auth).expect(201)
      await http().post('/journey/pause').set(auth).expect(201)
      await http().post('/journey/pause').set(auth).expect(201)
      expect(await prisma.idempotencyKey.count({ where: { userId: aId } })).toBe(0)
    })
  })

  describe('foto da tarefa', () => {
    const photoKey = () => `task/${randomUUID()}.jpg`

    it('a mesma foto enviada duas vezes entra uma vez só', async () => {
      const imageKey = photoKey()
      await http().post(`/journey/tasks/${itemId}/photo`).set(auth).send({ imageKey }).expect(201)
      const { body } = await http().post(`/journey/tasks/${itemId}/photo`).set(auth).send({ imageKey }).expect(201)
      expect(body.images).toHaveLength(1)
      expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).imageKeys).toEqual([imageKey])
    })

    it('a mesma foto em duas tentativas ao mesmo tempo entra uma vez só', async () => {
      const imageKey = photoKey()
      const send = () => http().post(`/journey/tasks/${itemId}/photo`).set(auth).send({ imageKey })
      const results = await Promise.all([send(), send(), send(), send()])
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201])
      expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).imageKeys).toEqual([imageKey])
    })

    // A ordem que nunca teve foto guarda a coluna nula, não lista vazia.
    it('a primeira foto entra numa ordem que nunca teve foto', async () => {
      await prisma.$executeRaw`UPDATE "WorkOrder" SET "imageKeys" = NULL WHERE id = ${orderId}`
      const imageKey = photoKey()
      const { body } = await http().post(`/journey/tasks/${itemId}/photo`).set(auth).send({ imageKey }).expect(201)
      expect(body.images).toHaveLength(1)
      expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).imageKeys).toEqual([imageKey])
    })

    it('foto nova marca a ordem como alterada; foto repetida não', async () => {
      const imageKey = photoKey()
      const before = (await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).updatedAt
      await new Promise((resolve) => setTimeout(resolve, 20))
      await http().post(`/journey/tasks/${itemId}/photo`).set(auth).send({ imageKey }).expect(201)
      const afterNew = (await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).updatedAt
      expect(afterNew.getTime()).toBeGreaterThan(before.getTime())

      await new Promise((resolve) => setTimeout(resolve, 20))
      await http().post(`/journey/tasks/${itemId}/photo`).set(auth).send({ imageKey }).expect(201)
      const afterRepeat = (await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).updatedAt
      expect(afterRepeat.getTime()).toBe(afterNew.getTime())
    })

    it('fotos diferentes continuam entrando todas', async () => {
      const keys = [photoKey(), photoKey(), photoKey()]
      await Promise.all(keys.map((imageKey) => http().post(`/journey/tasks/${itemId}/photo`).set(auth).send({ imageKey }).expect(201)))
      const saved = (await prisma.workOrder.findUniqueOrThrow({ where: { id: orderId } })).imageKeys
      expect([...saved].sort()).toEqual([...keys].sort())
    })
  })
})
