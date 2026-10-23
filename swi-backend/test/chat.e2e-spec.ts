import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { io, Socket } from 'socket.io-client'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Chat e2e', () => {
  let app: INestApplication, prisma: PrismaService, base: string
  const eA = 'chat-a@ex.com', eB = 'chat-b@ex.com', eC = 'chat-c@ex.com'
  // CNPJ exclusivo desta suíte: o cleanup apaga a empresa por CNPJ.
  const CNPJ_C = '99000000001301'
  let idA = '', idB = '', idC = '', convId = ''
  const key = (a: string, b: string) => [a, b].sort().join('#')
  const cpath = (id: string) => `/chat/conversations/${encodeURIComponent(id)}` // ids têm '#'
  const login = async (email: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return body.accessToken as string
  }
  // Cleanup robusto (sobrevive a re-runs): resolve users por email, apaga suas
  // mensagens + conversas (participants) e só então os users (FK Message.senderId).
  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: [eA, eB, eC] } } })
    const ids = users.map((u) => u.id)
    if (ids.length) {
      await prisma.notification.deleteMany({ where: { workerId: { in: ids } } }) // chat→notif cria linhas p/ o destinatário
      const convs = await prisma.conversation.findMany({ where: { participants: { hasSome: ids } } })
      const convIds = convs.map((c) => c.id)
      if (convIds.length) await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } })
      await prisma.message.deleteMany({ where: { senderId: { in: ids } } })
      if (convIds.length) await prisma.conversation.deleteMany({ where: { id: { in: convIds } } })
    }
    await prisma.user.deleteMany({ where: { email: { in: [eA, eB, eC] } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ_C } })
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
    const mk = async (email: string, name: string, companyId: string | null = null) =>
      (await prisma.user.create({ data: { email, name, companyId, passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' } })).id
    // A e B sem empresa, o mesmo balde; C é de uma empresa.
    idA = await mk(eA, 'Chat A'); idB = await mk(eB, 'Chat B')
    const company = await prisma.company.create({
      data: { name: 'Chat C Ltda', cnpj: CNPJ_C, cep: '01000-000', street: 'Rua C', number: '1', neighborhood: 'Centro', uf: 'SP' },
    })
    idC = await mk(eC, 'Chat C', company.id)
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

  it('2 primeiras mensagens concorrentes não dão 500 e convergem em 1 conversa', async () => {
    // Zera a conversa pra forçar o caminho de criação lazy sob corrida.
    await prisma.message.deleteMany({ where: { conversationId: convId } })
    await prisma.notification.deleteMany({ where: { workerId: { in: [idA, idB] } } })
    await prisma.conversation.deleteMany({ where: { id: convId } })
    const tA = await login(eA), tB = await login(eB)
    const send = (t: string, body: string) =>
      request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${t}` }).send({ body })
    const [rA, rB] = await Promise.all([send(tA, 'corrida A'), send(tB, 'corrida B')])
    // Invariante: nenhum 500 (aceita 201 nos dois — o perdedor da corrida re-busca e anexa).
    expect([rA.status, rB.status]).toEqual([201, 201])
    const convs = await prisma.conversation.findMany({ where: { id: convId } })
    expect(convs).toHaveLength(1) // exatamente 1 conversa, sem duplicata
    const { body: msgs } = await request(app.getHttpServer()).get(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).expect(200)
    expect(msgs.map((m: any) => m.body).sort()).toEqual(['corrida A', 'corrida B']) // ambas persistiram
  })

  it('N sends concorrentes acumulam o unread do destinatário sem lost-update', async () => {
    const N = 6
    const tA = await login(eA)
    // 1 login basta aqui (throttle desligado em test-env via skipIf no ThrottlerModule).
    // unreadBy é do documento da conversa, visível a QUALQUER participante (toConvDto),
    // então lemos o contador do B fetchando como A. Prova por delta (como o teste da journey):
    // seed fixa a base, N envios concorrentes A→B rodam o jsonb_set atômico → base + N exato.
    await request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'seed' }).expect(201)
    const { body: c0 } = await request(app.getHttpServer()).get('/chat/conversations').set({ Authorization: `Bearer ${tA}` }).expect(200)
    const base = c0.find((c: any) => c.id === convId).unreadBy[idB]
    // N envios concorrentes A→B
    await Promise.all(Array.from({ length: N }, (_, i) =>
      request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: `c${i}` }).expect(201),
    ))
    const { body: c1 } = await request(app.getHttpServer()).get('/chat/conversations').set({ Authorization: `Bearer ${tA}` }).expect(200)
    expect(c1.find((c: any) => c.id === convId).unreadBy[idB]).toBe(base + N) // exato +N — hoje seria < por lost-update
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

  it('body acima de 4000 chars → 400 (@MaxLength)', async () => {
    const tA = await login(eA)
    await request(app.getHttpServer()).post(`${cpath(convId)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'a'.repeat(4001) }).expect(400)
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

  it('diretório fica dentro da empresa, e quem não tem empresa só vê quem também não tem', async () => {
    const tA = await login(eA), tC = await login(eC)
    const { body: dirA } = await request(app.getHttpServer()).get('/chat/directory').set({ Authorization: `Bearer ${tA}` }).expect(200)
    expect(dirA.map((c: any) => c.workerId)).toContain(idB)
    expect(dirA.map((c: any) => c.workerId)).not.toContain(idC)
    const { body: dirC } = await request(app.getHttpServer()).get('/chat/directory').set({ Authorization: `Bearer ${tC}` }).expect(200)
    expect(dirC.map((c: any) => c.workerId)).not.toContain(idA)
    expect(dirC.map((c: any) => c.workerId)).not.toContain(idB)
  })

  it('mensagem para outra empresa responde 404 sem criar conversa; conversa antiga entre empresas some da lista e não abre', async () => {
    const tA = await login(eA)
    const cross = key(idA, idC)
    await request(app.getHttpServer()).post(`${cpath(cross)}/messages`).set({ Authorization: `Bearer ${tA}` }).send({ body: 'oi C' }).expect(404)
    expect(await prisma.conversation.findUnique({ where: { id: cross } })).toBeNull()

    // Conversa de quando A e C ainda podiam conversar: fica no banco, mas não
    // aparece nem aceita leitura.
    await prisma.conversation.create({
      data: { id: cross, participants: [idA, idC], participantNames: ['Chat A', 'Chat C'], participantSubtitles: ['', ''], participantAvatarKeys: ['', ''], unreadByJson: {} },
    })
    const { body: convs } = await request(app.getHttpServer()).get('/chat/conversations').set({ Authorization: `Bearer ${tA}` }).expect(200)
    expect(convs.map((c: any) => c.id)).not.toContain(cross)
    await request(app.getHttpServer()).get(`${cpath(cross)}/messages`).set({ Authorization: `Bearer ${tA}` }).expect(404)
    await request(app.getHttpServer()).post(`${cpath(cross)}/read`).set({ Authorization: `Bearer ${tA}` }).expect(404)
    expect(await prisma.conversation.findUnique({ where: { id: cross } })).not.toBeNull()
  })
})

// Tipo sanguíneo e alergias do colega são dado de saúde: no diretório, só quem
// tem users.read (ADMIN e SUPERVISOR) recebe. O funcionário recebe null nos
// dois, e idade e gênero seguem iguais para todos.
//
// CNPJ exclusivo deste bloco: o cleanup apaga por CNPJ.
describe('Chat e2e: saúde no diretório', () => {
  let app: INestApplication, prisma: PrismaService
  const CNPJ = '99000000001302'
  const emails = {
    alvo: 'chat-saude-alvo@ex.com',
    worker: 'chat-saude-worker@ex.com',
    supervisor: 'chat-saude-sup@ex.com',
    admin: 'chat-saude-admin@ex.com',
  }
  let idAlvo = ''

  const cleanup = async () => {
    await prisma.profile.deleteMany({ where: { user: { email: { in: Object.values(emails) } } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }
  const diretorioDe = async (email: string) => {
    const { body: auth } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    const { body } = await request(app.getHttpServer()).get('/chat/directory').set({ Authorization: `Bearer ${auth.accessToken as string}` }).expect(200)
    return body as Array<Record<string, unknown>>
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const company = await prisma.company.create({
      data: { name: 'Chat Saude Ltda', cnpj: CNPJ, cep: '01000-000', street: 'Rua S', number: '1', neighborhood: 'Centro', uf: 'SP' },
    })
    const bcrypt = await import('bcrypt')
    const base = { passwordHash: await bcrypt.hash('test1234', 10), emailVerified: true, approvalStatus: 'APPROVED' as const, companyId: company.id }
    idAlvo = (await prisma.user.create({
      data: {
        email: emails.alvo, name: 'Alvo', role: 'WORKER', ...base,
        profile: { create: { birthDate: new Date('1990-05-04T00:00:00.000Z'), bloodType: 'O-', allergies: 'Dipirona', gender: 'female' } },
      },
    })).id
    const outros: Array<[string, 'WORKER' | 'SUPERVISOR' | 'ADMIN']> = [
      [emails.worker, 'WORKER'],
      [emails.supervisor, 'SUPERVISOR'],
      [emails.admin, 'ADMIN'],
    ]
    for (const [email, role] of outros) await prisma.user.create({ data: { email, name: email, role, ...base } })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  it.each([
    ['admin', 'O-', 'Dipirona'],
    ['supervisor', 'O-', 'Dipirona'],
    ['worker', null, null],
  ] as const)('o %s vê o colega com tipo sanguíneo %s e alergias %s', async (quem, bloodType, allergies) => {
    const alvo = (await diretorioDe(emails[quem])).find((c) => c.workerId === idAlvo)
    expect(alvo).toBeDefined()
    expect(alvo!.bloodType).toBe(bloodType)
    expect(alvo!.allergies).toBe(allergies)
    expect(alvo!.birthDate).toBe('1990-05-04T00:00:00.000Z')
    expect(alvo!.gender).toBe('female')
  })
})
