// MediaService constrói o S3Client no app.init() → MINIO_* setados ANTES de
// montar o AppModule deixam o presign determinístico e sem depender de MinIO up
// (presign só computa URLs; nenhum roundtrip). Idêntico aos siblings.
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('WorkOrders e2e', () => {
  let app: INestApplication, prisma: PrismaService
  // Usuários descartáveis: 1 admin, 3 workers aprovados (A/B responsáveis, C não),
  // 1 pending + 1 rejected (prova do filtro de /assignable).
  const adminE = 'wo-admin@ex.com'
  const aE = 'wo-a@ex.com', bE = 'wo-b@ex.com', cE = 'wo-c@ex.com'
  const pendingE = 'wo-pending@ex.com', rejectedE = 'wo-rejected@ex.com'
  const emails = [adminE, aE, bE, cE, pendingE, rejectedE]
  let aId = '', bId = '', cId = '', pendingId = '', rejectedId = ''
  let adminAuth: { Authorization: string }, aAuth: { Authorization: string }, bAuth: { Authorization: string }, cAuth: { Authorization: string }

  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }

  // Cleanup FK-safe (sobrevive a re-runs): resolve users por email e apaga, NA
  // ORDEM, tudo que os referencia — notifications (workerId), work orders
  // (authorId; cascade → itens + join _workOrderResponsibles), journeys
  // (workerId), profiles (userId) — antes dos próprios users.
  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
    const ids = users.map((u) => u.id)
    if (ids.length) {
      await prisma.notification.deleteMany({ where: { workerId: { in: ids } } })
      await prisma.workOrder.deleteMany({ where: { authorId: { in: ids } } }) // cascade remove Task + join
      await prisma.journey.deleteMany({ where: { workerId: { in: ids } } })
      await prisma.profile.deleteMany({ where: { userId: { in: ids } } })
    }
    await prisma.user.deleteMany({ where: { email: { in: emails } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService); await cleanup()
    const bcrypt = await import('bcrypt')
    const hash = await bcrypt.hash('test1234', 10)
    const mkAdmin = async (email: string, name: string) =>
      (await prisma.user.create({ data: { email, name, passwordHash: hash, role: 'ADMIN', emailVerified: true, approvalStatus: 'APPROVED' } })).id
    const mkWorker = async (email: string, name: string, approval: 'APPROVED' | 'PENDING' | 'REJECTED' = 'APPROVED', withProfile = true) => {
      const u = await prisma.user.create({ data: { email, name, passwordHash: hash, role: 'WORKER', emailVerified: true, approvalStatus: approval } })
      if (withProfile) await prisma.profile.create({ data: { userId: u.id, fullName: name, jobTitle: 'Operador', sector: 'Mina' } })
      return u.id
    }
    await mkAdmin(adminE, 'WO Admin')
    aId = await mkWorker(aE, 'Worker A')
    bId = await mkWorker(bE, 'Worker B')
    cId = await mkWorker(cE, 'Worker C')
    pendingId = await mkWorker(pendingE, 'Worker Pending', 'PENDING')
    rejectedId = await mkWorker(rejectedE, 'Worker Rejected', 'REJECTED')
    adminAuth = await login(adminE); aAuth = await login(aE); bAuth = await login(bE); cAuth = await login(cE)
  })
  afterAll(async () => { await cleanup(); await app.close() })

  // Estado compartilhado da "ordem principal" criada no teste 2 e usada nos 3–4.
  let order1Id = '', item1Id = '', item2Id = ''

  it('POST /work-orders: worker → 403, sem token → 401', async () => {
    const payload = { title: 'Não autorizado', responsibleIds: [aId] }
    await request(app.getHttpServer()).post('/work-orders').set(aAuth).send(payload).expect(403)
    await request(app.getHttpServer()).post('/work-orders').send(payload).expect(401)
  })

  it('admin cria (2 resp, 2 itens) → 201 + detalhe completo + 2 notifs (fan-out inline)', async () => {
    const { body: created } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Ordem principal', summary: 'objetivo', responsibleIds: [aId, bId],
      items: [{ title: 'Item 1' }, { title: 'Item 2' }],
    }).expect(201)
    order1Id = created.id
    item1Id = created.items[0].id; item2Id = created.items[1].id

    const { body: d } = await request(app.getHttpServer()).get(`/work-orders/${order1Id}`).set(adminAuth).expect(200)
    expect(d.author).toBeDefined()
    expect(d.author.name).toBe('WO Admin')
    expect(d.status).toBe('pending')
    expect(d.progressPct).toBe(0)
    expect(d.items).toHaveLength(2)
    expect(d.items.map((i: any) => i.title)).toEqual(['Item 1', 'Item 2']) // ordenados por position
    expect(d.items.every((i: any) => i.status === 'pending')).toBe(true)
    expect(d.responsibles).toHaveLength(2)
    d.responsibles.forEach((r: any) => expect(r.bloodType).toBeUndefined()) // Decisão 2: sem bloodType

    // Fan-out INLINE em test-env → linhas existem imediatamente. 1 por responsável.
    const notifs = await prisma.notification.findMany({ where: { targetId: order1Id, domain: 'journey' } })
    expect(notifs).toHaveLength(2)
    expect(notifs.map((n) => n.workerId).sort()).toEqual([aId, bId].sort())
  })

  it('journey/tasks: responsável (A) vê os 2 itens; não-responsável (C) não vê e recebe 404 no item', async () => {
    const { body: aTasks } = await request(app.getHttpServer()).get('/journey/tasks').set(aAuth).expect(200)
    const aIds = aTasks.map((t: any) => t.id)
    expect(aIds).toContain(item1Id)
    expect(aIds).toContain(item2Id)

    const { body: cTasks } = await request(app.getHttpServer()).get('/journey/tasks').set(cAuth).expect(200)
    expect(cTasks.map((t: any) => t.id)).not.toContain(item1Id)
    await request(app.getHttpServer()).get(`/journey/tasks/${item1Id}`).set(cAuth).expect(404)
  })

  it('start/complete transiciona o pai (pending→in_progress→done) e a ordem some da jornada quando done', async () => {
    // A inicia item1 → pai in_progress
    await request(app.getHttpServer()).post(`/journey/tasks/${item1Id}/start`).set(aAuth).expect(201)
    let d = (await request(app.getHttpServer()).get(`/work-orders/${order1Id}`).set(adminAuth).expect(200)).body
    expect(d.status).toBe('in_progress')

    // A conclui item1 → pai continua in_progress (item2 pendente); progressPct 50 na lista filtrada
    const { body: comp } = await request(app.getHttpServer()).post(`/journey/tasks/${item1Id}/complete`).set(aAuth).expect(201)
    expect(comp.task.status).toBe('done')
    d = (await request(app.getHttpServer()).get(`/work-orders/${order1Id}`).set(adminAuth).expect(200)).body
    expect(d.status).toBe('in_progress')
    const { body: inProg } = await request(app.getHttpServer()).get('/work-orders?status=in_progress').set(adminAuth).expect(200)
    const row = inProg.find((o: any) => o.id === order1Id)
    expect(row).toBeTruthy()
    // A listagem mede progresso por TEMPO (decorrido dividido por estimado), a
    // pedido do cliente, e não por itens concluídos, que deixaria uma ordem de
    // um item só em 0% a execução inteira saltando pra 100%. Esta ordem é
    // criada SEM
    // estimatedMinutes, e sem estimativa não existe percentual honesto, então o
    // valor é 0 por definição, não por arredondamento de relógio. O que o caso
    // realmente guarda continua valendo: com 1 de 2 itens concluídos a ordem
    // segue in_progress e aparece na lista filtrada.
    expect(row.progressPct).toBe(0)

    // B conclui item2 → pai done
    await request(app.getHttpServer()).post(`/journey/tasks/${item2Id}/complete`).set(bAuth).expect(201)
    d = (await request(app.getHttpServer()).get(`/work-orders/${order1Id}`).set(adminAuth).expect(200)).body
    expect(d.status).toBe('done')

    // Ordem done sai da lista da jornada do worker (filtro order.status != done)
    const { body: aTasks } = await request(app.getHttpServer()).get('/journey/tasks').set(aAuth).expect(200)
    const aIds = aTasks.map((t: any) => t.id)
    expect(aIds).not.toContain(item1Id)
    expect(aIds).not.toContain(item2Id)
  })

  it('concorrência (SELECT … FOR UPDATE): 2 completes simultâneos convergem em done, nunca presos em in_progress', async () => {
    // 3 rodadas com ordens frescas: cada rodada dispara os 2 completes em paralelo
    // (Promise.all). A trava pessimista no pai serializa os recomputes → o segundo
    // enxerga o primeiro item já done e fecha em done. Sem a trava, lost-update
    // deixaria o pai preso em in_progress. Flakiness aqui = achado real.
    for (let round = 0; round < 3; round++) {
      const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
        title: `Corrida ${round}`, responsibleIds: [aId, bId], items: [{ title: 'C1' }, { title: 'C2' }],
      }).expect(201)
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer()).post(`/journey/tasks/${o.items[0].id}/complete`).set(aAuth),
        request(app.getHttpServer()).post(`/journey/tasks/${o.items[1].id}/complete`).set(bAuth),
      ])
      expect(r1.status).toBeGreaterThanOrEqual(200); expect(r1.status).toBeLessThan(300)
      expect(r2.status).toBeGreaterThanOrEqual(200); expect(r2.status).toBeLessThan(300)
      const { body: d } = await request(app.getHttpServer()).get(`/work-orders/${o.id}`).set(adminAuth).expect(200)
      expect(d.status).toBe('done')
      // 0, não 100, e pelo mesmo motivo do caso anterior: progresso é por tempo
      // e esta ordem não tem estimativa. O que este caso guarda
      // é a trava pessimista, ou seja, `status` fechar em done sob dois completes
      // simultâneos, e isso segue afirmado acima.
      expect(d.progressPct).toBe(0)
    }
  })

  it('PATCH: edita o título', async () => {
    const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Título antigo', responsibleIds: [aId], items: [{ title: 'P1' }],
    }).expect(201)
    await request(app.getHttpServer()).patch(`/work-orders/${o.id}`).set(adminAuth).send({ title: 'Título novo' }).expect(200)
    const { body: d } = await request(app.getHttpServer()).get(`/work-orders/${o.id}`).set(adminAuth).expect(200)
    expect(d.title).toBe('Título novo')
  })

  it('PATCH: adicionar item numa ordem done a reabre para in_progress', async () => {
    const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Reabrir', responsibleIds: [aId], items: [{ title: 'D1' }],
    }).expect(201)
    // Conclui o único item → pai done
    await request(app.getHttpServer()).post(`/journey/tasks/${o.items[0].id}/complete`).set(aAuth).expect(201)
    let d = (await request(app.getHttpServer()).get(`/work-orders/${o.id}`).set(adminAuth).expect(200)).body
    expect(d.status).toBe('done')
    // Mantém o existente (id) + adiciona um novo (pending) → recompute reabre
    await request(app.getHttpServer()).patch(`/work-orders/${o.id}`).set(adminAuth).send({
      items: [{ id: o.items[0].id, title: 'D1' }, { title: 'D2' }],
    }).expect(200)
    d = (await request(app.getHttpServer()).get(`/work-orders/${o.id}`).set(adminAuth).expect(200)).body
    expect(d.items).toHaveLength(2)
    expect(d.status).toBe('in_progress')
  })

  it('PATCH: remover item', async () => {
    const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Remover item', responsibleIds: [aId], items: [{ title: 'R1' }, { title: 'R2' }],
    }).expect(201)
    // Payload final só com R2 → R1 é deletado (cascade Task)
    await request(app.getHttpServer()).patch(`/work-orders/${o.id}`).set(adminAuth).send({
      items: [{ id: o.items[1].id, title: 'R2' }],
    }).expect(200)
    const { body: d } = await request(app.getHttpServer()).get(`/work-orders/${o.id}`).set(adminAuth).expect(200)
    expect(d.items).toHaveLength(1)
    expect(d.items[0].title).toBe('R2')
  })

  it('PATCH: trocar responsáveis notifica só o recém-adicionado (não o pré-existente)', async () => {
    const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Troca resp', responsibleIds: [aId], items: [{ title: 'T1' }],
    }).expect(201)
    // Na criação, A já foi notificado (1 linha). B ainda não tem nenhuma.
    const beforeA = await prisma.notification.count({ where: { targetId: o.id, workerId: aId } })
    const beforeB = await prisma.notification.count({ where: { targetId: o.id, workerId: bId } })
    expect(beforeA).toBe(1)
    expect(beforeB).toBe(0)
    await request(app.getHttpServer()).patch(`/work-orders/${o.id}`).set(adminAuth).send({ responsibleIds: [aId, bId] }).expect(200)
    const afterA = await prisma.notification.count({ where: { targetId: o.id, workerId: aId } })
    const afterB = await prisma.notification.count({ where: { targetId: o.id, workerId: bId } })
    expect(afterA).toBe(beforeA) // pré-existente NÃO é re-notificado
    expect(afterB).toBe(beforeB + 1) // recém-adicionado ganha 1 notif
  })

  it('PATCH que deixaria 0 itens → 400', async () => {
    const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Sem itens', responsibleIds: [aId], items: [{ title: 'Z1' }],
    }).expect(201)
    await request(app.getHttpServer()).patch(`/work-orders/${o.id}`).set(adminAuth).send({ items: [] }).expect(400)
    // Ordem intacta (o 400 não mexeu no conjunto de itens)
    const { body: d } = await request(app.getHttpServer()).get(`/work-orders/${o.id}`).set(adminAuth).expect(200)
    expect(d.items).toHaveLength(1)
  })

  it('ordem SEM checklist (items omitido) → item automático aparece na jornada do responsável (Decisão B)', async () => {
    const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Sem checklist', summary: 'resumo', responsibleIds: [aId],
    }).expect(201)
    expect(o.items).toHaveLength(1)
    const autoId = o.items[0].id
    const { body: aTasks } = await request(app.getHttpServer()).get('/journey/tasks').set(aAuth).expect(200)
    expect(aTasks.map((t: any) => t.id)).toContain(autoId)
  })

  it('#1 item COMPARTILHADO: A inicia, B conclui, A encerra o turno → o item NÃO regride de done', async () => {
    // O activeTaskId é por-worker mas o item é compartilhado: depois que B conclui,
    // o ponteiro de A ainda aponta pro item. Encerrar o turno de A não pode ressuscitá-lo.
    const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Regressão multi-resp', responsibleIds: [aId, bId], items: [{ title: 'X' }],
    }).expect(201)
    const itemId = o.items[0].id
    await request(app.getHttpServer()).post(`/journey/tasks/${itemId}/start`).set(aAuth).expect(201)    // activeTaskId(A)=item
    await request(app.getHttpServer()).post(`/journey/tasks/${itemId}/complete`).set(bAuth).expect(201) // B fecha o item → pai done
    let d = (await request(app.getHttpServer()).get(`/work-orders/${o.id}`).set(adminAuth).expect(200)).body
    expect(d.status).toBe('done')
    await request(app.getHttpServer()).post('/journey/end').set(aAuth).expect(201)                       // A encerra o turno
    d = (await request(app.getHttpServer()).get(`/work-orders/${o.id}`).set(adminAuth).expect(200)).body
    expect(d.status).toBe('done')            // NÃO regrediu pra in_progress
    expect(d.items[0].status).toBe('done')   // item continua done (não virou paused)
  })

  it('#2 worker não reabre um item done via start/cancel (Decisão C: reabrir é ação admin) → 409', async () => {
    const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Sem reabrir', responsibleIds: [aId], items: [{ title: 'Y' }],
    }).expect(201)
    const itemId = o.items[0].id
    await request(app.getHttpServer()).post(`/journey/tasks/${itemId}/complete`).set(aAuth).expect(201)
    await request(app.getHttpServer()).post(`/journey/tasks/${itemId}/start`).set(aAuth).expect(409)
    await request(app.getHttpServer()).post(`/journey/tasks/${itemId}/cancel`).set(aAuth).expect(409)
    const d = (await request(app.getHttpServer()).get(`/work-orders/${o.id}`).set(adminAuth).expect(200)).body
    expect(d.status).toBe('done') // pai intacto
  })

  it('#8 não-responsável (C) → 404 no complete e no cancel do item (ownership via pai)', async () => {
    const { body: o } = await request(app.getHttpServer()).post('/work-orders').set(adminAuth).send({
      title: 'Ownership complete/cancel', responsibleIds: [aId], items: [{ title: 'Z' }],
    }).expect(201)
    const itemId = o.items[0].id
    await request(app.getHttpServer()).post(`/journey/tasks/${itemId}/complete`).set(cAuth).expect(404)
    await request(app.getHttpServer()).post(`/journey/tasks/${itemId}/cancel`).set(cAuth).expect(404)
  })

  it('GET /work-orders/assignable → só workers APROVADOS, sem pending/rejected, sem bloodType', async () => {
    const { body } = await request(app.getHttpServer()).get('/work-orders/assignable').set(adminAuth).expect(200)
    const ids = body.map((w: any) => w.id)
    expect(ids).toContain(aId); expect(ids).toContain(bId); expect(ids).toContain(cId)
    expect(ids).not.toContain(pendingId)
    expect(ids).not.toContain(rejectedId)
    body.forEach((w: any) => expect(w.bloodType).toBeUndefined())
  })
})
