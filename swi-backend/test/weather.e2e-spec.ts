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
import { SITE_LOCATION } from '../src/weather/weather.types'

// CNPJs EXCLUSIVOS deste teste: o cleanup apaga por CNPJ, e um valor do seed
// ou de outra suíte apagaria a empresa de lá.
const CNPJ_A = '99000000000901'
const CNPJ_B = '99000000000902'

describe('Weather e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const email = 'weather-a@ex.com'
  const emails = {
    worker: email,
    admin: 'weather-admin@ex.com',
    otherAdmin: 'weather-admin-b@ex.com',
    loneAdmin: 'weather-admin-sem-empresa@ex.com',
  }
  let companyId: string, otherCompanyId: string

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
    companyId = (await prisma.company.create({ data: { name: 'Clima A', cnpj: CNPJ_A, ...addr } })).id
    otherCompanyId = (await prisma.company.create({ data: { name: 'Clima B', cnpj: CNPJ_B, ...addr } })).id
    const bcrypt = await import('bcrypt')
    const base = { passwordHash: await bcrypt.hash('test1234', 10), emailVerified: true, approvalStatus: 'APPROVED' as const }
    await prisma.user.create({ data: { email: emails.worker, name: 'Weather A', role: 'WORKER', companyId, ...base } })
    await prisma.user.create({ data: { email: emails.admin, name: 'Weather Admin', role: 'ADMIN', companyId, ...base } })
    await prisma.user.create({ data: { email: emails.otherAdmin, name: 'Weather Admin B', role: 'ADMIN', companyId: otherCompanyId, ...base } })
    await prisma.user.create({ data: { email: emails.loneAdmin, name: 'Weather Admin Solo', role: 'ADMIN', ...base } })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async (who: string = email) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email: who, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }

  it('sem token → 401', () => request(app.getHttpServer()).get('/weather').expect(401))

  it('com token → 200 + shape (dado real OU fallback canned)', async () => {
    const { body } = await request(app.getHttpServer()).get('/weather').set(await login()).expect(200)
    expect(typeof body.current.tempC).toBe('number')
    expect(typeof body.daily.maxC).toBe('number')
    expect(Array.isArray(body.alerts)).toBe(true)
    expect(typeof body.fetchedAt).toBe('string')
    // Campos novos, aditivos: quem lia só os antigos segue funcionando.
    expect(typeof body.stale).toBe('boolean')
    expect(typeof body.unavailable).toBe('boolean')
    expect(typeof body.demo).toBe('boolean')
  })

  describe('local do clima por empresa', () => {
    it('funcionário não lê nem configura o local (403)', async () => {
      const w = await login()
      await request(app.getHttpServer()).get('/weather/location').set(w).expect(403)
      await request(app.getHttpServer()).put('/weather/location').set(w).send({ lat: -3.1, lng: -60.02 }).expect(403)
      await request(app.getHttpServer()).delete('/weather/location').set(w).expect(403)
    })

    it('administrador sem empresa não tem local a configurar (403)', async () => {
      await request(app.getHttpServer()).get('/weather/location').set(await login(emails.loneAdmin)).expect(403)
    })

    it('coordenada inválida → 400, sem gravar nada', async () => {
      const a = await login(emails.admin)
      await request(app.getHttpServer()).put('/weather/location').set(a).send({ lat: 91, lng: 0 }).expect(400)
      await request(app.getHttpServer()).put('/weather/location').set(a).send({ lat: '-3.1', lng: -60.02 }).expect(400)
      const row = await prisma.company.findUnique({ where: { id: companyId } })
      expect(row).toMatchObject({ lat: null, lng: null })
    })

    it('ciclo: padrão → grava → lê → limpa, só na empresa do token', async () => {
      const a = await login(emails.admin)
      const server = app.getHttpServer()

      const { body: before } = await request(server).get('/weather/location').set(a).expect(200)
      expect(before).toEqual({ ...SITE_LOCATION, configured: false })

      const { body: saved } = await request(server).put('/weather/location').set(a).send({ lat: -3.1, lng: -60.02 }).expect(200)
      expect(saved).toEqual({ lat: -3.1, lng: -60.02, configured: true })
      expect(await prisma.company.findUnique({ where: { id: companyId } })).toMatchObject({ lat: -3.1, lng: -60.02 })
      // A outra empresa não muda.
      expect(await prisma.company.findUnique({ where: { id: otherCompanyId } })).toMatchObject({ lat: null, lng: null })
      const { body: other } = await request(server).get('/weather/location').set(await login(emails.otherAdmin)).expect(200)
      expect(other.configured).toBe(false)

      // O clima do funcionário da empresa segue respondendo, agora no local dela.
      await request(server).get('/weather').set(await login()).expect(200)

      const { body: cleared } = await request(server).delete('/weather/location').set(a).expect(200)
      expect(cleared).toEqual({ ...SITE_LOCATION, configured: false })
      expect(await prisma.company.findUnique({ where: { id: companyId } })).toMatchObject({ lat: null, lng: null })
    })
  })
})
