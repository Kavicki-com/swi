// AppModule boota o MediaService (S3Client no construtor) → precisa dos MINIO_* setados antes do app.init(), mesmo num teste sem mídia.
process.env.MINIO_PUBLIC_URL ??= 'http://localhost:9000'
process.env.MINIO_ACCESS_KEY ??= 'minioadmin'
process.env.MINIO_SECRET_KEY ??= 'minioadmin'
process.env.MINIO_BUCKET ??= 'swi-media'

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

// CNPJs EXCLUSIVOS deste teste: o cleanup apaga por CNPJ, e um valor do seed
// ou de outra suíte apagaria a empresa de lá. As câmeras caem junto com a
// empresa.
const CNPJ_A = '99000000001001'
const CNPJ_B = '99000000001002'

describe('Cameras e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const emails = {
    worker: 'cameras-worker@ex.com',
    admin: 'cameras-admin@ex.com',
    otherAdmin: 'cameras-admin-b@ex.com',
    loneAdmin: 'cameras-admin-sem-empresa@ex.com',
  }
  let companyId: string

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const addr = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    companyId = (await prisma.company.create({ data: { name: 'Câmeras A', cnpj: CNPJ_A, ...addr } })).id
    const otherCompanyId = (await prisma.company.create({ data: { name: 'Câmeras B', cnpj: CNPJ_B, ...addr } })).id
    const bcrypt = await import('bcrypt')
    const base = { passwordHash: await bcrypt.hash('test1234', 10), emailVerified: true, approvalStatus: 'APPROVED' as const }
    await prisma.user.create({ data: { email: emails.worker, name: 'Cameras Worker', role: 'WORKER', companyId, ...base } })
    await prisma.user.create({ data: { email: emails.admin, name: 'Cameras Admin', role: 'ADMIN', companyId, ...base } })
    await prisma.user.create({ data: { email: emails.otherAdmin, name: 'Cameras Admin B', role: 'ADMIN', companyId: otherCompanyId, ...base } })
    await prisma.user.create({ data: { email: emails.loneAdmin, name: 'Cameras Admin Solo', role: 'ADMIN', ...base } })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async (who: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email: who, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }

  const portaria = { name: 'Portaria', lat: -3.1, lng: -60.02, url: 'https://cameras.exemplo.com.br/portaria' }

  it('sem token → 401', () => request(app.getHttpServer()).get('/cameras').expect(401))

  it('funcionário lê os pontos sem o endereço e não escreve (403)', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)
    const { body: created } = await request(server).post('/cameras').set(a).send({ ...portaria, name: 'Leitura do funcionário' }).expect(201)

    const w = await login(emails.worker)
    const { body } = await request(server).get('/cameras').set(w).expect(200)
    expect(body).toContainEqual({ id: created.id, name: 'Leitura do funcionário', lat: -3.1, lng: -60.02 })
    expect(body.every((c: Record<string, unknown>) => !('url' in c))).toBe(true)

    await request(server).post('/cameras').set(w).send(portaria).expect(403)
    await request(server).patch(`/cameras/${created.id as string}`).set(w).send({ name: 'X' }).expect(403)
    await request(server).delete(`/cameras/${created.id as string}`).set(w).expect(403)
    await request(server).delete(`/cameras/${created.id as string}`).set(a).expect(204)
  })

  it('administrador sem empresa: lista vazia e não cadastra (403)', async () => {
    const solo = await login(emails.loneAdmin)
    const { body } = await request(app.getHttpServer()).get('/cameras').set(solo).expect(200)
    expect(body).toEqual([])
    await request(app.getHttpServer()).post('/cameras').set(solo).send(portaria).expect(403)
  })

  it('corpo inválido → 400, sem gravar nada', async () => {
    const a = await login(emails.admin)
    const server = app.getHttpServer()
    await request(server).post('/cameras').set(a).send({ ...portaria, lat: 91 }).expect(400)
    await request(server).post('/cameras').set(a).send({ ...portaria, url: 'javascript:alert(1)' }).expect(400)
    await request(server).post('/cameras').set(a).send({ ...portaria, name: '   ' }).expect(400)
    expect(await prisma.camera.count({ where: { companyId } })).toBe(0)
  })

  it('ciclo: cadastra → lê → altera → limpa o endereço → exclui, só na empresa do token', async () => {
    const a = await login(emails.admin)
    const b = await login(emails.otherAdmin)
    const server = app.getHttpServer()

    const { body: created } = await request(server).post('/cameras').set(a).send({ ...portaria, name: '  Portaria  ' }).expect(201)
    expect(created).toMatchObject({ ...portaria, name: 'Portaria' })
    expect(typeof created.id).toBe('string')
    const id = created.id as string

    const { body: list } = await request(server).get('/cameras').set(a).expect(200)
    expect(list).toEqual([expect.objectContaining({ id, ...portaria })])

    // Nome repetido na mesma empresa → 409; na outra empresa é outro ponto.
    await request(server).post('/cameras').set(a).send(portaria).expect(409)
    await request(server).post('/cameras').set(b).send(portaria).expect(201)

    // A outra empresa não lê, não altera e não exclui.
    const { body: otherList } = await request(server).get('/cameras').set(b).expect(200)
    expect(otherList.map((c: { id: string }) => c.id)).not.toContain(id)
    await request(server).patch(`/cameras/${id}`).set(b).send({ name: 'Invadida' }).expect(404)
    await request(server).delete(`/cameras/${id}`).set(b).expect(404)

    const { body: moved } = await request(server).patch(`/cameras/${id}`).set(a).send({ name: 'Pátio', lat: -3.2 }).expect(200)
    expect(moved).toMatchObject({ id, name: 'Pátio', lat: -3.2, lng: -60.02, url: portaria.url })

    const { body: cleared } = await request(server).patch(`/cameras/${id}`).set(a).send({ url: null }).expect(200)
    expect(cleared.url).toBeNull()

    await request(server).delete(`/cameras/${id}`).set(a).expect(204)
    await request(server).delete(`/cameras/${id}`).set(a).expect(404)
    expect(await prisma.camera.count({ where: { companyId } })).toBe(0)
  })
})
