import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

// O REST confere o usuário a cada requisição; o socket só confere ao conectar.
// Esta suíte prova a outra metade: quem perde o acesso com o socket ABERTO cai
// na hora, em vez de seguir recebendo chat, notificação e telemetria.
describe('Sessão revogada e2e', () => {
  let app: INestApplication, prisma: PrismaService, base: string
  const ADMIN = 'sessao-admin@ex.com'
  const WORKER = 'sessao-worker@ex.com'
  const SENHA = 'test1234'
  let adminToken = ''

  const limpar = async () => {
    await prisma.profile.deleteMany({ where: { user: { email: { in: [ADMIN, WORKER] } } } })
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN, WORKER] } } })
  }
  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: SENHA }).expect(200)
    return body.accessToken as string
  }
  const criar = async (email: string, role: 'ADMIN' | 'WORKER') => {
    const bcrypt = await import('bcrypt')
    const user = await prisma.user.create({
      data: { email, name: email, passwordHash: await bcrypt.hash(SENHA, 10), role, emailVerified: true, approvalStatus: 'APPROVED' },
    })
    return user.id
  }

  /** Conecta e só devolve depois do handshake aceito. Sem reconexão automática. */
  const conectar = async (token: string): Promise<Socket> => {
    const sock = io(base, { auth: { token }, transports: ['websocket'], reconnection: false })
    await new Promise<void>((resolve, reject) => {
      sock.on('connect', () => resolve())
      sock.on('connect_error', (e) => reject(e))
    })
    return sock
  }
  const queda = (sock: Socket) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('o socket seguiu aberto')), 4000)
      sock.on('disconnect', () => { clearTimeout(timer); resolve() })
    })

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    await app.listen(0)
    const url = await app.getUrl(); base = url.replace('[::1]', 'localhost').replace('0.0.0.0', 'localhost')
    prisma = app.get(PrismaService)
    await limpar()
    await criar(ADMIN, 'ADMIN')
    adminToken = await login(ADMIN)
  })
  beforeEach(async () => {
    await prisma.profile.deleteMany({ where: { user: { email: WORKER } } })
    await prisma.user.deleteMany({ where: { email: WORKER } })
  })
  afterAll(async () => { await limpar(); await app.close() })

  it('desativar derruba o socket aberto e recusa a reconexão', async () => {
    const id = await criar(WORKER, 'WORKER')
    const token = await login(WORKER)
    const sock = await conectar(token)
    const caiu = queda(sock)

    await request(app.getHttpServer()).patch(`/users/${id}`).set({ Authorization: `Bearer ${adminToken}` }).send({ active: false }).expect(200)
    await caiu

    // O token ainda é válido por dias; quem recusa agora é a conferência do
    // handshake, que abre a conexão e a fecha em seguida.
    const outra = io(base, { auth: { token }, transports: ['websocket'], reconnection: false })
    await queda(outra)
    sock.close()
    outra.close()
  })

  it('excluir derruba o socket aberto', async () => {
    const id = await criar(WORKER, 'WORKER')
    const sock = await conectar(await login(WORKER))
    const caiu = queda(sock)

    await request(app.getHttpServer()).delete(`/users/${id}`).set({ Authorization: `Bearer ${adminToken}` }).expect(204)
    await caiu
    sock.close()
  })

  it('editar o cadastro não derruba ninguém', async () => {
    const id = await criar(WORKER, 'WORKER')
    const sock = await conectar(await login(WORKER))

    await request(app.getHttpServer()).patch(`/users/${id}`).set({ Authorization: `Bearer ${adminToken}` }).send({ name: 'Outro Nome' }).expect(200)
    // Um giro de rede: tempo de sobra para uma queda chegar, se ela viesse.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(sock.connected).toBe(true)
    sock.close()
  })
})
