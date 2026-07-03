process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Notifications e2e', () => {
  let app: INestApplication, prisma: PrismaService, base: string
  const eA = 'notif-a@ex.com', eB = 'notif-b@ex.com'
  let idA = '', idB = ''
  const reportIds: string[] = []
  const key = (a: string, b: string) => [a, b].sort().join('#')
  const cpath = (id: string) => `/chat/conversations/${encodeURIComponent(id)}`
  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return body.accessToken as string
  }
  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: [eA, eB] } } })
    const ids = users.map((u) => u.id)
    // Notifications têm FK p/ User → apagar ANTES dos users. Cobre as criadas
    // PARA os test users (workerId) e o broadcast dos relatórios de teste (targetId).
    await prisma.notification.deleteMany({ where: { OR: [{ workerId: { in: ids } }, { targetId: { in: reportIds } }] } })
    await prisma.report.deleteMany({ where: { authorId: { in: ids } } })
    if (ids.length) {
      const convs = await prisma.conversation.findMany({ where: { participants: { hasSome: ids } } })
      const convIds = convs.map((c) => c.id)
      if (convIds.length) await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } })
      await prisma.message.deleteMany({ where: { senderId: { in: ids } } })
      if (convIds.length) await prisma.conversation.deleteMany({ where: { id: { in: convIds } } })
    }
    await prisma.user.deleteMany({ where: { email: { in: [eA, eB] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    await app.listen(0)
    const url = await app.getUrl(); base = url.replace('[::1]', 'localhost').replace('0.0.0.0', 'localhost')
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    const mk = async (email: string, name: string) =>
      (await prisma.user.create({ data: { email, name, passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })).id
    idA = await mk(eA, 'Notif A'); idB = await mk(eB, 'Notif B')
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it('sem token → 401', () => request(app.getHttpServer()).get('/notifications').expect(401))

  it('list/read/read-all + ownership 404', async () => {
    const n = await prisma.notification.create({ data: { workerId: idB, title: 'Oi', body: 'corpo', domain: 'faq', read: false } })
    const tB = await login(eB), tA = await login(eA)
    const { body: list } = await request(app.getHttpServer()).get('/notifications').set({ Authorization: `Bearer ${tB}` }).expect(200)
    expect(list.find((x: any) => x.id === n.id)).toBeTruthy()
    await request(app.getHttpServer()).post(`/notifications/${n.id}/read`).set({ Authorization: `Bearer ${tA}` }).expect(404)
    await request(app.getHttpServer()).post(`/notifications/${n.id}/read`).set({ Authorization: `Bearer ${tB}` }).expect(204)
    const { body: list2 } = await request(app.getHttpServer()).get('/notifications').set({ Authorization: `Bearer ${tB}` }).expect(200)
    expect(list2.find((x: any) => x.id === n.id).read).toBe(true)
    await request(app.getHttpServer()).post('/notifications/read-all').set({ Authorization: `Bearer ${tB}` }).expect(204)
  })

  it('cross-domain: B recebe notification (chat) quando A manda mensagem', async () => {
    const tA = await login(eA)
    const convId = key(idA, idB)
    const sock: Socket = io(base, { auth: { token: await login(eB) }, transports: ['websocket'] })
    const got = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando notification')), 4000)
      sock.on('notification', (n) => { clearTimeout(timer); resolve(n) })
      sock.on('connect_error', (e) => { clearTimeout(timer); reject(e) })
    })
    await new Promise<void>((r) => sock.on('connect', () => r()))
    await request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'oi B' }).expect(201)
    const n = await got
    expect(n.domain).toBe('chat')
    expect(n.targetId).toBe(convId)
    sock.close()
  })

  it('cross-domain: B recebe notification (reports) quando A posta relatório', async () => {
    const tA = await login(eA)
    const sock: Socket = io(base, { auth: { token: await login(eB) }, transports: ['websocket'] })
    const got = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando notification reports')), 4000)
      sock.on('notification', (n) => { if (n.domain === 'reports') { clearTimeout(timer); resolve(n) } })
      sock.on('connect_error', (e) => { clearTimeout(timer); reject(e) })
    })
    await new Promise<void>((r) => sock.on('connect', () => r()))
    const { body: r } = await request(app.getHttpServer()).post('/reports').set({ Authorization: `Bearer ${tA}` }).send({ title: 'Relatório e2e' }).expect(201)
    reportIds.push(r.id)
    const n = await got
    expect(n.domain).toBe('reports')
    expect(n.targetId).toBe(r.id)
    sock.close()
  })
})
