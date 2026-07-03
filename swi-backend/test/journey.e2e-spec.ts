process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Journey e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'journey-e2e@ex.com'
  let workerId: string, taskId: string
  const login = async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }
  const today = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) }
  const cleanup = async () => {
    await prisma.task.deleteMany({ where: { assignee: { email } } })
    await prisma.journey.deleteMany({ where: { worker: { email } } })
    await prisma.user.deleteMany({ where: { email } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService); await cleanup()
    const bcrypt = await import('bcrypt')
    const u = await prisma.user.create({ data: { email, name: 'Journey E2E', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })
    workerId = u.id
    const t = await prisma.task.create({ data: { assignedTo: workerId, title: 'T1', estimatedMinutes: 120, scheduledDate: today() } })
    taskId = t.id
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it('journey sem token → 401', () => request(app.getHttpServer()).get('/journey').expect(401))

  it('getJourney cria idle e é idempotente no dia', async () => {
    const auth = await login()
    const { body: a } = await request(app.getHttpServer()).get('/journey').set(auth).expect(200)
    expect(a.state).toBe('idle')
    await request(app.getHttpServer()).get('/journey').set(auth).expect(200) // 2ª leitura não duplica (@@unique)
  })

  it('listTasks devolve a task de hoje', async () => {
    const auth = await login()
    const { body } = await request(app.getHttpServer()).get('/journey/tasks').set(auth).expect(200)
    expect(body.map((t: any) => t.id)).toContain(taskId)
  })

  it('getTask inexistente → 404', async () => {
    const auth = await login()
    await request(app.getHttpServer()).get('/journey/tasks/nao-existe').set(auth).expect(404)
  })

  it('lifecycle: start → pause → resume → end', async () => {
    const auth = await login()
    const { body: s } = await request(app.getHttpServer()).post(`/journey/tasks/${taskId}/start`).set(auth).expect(201)
    expect(s.journey.state).toBe('ongoing')
    expect(s.journey.activeTaskId).toBe(taskId)
    expect(s.task.status).toBe('in_progress')
    const { body: p } = await request(app.getHttpServer()).post('/journey/pause').set(auth).expect(201)
    expect(p.state).toBe('paused')
    const { body: r } = await request(app.getHttpServer()).post('/journey/resume').set(auth).expect(201)
    expect(r.state).toBe('ongoing')
    const { body: e } = await request(app.getHttpServer()).post('/journey/end').set(auth).expect(201)
    expect(e.state).toBe('idle')
    expect(e.activeTaskId).toBeNull()
    expect(e.accumulatedSeconds).toBe(0)
    const { body: done } = await request(app.getHttpServer()).get(`/journey/tasks/${taskId}`).set(auth).expect(200)
    expect(done.status).toBe('done')
  })

  it('photo rejeita imageKey de outro prefixo → 400', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post(`/journey/tasks/${taskId}/photo`).set(auth).send({ imageKey: 'reports/x.jpg' }).expect(400)
  })

  it('photo com key task/ válida faz append', async () => {
    const auth = await login()
    const key = `task/${'0'.repeat(8)}-0000-0000-0000-000000000000.jpg`
    const { body } = await request(app.getHttpServer()).post(`/journey/tasks/${taskId}/photo`).set(auth).send({ imageKey: key }).expect(201)
    expect(body.images.length).toBeGreaterThan(0) // presigned (objeto não precisa existir pra assinar)
  })
})
