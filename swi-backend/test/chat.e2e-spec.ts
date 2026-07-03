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

describe('Chat e2e', () => {
  let app: INestApplication, prisma: PrismaService, base: string
  const eA = 'chat-a@ex.com', eB = 'chat-b@ex.com'
  let idA = '', idB = '', convId = ''
  const key = (a: string, b: string) => [a, b].sort().join('#')
  const cpath = (id: string) => `/chat/conversations/${encodeURIComponent(id)}` // ids têm '#'
  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return body.accessToken as string
  }
  // Cleanup robusto (sobrevive a re-runs): resolve users por email, apaga suas
  // mensagens + conversas (participants) e só então os users (FK Message.senderId).
  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: [eA, eB] } } })
    const ids = users.map((u) => u.id)
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
    await app.listen(0) // porta real pro socket.io
    const url = await app.getUrl(); base = url.replace('[::1]', 'localhost').replace('0.0.0.0', 'localhost')
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    const mk = async (email: string, name: string) =>
      (await prisma.user.create({ data: { email, name, passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })).id
    idA = await mk(eA, 'Chat A'); idB = await mk(eB, 'Chat B')
    convId = key(idA, idB)
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it('sem token → 401', () => request(app.getHttpServer()).get('/chat/conversations').expect(401))

  it('listDirectory traz o outro worker', async () => {
    const t = await login(eA)
    const { body } = await request(app.getHttpServer()).get('/chat/directory').set({ Authorization: `Bearer ${t}` }).expect(200)
    expect(body.map((c: any) => c.workerId)).toContain(idB)
  })

  it('sendMessage cria a conversa e aparece nas listas; markRead zera unread', async () => {
    const tA = await login(eA), tB = await login(eB)
    await request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'oi B' }).expect(201)
    const { body: convsB } = await request(app.getHttpServer()).get('/chat/conversations').set({ Authorization: `Bearer ${tB}` }).expect(200)
    const cB = convsB.find((c: any) => c.id === convId)
    expect(cB.unreadBy[idB]).toBe(1)
    const { body: msgs } = await request(app.getHttpServer()).get(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tB}` }).expect(200)
    expect(msgs[0].body).toBe('oi B')
    await request(app.getHttpServer()).post(`${cpath(convId)}/read`).set({ Authorization: `Bearer ${tB}` }).expect(204)
    const { body: convsB2 } = await request(app.getHttpServer()).get('/chat/conversations').set({ Authorization: `Bearer ${tB}` }).expect(200)
    expect(convsB2.find((c: any) => c.id === convId).unreadBy[idB]).toBe(0)
  })

  it('não-membro → 404', async () => {
    const tA = await login(eA)
    const alheia = key('outro-x', 'outro-y')
    await request(app.getHttpServer()).get(`${cpath(alheia)}/messages`).set({ Authorization: `Bearer ${tA}` }).expect(404)
  })

  it('mensagem vazia → 400', async () => {
    const tA = await login(eA)
    await request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({}).expect(400)
  })

  it('real-time: B recebe pelo socket a mensagem que A envia', async () => {
    const tA = await login(eA), tB = await login(eB)
    const sock: Socket = io(base, { auth: { token: tB }, transports: ['websocket'] })
    const got = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando message')), 4000)
      sock.on('message', (m) => { clearTimeout(timer); resolve(m) })
      sock.on('connect_error', (e) => { clearTimeout(timer); reject(e) })
    })
    await new Promise<void>((r) => sock.on('connect', () => r()))
    await request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'push!' }).expect(201)
    const msg = await got
    expect(msg.body).toBe('push!')
    expect(msg.conversationId).toBe(convId)
    sock.close()
  })
})
