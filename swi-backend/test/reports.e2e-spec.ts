import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Reports e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'reports-e2e@ex.com'
  // ValidationPipe (whitelist) vem do APP_PIPE global no AppModule.

  const login = async () => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken}` }
  }
  const cleanup = async () => {
    const reports = await prisma.report.findMany({ where: { author: { email } }, select: { id: true } })
    const rids = reports.map((r) => r.id)
    if (rids.length) await prisma.notification.deleteMany({ where: { targetId: { in: rids } } })
    await prisma.report.deleteMany({ where: { author: { email } } })
    await prisma.user.deleteMany({ where: { email } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const bcrypt = await import('bcrypt')
    await prisma.user.create({
      data: { email, name: 'Reports E2E', passwordHash: await bcrypt.hash('test1234', 10), role: 'WORKER', emailVerified: true, approvalStatus: 'APPROVED' },
    })
  })
  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('reports sem token → 401', () => request(app.getHttpServer()).get('/reports').expect(401))

  // O presign é PUT, não POST, porque o R2 não implementa presigned POST. Por
  // isso não existe `fields`, que era a policy do form POST: a resposta é
  // url mais key.
  // O contentLength passou a ser obrigatório porque entra na ASSINATURA, então
  // o upload só passa com exatamente aqueles bytes; omiti-lo dá 400 no
  // ValidationPipe, que era o 400 que este teste vinha recebendo.
  it('media presign devolve url + key namespaced', async () => {
    const auth = await login()
    const { body } = await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType: 'image/jpeg', contentLength: 1024 }).expect(201)
    expect(typeof body.url).toBe('string')
    expect(body.fields).toBeUndefined()
    expect(body.key).toMatch(/^reports\/[0-9a-f-]{36}\.jpg$/)
  })

  // PDF virou anexo válido de relatório; txt continua só em exames.
  it('presign rejeita content-type inválido → 400', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType: 'text/plain', contentLength: 1024 }).expect(400)
  })

  // Anexo multimídia: vídeo, áudio e pdf sobem sob reports/, cada um com teto
  // próprio validado antes de assinar. Vídeo e áudio passam dos 15 MB da imagem.
  it('presign aceita vídeo, áudio e pdf no relatório, com a extensão certa', async () => {
    const auth = await login()
    const MB = 1024 * 1024
    const casos: Array<[string, number, string]> = [
      ['video/mp4', 90 * MB, 'mp4'],
      ['audio/mpeg', 20 * MB, 'mp3'],
      ['application/pdf', 10 * MB, 'pdf'],
    ]
    for (const [contentType, contentLength, ext] of casos) {
      const { body } = await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType, contentLength }).expect(201)
      expect(body.key).toMatch(new RegExp(`^reports/[0-9a-f-]{36}\\.${ext}$`))
    }
  })

  it('presign recusa áudio acima de 25 MB → 400', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post('/media/presign').set(auth).send({ contentType: 'audio/mpeg', contentLength: 25 * 1024 * 1024 + 1 }).expect(400)
  })

  it('relatório com vídeo devolve o anexo em attachments e fora de images', async () => {
    const auth = await login()
    const video = 'reports/123e4567-e89b-12d3-a456-426614174000.mp4'
    const { body: r } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'Com vídeo', imageKeys: [video] }).expect(201)
    const { body: one } = await request(app.getHttpServer()).get(`/reports/${r.id}`).set(auth).expect(200)
    expect(one.images).toEqual([])
    expect(one.imageKeys).toEqual([video])
    expect(one.attachments).toEqual([expect.objectContaining({ key: video, contentType: 'video/mp4', kind: 'video' })])
  })

  it('create → list newest-first + get by id', async () => {
    const auth = await login()
    const { body: r1 } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R1' }).expect(201)
    const { body: r2 } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'R2', responsibles: ['Ana'] }).expect(201)
    const { body: list } = await request(app.getHttpServer()).get('/reports').set(auth).expect(200)
    // Ordem relativa (robusto a outros dados no inbox org-wide): R2 antes de R1.
    const i1 = list.findIndex((r: any) => r.id === r1.id)
    const i2 = list.findIndex((r: any) => r.id === r2.id)
    expect(i1).toBeGreaterThanOrEqual(0)
    expect(i2).toBeGreaterThanOrEqual(0)
    expect(i2).toBeLessThan(i1) // mais recente primeiro
    const { body: one } = await request(app.getHttpServer()).get(`/reports/${r2.id}`).set(auth).expect(200)
    expect(one.title).toBe('R2')
    expect(one.responsibles).toEqual(['Ana'])
  })

  // O painel mostra Excluir ao supervisor autor: lista e detalhe dizem quem é
  // o autor pelo id do usuário, o mesmo que o servidor confere ao excluir.
  it('lista e detalhe trazem o authorId do usuário autor', async () => {
    const auth = await login()
    const me = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
    const { body: r } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'Meu' }).expect(201)
    const { body: list } = await request(app.getHttpServer()).get('/reports').set(auth).expect(200)
    expect(list.find((x: any) => x.id === r.id).authorId).toBe(me.id)
    const { body: one } = await request(app.getHttpServer()).get(`/reports/${r.id}`).set(auth).expect(200)
    expect(one.authorId).toBe(me.id)
  })

  it('get inexistente → 404', async () => {
    const auth = await login()
    await request(app.getHttpServer()).get('/reports/nao-existe').set(auth).expect(404)
  })

  it('whitelist descarta status/authorId (anti mass-assignment)', async () => {
    const auth = await login()
    const { body } = await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'Hack', status: 'accept', authorId: 'outro' }).expect(201)
    expect(body.status).toBe('pending') // default do server, não o enviado
    const me = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
    expect(body.authorId).toBe(me.id) // o autor é o do token, não o enviado
  })

  it('rejeita imageKey fora do padrão reports/<uuid> (400)', async () => {
    const auth = await login()
    await request(app.getHttpServer()).post('/reports').set(auth).send({ title: 'X', imageKeys: ['../secret.png'] }).expect(400)
  })
})

// Quem edita relatório: o autor e, do painel, o ADMIN e o SUPERVISOR da mesma
// empresa. Antes bastava ser da empresa, e qualquer funcionário reescrevia o
// relatório de outro. Fora da empresa segue 404, como no resto do módulo.
//
// CNPJs exclusivos deste bloco: o cleanup apaga por CNPJ.
describe('Reports e2e: quem edita', () => {
  let app: INestApplication, prisma: PrismaService
  const CNPJ = '99000000002702'
  const OUTRO_CNPJ = '99000000002703'
  const emails = {
    autor: 'reports-edit-autor@ex.com',
    colega: 'reports-edit-colega@ex.com',
    supervisor: 'reports-edit-sup@ex.com',
    admin: 'reports-edit-admin@ex.com',
    intruso: 'reports-edit-intruso@ex.com',
  }

  const cleanup = async () => {
    const reports = await prisma.report.findMany({ where: { author: { email: { in: Object.values(emails) } } }, select: { id: true } })
    const rids = reports.map((r) => r.id)
    if (rids.length) await prisma.notification.deleteMany({ where: { targetId: { in: rids } } })
    await prisma.report.deleteMany({ where: { id: { in: rids } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ, OUTRO_CNPJ] } } })
  }

  const login = async (who: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email: who, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Edita Co', cnpj: CNPJ, ...endereco } })).id
    const outraId = (await prisma.company.create({ data: { name: 'Outra Co', cnpj: OUTRO_CNPJ, ...endereco } })).id
    const bcrypt = await import('bcrypt')
    const base = { passwordHash: await bcrypt.hash('test1234', 10), emailVerified: true, approvalStatus: 'APPROVED' as const }
    const users: Array<[string, 'WORKER' | 'SUPERVISOR' | 'ADMIN', string]> = [
      [emails.autor, 'WORKER', companyId],
      [emails.colega, 'WORKER', companyId],
      [emails.supervisor, 'SUPERVISOR', companyId],
      [emails.admin, 'ADMIN', companyId],
      [emails.intruso, 'SUPERVISOR', outraId],
    ]
    for (const [email, role, company] of users) {
      await prisma.user.create({ data: { email, name: email, role, companyId: company, ...base } })
    }
  })
  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const novoRelatorio = async () => {
    const { body } = await request(app.getHttpServer()).post('/reports').set(await login(emails.autor)).send({ title: 'Original' }).expect(201)
    return body.id as string
  }
  const editar = async (who: string, id: string, title: string, status: number) =>
    request(app.getHttpServer()).patch(`/reports/${id}`).set(await login(who)).send({ title }).expect(status)

  it('o autor edita o próprio relatório', async () => {
    const id = await novoRelatorio()
    const { body } = await editar(emails.autor, id, 'Do autor', 200)
    expect(body.title).toBe('Do autor')
  })

  it('outro funcionário da mesma empresa recebe 403 e o relatório fica como estava', async () => {
    const id = await novoRelatorio()
    await editar(emails.colega, id, 'Do colega', 403)
    expect((await prisma.report.findUniqueOrThrow({ where: { id } })).title).toBe('Original')
  })

  it.each([
    ['supervisor', emails.supervisor],
    ['admin', emails.admin],
  ])('o %s da mesma empresa edita relatório de outra pessoa', async (_quem, email) => {
    const id = await novoRelatorio()
    const { body } = await editar(email, id, `Do painel ${email}`, 200)
    expect(body.title).toBe(`Do painel ${email}`)
  })

  it('supervisor de outra empresa recebe 404 e o relatório fica como estava', async () => {
    const id = await novoRelatorio()
    await editar(emails.intruso, id, 'Do intruso', 404)
    expect((await prisma.report.findUniqueOrThrow({ where: { id } })).title).toBe('Original')
  })
})
