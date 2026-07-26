// AppModule boota o MediaService (S3Client no construtor) → precisa dos MINIO_* setados antes do app.init().
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

// Fase 2 do realtime: fluxo completo da evacuação real — dispatch do admin,
// notificação real (fila inline em NODE_ENV=test), ack idempotente do worker,
// progresso X/N org-scoped e encerramento.
describe('Evacuations e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const emails = {
    admin: 'evacflow-admin@ex.com',
    w1: 'evacflow-w1@ex.com',
    w2: 'evacflow-w2@ex.com',
    outsider: 'evacflow-out@ex.com',
  }
  let ids: Record<string, string> = {}
  let companyId: string, otherCompanyId: string

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    const userIds = users.map((u) => u.id)
    await prisma.evacuationAck.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.evacuation.deleteMany({ where: { startedById: { in: userIds } } })
    await prisma.notification.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: ['00000000000191', '00000000000272'] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const addr = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    companyId = (await prisma.company.create({ data: { name: 'Evac Co', cnpj: '00000000000191', ...addr } })).id
    otherCompanyId = (await prisma.company.create({ data: { name: 'Other Co', cnpj: '00000000000272', ...addr } })).id
    const bcrypt = await import('bcrypt')
    const passwordHash = await bcrypt.hash('test1234', 10)
    const base = { passwordHash, emailVerified: true, approvalStatus: 'APPROVED' as const }
    ids = {
      admin: (await prisma.user.create({ data: { email: emails.admin, name: 'Evac Admin', role: 'ADMIN', companyId, ...base } })).id,
      w1: (await prisma.user.create({ data: { email: emails.w1, name: 'Evac W1', role: 'WORKER', companyId, ...base } })).id,
      w2: (await prisma.user.create({ data: { email: emails.w2, name: 'Evac W2', role: 'WORKER', companyId, ...base } })).id,
      outsider: (await prisma.user.create({ data: { email: emails.outsider, name: 'Evac Out', role: 'WORKER', companyId: otherCompanyId, ...base } })).id,
    }
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }

  it('sem token → 401; worker não dispara (403)', async () => {
    await request(app.getHttpServer()).post('/evacuations').expect(401)
    const w = await login(emails.w1)
    await request(app.getHttpServer()).post('/evacuations').set(w).expect(403)
  })

  it('fluxo completo: dispatch → notificação real → acks idempotentes → X/N → end', async () => {
    const admin = await login(emails.admin)
    const w1 = await login(emails.w1)
    const outsider = await login(emails.outsider)

    // Dispatch: cria a ativa da org com os 2 workers.
    const { body: started } = await request(app.getHttpServer()).post('/evacuations').set(admin).expect(201)
    expect(started).toMatchObject({ status: 'ACTIVE', total: 2, acked: 0 })
    expect(started.workers.map((w: { id: string }) => w.id).sort()).toEqual([ids.w1, ids.w2].sort())

    // Segunda ativa na mesma org → 409.
    await request(app.getHttpServer()).post('/evacuations').set(admin).expect(409)

    // Notificação REAL persistida pros 2 workers (fila roda inline em test).
    const notifs = await prisma.notification.findMany({ where: { domain: 'evacuation', targetId: started.id } })
    expect(notifs.map((n) => n.workerId).sort()).toEqual([ids.w1, ids.w2].sort())

    // Ack do w1 — idempotente (repetir não muda o X).
    await request(app.getHttpServer()).post(`/evacuations/${started.id}/ack`).set(w1).expect(204)
    await request(app.getHttpServer()).post(`/evacuations/${started.id}/ack`).set(w1).expect(204)
    // Worker de OUTRA org → 404 (não vaza existência).
    await request(app.getHttpServer()).post(`/evacuations/${started.id}/ack`).set(outsider).expect(404)

    const { body: active } = await request(app.getHttpServer()).get('/evacuations/active').set(admin).expect(200)
    expect(active).toMatchObject({ id: started.id, total: 2, acked: 1 })
    const w1Entry = active.workers.find((w: { id: string }) => w.id === ids.w1)
    expect(w1Entry.acked).toBe(true)
    expect(typeof w1Entry.ackAt).toBe('string')

    // WORKER também lê a ativa da PRÓPRIA org (o app mobile precisa do id pro
    // ack); o outsider recebe a da org DELE — ou seja, nenhuma (vazio).
    const { body: w1Active } = await request(app.getHttpServer()).get('/evacuations/active').set(w1).expect(200)
    expect(w1Active).toMatchObject({ id: started.id, acked: 1 })
    const { body: outActive } = await request(app.getHttpServer()).get('/evacuations/active').set(outsider).expect(200)
    expect(outActive?.id ?? null).toBeNull()

    // Encerra: active esvazia e ack tardio → 409.
    await request(app.getHttpServer()).post(`/evacuations/${started.id}/end`).set(admin).expect(204)
    // `null` do controller vira corpo vazio no wire (supertest lê {}): o
    // contrato observável de "sem ativa" é a ausência de id.
    const { body: after } = await request(app.getHttpServer()).get('/evacuations/active').set(admin).expect(200)
    expect(after?.id ?? null).toBeNull()
    await request(app.getHttpServer()).post(`/evacuations/${started.id}/ack`).set(w1).expect(409)
  }, 20000)
})
