import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { journeyDayOf } from '../src/journey/journey-day'

describe('Journey e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const eA = 'journey-a@ex.com', eB = 'journey-b@ex.com', eC = 'journey-c@ex.com'
  const emails = [eA, eB, eC]
  let aId = '', bId = '', cId = ''
  // Ordem principal (responsável = A) com 2 itens; ordem alheia (responsável = B)
  // com 1 item — prova de ownership (item cujo pai não me lista → 404).
  let item1Id = '', item2Id = '', foreignItemId = ''

  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }

  // Cleanup FK-safe: apaga WorkOrders (cascade → itens + join _workOrderResponsibles)
  // e journeys ANTES dos users — mesma lição das e2e de notifications/chat.
  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
    const ids = users.map((u) => u.id)
    if (ids.length) {
      await prisma.notification.deleteMany({ where: { workerId: { in: ids } } })
      await prisma.workOrder.deleteMany({ where: { authorId: { in: ids } } }) // cascade remove Task + join
      await prisma.journey.deleteMany({ where: { workerId: { in: ids } } })
    }
    await prisma.user.deleteMany({ where: { email: { in: emails } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService); await cleanup()
    const bcrypt = await import('bcrypt')
    const hash = await bcrypt.hash('test1234', 10)
    const mk = async (email: string, name: string) =>
      (await prisma.user.create({ data: { email, name, passwordHash: hash, role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })).id
    aId = await mk(eA, 'Journey A'); bId = await mk(eB, 'Journey B'); cId = await mk(eC, 'Journey C')

    // Item agora é filho de um WorkOrder; membership vem de order.responsibles.
    const order = await prisma.workOrder.create({
      data: {
        authorId: aId, title: 'Ordem Jornada', summary: 'objetivo',
        responsibles: { connect: [{ id: aId }] },
        items: { create: [{ title: 'Item 1', position: 0, estimatedMinutes: 120 }, { title: 'Item 2', position: 1, estimatedMinutes: 60 }] },
      },
      include: { items: { orderBy: { position: 'asc' } } },
    })
    item1Id = order.items[0].id; item2Id = order.items[1].id

    const foreign = await prisma.workOrder.create({
      data: {
        authorId: bId, title: 'Ordem Alheia',
        responsibles: { connect: [{ id: bId }] },
        items: { create: [{ title: 'Alheio', position: 0 }] },
      },
      include: { items: true },
    })
    foreignItemId = foreign.items[0].id
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it('journey sem token → 401', () => request(app.getHttpServer()).get('/journey').expect(401))

  it('getJourney cria idle e é idempotente no dia', async () => {
    const auth = await login(eA)
    const { body: a } = await request(app.getHttpServer()).get('/journey').set(auth).expect(200)
    expect(a.state).toBe('idle')
    await request(app.getHttpServer()).get('/journey').set(auth).expect(200) // 2ª leitura não duplica (@@unique)
  })

  it('listTasks devolve os itens do WorkOrder do responsável', async () => {
    const auth = await login(eA)
    const { body } = await request(app.getHttpServer()).get('/journey/tasks').set(auth).expect(200)
    const ids = body.map((t: any) => t.id)
    expect(ids).toContain(item1Id)
    expect(ids).toContain(item2Id)
  })

  it('getTask inexistente → 404', async () => {
    const auth = await login(eA)
    await request(app.getHttpServer()).get('/journey/tasks/nao-existe').set(auth).expect(404)
  })

  it('ownership: getTask de item cujo pai não me lista → 404', async () => {
    const auth = await login(eA) // A não é responsável da ordem alheia (só B)
    await request(app.getHttpServer()).get(`/journey/tasks/${foreignItemId}`).set(auth).expect(404)
  })

  it('lifecycle: start → pause → resume mantém as âncoras/estados', async () => {
    const auth = await login(eA)
    const { body: s } = await request(app.getHttpServer()).post(`/journey/tasks/${item1Id}/start`).set(auth).expect(201)
    expect(s.journey.state).toBe('ongoing')
    expect(s.journey.activeTaskId).toBe(item1Id)
    expect(s.task.status).toBe('in_progress')
    expect(s.task.startedAt).not.toBeNull()
    const { body: p } = await request(app.getHttpServer()).post('/journey/pause').set(auth).expect(201)
    expect(p.state).toBe('paused')
    const { body: r } = await request(app.getHttpServer()).post('/journey/resume').set(auth).expect(201)
    expect(r.state).toBe('ongoing')
  })

  it('end deixa o item ativo `paused` (NÃO done) e a jornada idle+zerada (Decisão E)', async () => {
    const auth = await login(eA)
    await request(app.getHttpServer()).post(`/journey/tasks/${item1Id}/start`).set(auth).expect(201) // garante item ativo
    const { body: e } = await request(app.getHttpServer()).post('/journey/end').set(auth).expect(201)
    expect(e.state).toBe('idle')
    expect(e.activeTaskId).toBeNull()
    expect(e.accumulatedSeconds).toBe(0)
    const { body: t } = await request(app.getHttpServer()).get(`/journey/tasks/${item1Id}`).set(auth).expect(200)
    expect(t.status).toBe('paused') // encerrar o turno NÃO conclui o item
  })

  it('cancel volta o item pra `pending` com accumulatedSeconds preservado e a jornada segue `ongoing`', async () => {
    const auth = await login(eA)
    // Semeia item2 com 100s bancados (paused, não-rodando) → cancel deve preservar EXATO.
    await prisma.task.update({ where: { id: item2Id }, data: { status: 'paused', accumulatedSeconds: 100, startedAt: null } })
    // Turno correndo via item1 (ativo) — cancel de item2 (não-ativo) não pode encerrar o turno.
    await request(app.getHttpServer()).post(`/journey/tasks/${item1Id}/start`).set(auth).expect(201)
    const { body: c } = await request(app.getHttpServer()).post(`/journey/tasks/${item2Id}/cancel`).set(auth).expect(201)
    expect(c.task.status).toBe('pending')
    expect(c.task.accumulatedSeconds).toBe(100) // tempo bancado preservado (não zera)
    expect(c.journey.state).toBe('ongoing') // o turno continua correndo
  })

  it('complete seta o item `done` e limpa activeTaskId, mas o `state` do turno continua `ongoing`', async () => {
    const auth = await login(eA)
    await request(app.getHttpServer()).post(`/journey/tasks/${item2Id}/start`).set(auth).expect(201) // item2 vira o ativo
    const { body: c } = await request(app.getHttpServer()).post(`/journey/tasks/${item2Id}/complete`).set(auth).expect(201)
    expect(c.task.status).toBe('done')
    expect(c.journey.activeTaskId).toBeNull() // ponteiro do ativo limpo
    expect(c.journey.state).toBe('ongoing') // turno segue correndo (Decisão A)
  })

  it('photo: a foto vive no PAI → aparece nas images de TODOS os itens do mesmo WorkOrder', async () => {
    const auth = await login(eA)
    const key = `task/${'0'.repeat(8)}-0000-0000-0000-000000000000.jpg`
    const { body: before } = await request(app.getHttpServer()).get(`/journey/tasks/${item1Id}`).set(auth).expect(200)
    const base = before.images.length
    const { body: pres } = await request(app.getHttpServer()).post(`/journey/tasks/${item1Id}/photo`).set(auth).send({ imageKey: key }).expect(201)
    expect(pres.images.length).toBe(base + 1)
    // Mesmo pai → item2 enxerga o mesmo array de anexos do WorkOrder.
    const { body: t2 } = await request(app.getHttpServer()).get(`/journey/tasks/${item2Id}`).set(auth).expect(200)
    expect(t2.images.length).toBe(base + 1)
    expect(t2.images.length).toBe(pres.images.length)
  })

  it('N addTaskPhoto concorrentes acumulam todas as keys sem lost-update (array_append atômico no pai)', async () => {
    const auth = await login(eA)
    const { body: before } = await request(app.getHttpServer()).get(`/journey/tasks/${item1Id}`).set(auth).expect(200)
    const base = before.images.length
    const N = 6
    const mk = (i: number) => `task/${String(i).padStart(8, '0')}-0000-0000-0000-000000000000.jpg`
    await Promise.all(Array.from({ length: N }, (_, i) =>
      request(app.getHttpServer()).post(`/journey/tasks/${item1Id}/photo`).set(auth).send({ imageKey: mk(i) }).expect(201),
    ))
    const { body: after } = await request(app.getHttpServer()).get(`/journey/tasks/${item1Id}`).set(auth).expect(200)
    expect(after.images.length).toBe(base + N) // todas as N — lost-update daria < base+N
  })

  it('photo rejeita imageKey de outro prefixo → 400', async () => {
    const auth = await login(eA)
    await request(app.getHttpServer()).post(`/journey/tasks/${item1Id}/photo`).set(auth).send({ imageKey: 'reports/x.jpg' }).expect(400)
  })

  // Virada do dia: a jornada é a do dia de Brasília, e um turno aberto num dia
  // anterior continua valendo por até 14 h depois de aberto. O relógio do
  // servidor não é controlável aqui, então o turno "de ontem" é gravado direto
  // no banco; a virada das 21h em si fica nos unitários, com relógio fixo.
  describe('virada do dia', () => {
    const HOUR = 60 * 60 * 1000
    const yesterday = () => new Date(journeyDayOf(new Date()).getTime() - 24 * HOUR)
    const seedYesterday = (openedAgoMs: number | null) => {
      const openedAt = openedAgoMs == null ? null : new Date(Date.now() - openedAgoMs)
      return prisma.journey.create({
        data: { workerId: cId, date: yesterday(), state: 'ongoing', startedAt: openedAt ?? new Date(), accumulatedSeconds: 0, openedAt },
      })
    }

    beforeEach(() => prisma.journey.deleteMany({ where: { workerId: cId } }))

    it('turno aberto ontem há 2 h continua, e encerrar fecha ESSA jornada', async () => {
      const carried = await seedYesterday(2 * HOUR)
      const auth = await login(eC)

      const { body: j } = await request(app.getHttpServer()).get('/journey').set(auth).expect(200)
      expect(j.state).toBe('ongoing')

      const { body: e } = await request(app.getHttpServer()).post('/journey/end').set(auth).expect(201)
      expect(e.state).toBe('idle')

      const row = await prisma.journey.findUniqueOrThrow({ where: { id: carried.id } })
      expect(row.state).toBe('idle')
      expect(row.openedAt).toBeNull()
      expect(await prisma.journey.count({ where: { workerId: cId } })).toBe(1) // nenhuma ociosa nova no meio do turno
    })

    it('turno de ontem aberto há 13h50 ainda continua', async () => {
      await seedYesterday(13 * HOUR + 50 * 60 * 1000)
      const auth = await login(eC)
      const { body: j } = await request(app.getHttpServer()).get('/journey').set(auth).expect(200)
      expect(j.state).toBe('ongoing')
    })

    it('turno de ontem aberto há 14h10 não volta: a jornada é a ociosa de hoje', async () => {
      const stale = await seedYesterday(14 * HOUR + 10 * 60 * 1000)
      const auth = await login(eC)

      const { body: j } = await request(app.getHttpServer()).get('/journey').set(auth).expect(200)
      expect(j.state).toBe('idle')

      // Busca pela linha nova sem recalcular o dia: o teste não quebra se a
      // meia-noite de Brasília cair entre a requisição e a conferência.
      const fresh = await prisma.journey.findFirstOrThrow({ where: { workerId: cId, id: { not: stale.id } } })
      expect(fresh.state).toBe('idle')
      expect((await prisma.journey.findUniqueOrThrow({ where: { id: stale.id } })).state).toBe('ongoing') // não mexe na antiga
    })

    it('encerrar o turno trazido e iniciar uma tarefa abre a jornada de hoje', async () => {
      const carried = await seedYesterday(2 * HOUR)
      const order = await prisma.workOrder.create({
        data: {
          authorId: cId, title: 'Ordem C2', responsibles: { connect: [{ id: cId }] },
          items: { create: [{ title: 'Item C2', position: 0 }] },
        },
        include: { items: true },
      })
      const auth = await login(eC)
      await request(app.getHttpServer()).post('/journey/end').set(auth).expect(201)
      const { body: s } = await request(app.getHttpServer()).post(`/journey/tasks/${order.items[0].id}/start`).set(auth).expect(201)
      expect(s.journey.state).toBe('ongoing')

      const today = await prisma.journey.findFirstOrThrow({ where: { workerId: cId, id: { not: carried.id } } })
      expect(today.state).toBe('ongoing')
      expect(today.openedAt).not.toBeNull()
      expect((await prisma.journey.findUniqueOrThrow({ where: { id: carried.id } })).state).toBe('idle') // a trazida segue encerrada
    })

    it('jornada aberta sem openedAt (gravada antes da correção) não volta', async () => {
      await seedYesterday(null)
      const auth = await login(eC)
      const { body: j } = await request(app.getHttpServer()).get('/journey').set(auth).expect(200)
      expect(j.state).toBe('idle')
    })

    it('iniciar grava openedAt na jornada de hoje, e encerrar limpa', async () => {
      const order = await prisma.workOrder.create({
        data: {
          authorId: cId, title: 'Ordem C', responsibles: { connect: [{ id: cId }] },
          items: { create: [{ title: 'Item C', position: 0 }] },
        },
        include: { items: true },
      })
      const auth = await login(eC)
      const before = Date.now()
      await request(app.getHttpServer()).post(`/journey/tasks/${order.items[0].id}/start`).set(auth).expect(201)

      const row = await prisma.journey.findFirstOrThrow({ where: { workerId: cId } }) // única linha de C
      expect(row.openedAt).not.toBeNull()
      expect(row.openedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)

      await request(app.getHttpServer()).post('/journey/end').set(auth).expect(201)
      expect((await prisma.journey.findUniqueOrThrow({ where: { id: row.id } })).openedAt).toBeNull()
    })
  })
})
