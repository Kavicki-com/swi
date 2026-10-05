import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { RealtimeGateway } from '../src/realtime/realtime.gateway'

// Transmissão ao vivo de ponta a ponta no socket real: o celular do
// funcionário liga, o painel do administrador da mesma empresa assiste, e a
// oferta, a resposta e os candidatos atravessam o servidor só entre os dois.
// O vídeo em si não passa pelo servidor (WebRTC direto), então aqui o SDP é
// texto qualquer: o que se prova é quem fala com quem.

// CNPJs EXCLUSIVOS desta suíte: o cleanup apaga por CNPJ.
const CNPJ_A = '99000000002101'
const CNPJ_B = '99000000002102'

describe('Transmissão ao vivo e2e', () => {
  let app: INestApplication, prisma: PrismaService, base: string
  const emails = {
    worker: 'live-worker@ex.com',
    worker2: 'live-worker-2@ex.com',
    admin1: 'live-admin-1@ex.com',
    admin2: 'live-admin-2@ex.com',
    admin3: 'live-admin-3@ex.com',
    admin4: 'live-admin-4@ex.com',
    otherAdmin: 'live-admin-b@ex.com',
  }
  const ids: Record<keyof typeof emails, string> = {} as never
  const tokens: Record<keyof typeof emails, string> = {} as never
  const opened: Socket[] = []

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    await app.listen(0) // porta real pro socket.io
    const url = await app.getUrl(); base = url.replace('[::1]', 'localhost').replace('0.0.0.0', 'localhost')
    prisma = app.get(PrismaService)
    await cleanup()
    const addr = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyA = (await prisma.company.create({ data: { name: 'Ao vivo A', cnpj: CNPJ_A, ...addr } })).id
    const companyB = (await prisma.company.create({ data: { name: 'Ao vivo B', cnpj: CNPJ_B, ...addr } })).id
    const bcrypt = await import('bcrypt')
    const common = { passwordHash: await bcrypt.hash('test1234', 10), emailVerified: true, approvalStatus: 'APPROVED' as const }
    const plan: Array<[keyof typeof emails, string, 'WORKER' | 'ADMIN', string]> = [
      ['worker', 'Ana Campo', 'WORKER', companyA],
      ['worker2', 'Bruno Campo', 'WORKER', companyA],
      ['admin1', 'Admin Um', 'ADMIN', companyA],
      ['admin2', 'Admin Dois', 'ADMIN', companyA],
      ['admin3', 'Admin Tres', 'ADMIN', companyA],
      ['admin4', 'Admin Quatro', 'ADMIN', companyA],
      ['otherAdmin', 'Admin Outra', 'ADMIN', companyB],
    ]
    for (const [key, name, role, companyId] of plan) {
      ids[key] = (await prisma.user.create({ data: { email: emails[key], name, role, companyId, ...common } })).id
      const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email: emails[key], password: 'test1234' }).expect(200)
      tokens[key] = body.accessToken as string
    }
  })
  afterEach(() => {
    for (const sock of opened.splice(0)) sock.close()
  })
  afterAll(async () => { await cleanup(); await app.close() })

  /**
   * Conecta e só devolve quando o socket já está na sala do usuário: o
   * handshake responde antes de o RealtimeGateway conferir o banco e entrar
   * na sala, e um aviso emitido nesse intervalo se perderia no teste.
   */
  const connect = async (who: keyof typeof emails): Promise<Socket> => {
    const sock = io(base, { auth: { token: tokens[who] }, transports: ['websocket'], reconnection: false })
    opened.push(sock)
    await new Promise<void>((resolve, reject) => {
      sock.on('connect', () => resolve())
      sock.on('connect_error', (e) => reject(e))
    })
    const realtime = app.get(RealtimeGateway)
    for (let i = 0; i < 50; i++) {
      const inRoom = await realtime.server.in(`user:${ids[who]}`).fetchSockets()
      if (inRoom.some((s) => s.id === sock.id)) return sock
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error(`socket de ${who} não entrou na sala`)
  }

  const next = <T = unknown>(sock: Socket, event: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} não chegou`)), 3000)
      sock.once(event, (payload: T) => { clearTimeout(timer); resolve(payload) })
    })


  const ask = (sock: Socket, event: string, body?: unknown) =>
    (body === undefined ? sock.timeout(3000).emitWithAck(event) : sock.timeout(3000).emitWithAck(event, body)) as Promise<Record<string, unknown>>

  const live = (who: keyof typeof emails) =>
    request(app.getHttpServer()).get('/live').set({ Authorization: `Bearer ${tokens[who]}` })

  it('rotas: lista só para administrador; servidores de conexão para qualquer logado', async () => {
    await request(app.getHttpServer()).get('/live').expect(401)
    await live('worker').expect(403)
    await live('admin1').expect(200, [])
    const { body } = await request(app.getHttpServer()).get('/live/ice-servers').set({ Authorization: `Bearer ${tokens.worker}` }).expect(200)
    expect(Array.isArray(body.iceServers)).toBe(true)
  })

  it('funcionário liga, administrador da empresa assiste e a sinalização atravessa só entre os dois', async () => {
    const painel = await connect('admin1')
    const outraEmpresa = await connect('otherAdmin')
    const celular = await connect('worker')
    // Tudo o que chegar à outra empresa durante o fluxo; no fim tem de estar vazio.
    const vazado: Array<[string, unknown]> = []
    for (const event of ['live.offer', 'live.answer', 'live.candidate', 'live.viewer', 'live.started']) {
      outraEmpresa.on(event, (payload: unknown) => vazado.push([event, payload]))
    }

    const started = next<Record<string, unknown>>(painel, 'live.started')
    expect(await ask(celular, 'live.start')).toEqual({ ok: true })
    expect(await started).toEqual({ workerId: ids.worker, name: 'Ana Campo', startedAt: expect.any(String) })

    const { body: lista } = await live('admin1').expect(200)
    expect(lista).toEqual([{ workerId: ids.worker, name: 'Ana Campo', startedAt: expect.any(String) }])
    await live('otherAdmin').expect(200, [])

    const chamado = next<{ sessionId: string }>(celular, 'live.viewer')
    const watch = await ask(painel, 'live.watch', { workerId: ids.worker })
    expect(watch).toEqual({ ok: true, sessionId: expect.any(String) })
    const sessionId = watch.sessionId as string
    expect(await chamado).toEqual({ sessionId })

    const oferta = next(painel, 'live.offer')
    expect(await ask(celular, 'live.offer', { sessionId, sdp: 'v=0 oferta' })).toEqual({ ok: true })
    expect(await oferta).toEqual({ sessionId, sdp: 'v=0 oferta' })

    const resposta = next(celular, 'live.answer')
    expect(await ask(painel, 'live.answer', { sessionId, sdp: 'v=0 resposta' })).toEqual({ ok: true })
    expect(await resposta).toEqual({ sessionId, sdp: 'v=0 resposta' })

    const candidatoNoPainel = next(painel, 'live.candidate')
    await ask(celular, 'live.candidate', { sessionId, candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.2 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 } })
    expect(await candidatoNoPainel).toEqual({ sessionId, candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.2 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 } })
    const candidatoNoCelular = next(celular, 'live.candidate')
    await ask(painel, 'live.candidate', { sessionId, candidate: { candidate: '' } })
    expect(await candidatoNoCelular).toEqual({ sessionId, candidate: { candidate: '' } })

    // Quem não é da sessão não injeta nada nela.
    expect(await ask(outraEmpresa, 'live.answer', { sessionId, sdp: 'v=0 intruso' })).toEqual({ ok: false, error: 'not-found' })

    const saiu = next(celular, 'live.viewer-left')
    expect(await ask(painel, 'live.unwatch', { sessionId })).toEqual({ ok: true })
    expect(await saiu).toEqual({ sessionId })

    expect(await ask(celular, 'live.stop')).toEqual({ ok: true })
    // Um giro de rede depois do último aviso, para algo vazado ter tempo de chegar.
    await new Promise((r) => setTimeout(r, 300))
    expect(vazado).toEqual([])
  })

  it('recusas: outra empresa, papéis trocados e funcionário que não transmite', async () => {
    const celular = await connect('worker')
    const outro = await connect('worker2')
    const painel = await connect('admin1')
    const outraEmpresa = await connect('otherAdmin')
    expect(await ask(celular, 'live.start')).toEqual({ ok: true })

    expect(await ask(outraEmpresa, 'live.watch', { workerId: ids.worker })).toEqual({ ok: false, error: 'not-live' })
    expect(await ask(outro, 'live.watch', { workerId: ids.worker })).toEqual({ ok: false, error: 'forbidden' })
    expect(await ask(painel, 'live.start')).toEqual({ ok: false, error: 'forbidden' })
    expect(await ask(painel, 'live.watch', { workerId: ids.worker2 })).toEqual({ ok: false, error: 'not-live' })
    expect(await ask(painel, 'live.watch', { nada: true })).toEqual({ ok: false, error: 'invalid' })

    expect(await ask(celular, 'live.stop')).toEqual({ ok: true })
  })

  it('no máximo três administradores assistem a mesma transmissão', async () => {
    const celular = await connect('worker')
    expect(await ask(celular, 'live.start')).toEqual({ ok: true })
    const paineis = [await connect('admin1'), await connect('admin2'), await connect('admin3'), await connect('admin4')]

    for (const painel of paineis.slice(0, 3)) {
      expect(await ask(painel, 'live.watch', { workerId: ids.worker })).toMatchObject({ ok: true })
    }
    expect(await ask(paineis[3], 'live.watch', { workerId: ids.worker })).toEqual({ ok: false, error: 'full' })

    // O painel que cai libera a vaga, e o celular é avisado para fechar a conexão dele.
    const saiu = next(celular, 'live.viewer-left')
    paineis[0].close()
    await saiu
    expect(await ask(paineis[3], 'live.watch', { workerId: ids.worker })).toMatchObject({ ok: true })

    expect(await ask(celular, 'live.stop')).toEqual({ ok: true })
  })

  it('parar avisa quem assiste e os administradores, e a lista esvazia', async () => {
    const celular = await connect('worker')
    const painel = await connect('admin1')
    const outroPainel = await connect('admin2')
    await ask(celular, 'live.start')
    const { sessionId } = await ask(painel, 'live.watch', { workerId: ids.worker })

    const encerrada = next(painel, 'live.ended')
    const parou = next(outroPainel, 'live.stopped')
    expect(await ask(celular, 'live.stop')).toEqual({ ok: true })
    expect(await encerrada).toEqual({ sessionId, workerId: ids.worker })
    expect(await parou).toEqual({ workerId: ids.worker })
    await live('admin1').expect(200, [])
  })

  it('celular que cai encerra a transmissão como se tivesse parado', async () => {
    const celular = await connect('worker')
    const painel = await connect('admin1')
    await ask(celular, 'live.start')
    const { sessionId } = await ask(painel, 'live.watch', { workerId: ids.worker })

    const encerrada = next(painel, 'live.ended')
    const parou = next(painel, 'live.stopped')
    celular.close()
    expect(await encerrada).toEqual({ sessionId, workerId: ids.worker })
    expect(await parou).toEqual({ workerId: ids.worker })
    await live('admin1').expect(200, [])
  })

  it('o mesmo funcionário ligando por outro socket substitui a transmissão e derruba quem assistia', async () => {
    const celularVelho = await connect('worker')
    const painel = await connect('admin1')
    await ask(celularVelho, 'live.start')
    const { sessionId } = await ask(painel, 'live.watch', { workerId: ids.worker })

    const celularNovo = await connect('worker')
    const encerrada = next(painel, 'live.ended')
    const fechar = next(celularVelho, 'live.closed')
    const religou = next(painel, 'live.started')
    expect(await ask(celularNovo, 'live.start')).toEqual({ ok: true })
    expect(await encerrada).toEqual({ sessionId, workerId: ids.worker })
    expect(await fechar).toEqual({ workerId: ids.worker })
    expect(await religou).toMatchObject({ workerId: ids.worker })

    // O painel volta a assistir e quem é chamado é o celular novo.
    const chamado = next(celularNovo, 'live.viewer')
    expect(await ask(painel, 'live.watch', { workerId: ids.worker })).toMatchObject({ ok: true })
    await chamado
    expect(await ask(celularNovo, 'live.stop')).toEqual({ ok: true })
  })

  it('o funcionário para de outro socket dele, e o aparelho que transmitia desliga', async () => {
    const celular = await connect('worker')
    await ask(celular, 'live.start')
    const outroSocket = await connect('worker')

    const fechar = next(celular, 'live.closed')
    expect(await ask(outroSocket, 'live.stop')).toEqual({ ok: true })
    expect(await fechar).toEqual({ workerId: ids.worker })
    await live('admin1').expect(200, [])
  })

  // O vídeo vai direto ao painel: tirar a sessão do registro não corta a
  // imagem. Quem corta é o celular, ao receber live.viewer-left. Estes dois
  // provam que perder o acesso com o socket aberto chega a esse aviso.
  describe('acesso revogado com a transmissão no ar', () => {
    const reativar = (who: keyof typeof emails) =>
      prisma.user.update({ where: { id: ids[who] }, data: { active: true } })

    it('administrador desativado deixa de assistir: o celular é mandado fechar a conexão dele', async () => {
      const celular = await connect('worker')
      const painel = await connect('admin1')
      await ask(celular, 'live.start')
      const { sessionId } = await ask(painel, 'live.watch', { workerId: ids.worker })
      try {
        const fechar = next(celular, 'live.viewer-left')
        await request(app.getHttpServer())
          .patch(`/users/${ids.admin1}`)
          .set({ Authorization: `Bearer ${tokens.admin2}` })
          .send({ active: false })
          .expect(200)
        expect(await fechar).toEqual({ sessionId })
        expect(await ask(celular, 'live.stop')).toEqual({ ok: true })
      } finally {
        await reativar('admin1')
      }
    })

    it('funcionário desativado para de transmitir: o painel vê a transmissão encerrada', async () => {
      const celular = await connect('worker')
      const painel = await connect('admin1')
      await ask(celular, 'live.start')
      const { sessionId } = await ask(painel, 'live.watch', { workerId: ids.worker })
      try {
        const encerrada = next(painel, 'live.ended')
        const parou = next(painel, 'live.stopped')
        await request(app.getHttpServer())
          .patch(`/users/${ids.worker}`)
          .set({ Authorization: `Bearer ${tokens.admin2}` })
          .send({ active: false })
          .expect(200)
        expect(await encerrada).toEqual({ sessionId, workerId: ids.worker })
        expect(await parou).toEqual({ workerId: ids.worker })
        await live('admin1').expect(200, [])
      } finally {
        await reativar('worker')
      }
    })
  })
})
