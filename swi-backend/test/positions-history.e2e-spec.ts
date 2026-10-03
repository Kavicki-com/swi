import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import { PrismaService } from '../src/prisma/prisma.service'
import { aggregateHeat } from '../src/positions/position-history'

// Mapa de calor e colegas contra o Postgres de verdade: a grade do mapa de
// calor é calculada em SQL, e só o banco prova que ela bate com a regra pura
// de position-history.ts. O spec cria e apaga os próprios dados.

const CNPJ_A = '99000000000801'
const CNPJ_B = '99000000000802'

describe('Positions history e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  let jwt: JwtService

  const emails = {
    adminA: `pos-admin-a-${randomUUID()}@ex.com`,
    adminB: `pos-admin-b-${randomUUID()}@ex.com`,
    w1: `pos-w1-${randomUUID()}@ex.com`,
    w2: `pos-w2-${randomUUID()}@ex.com`,
    inactive: `pos-inactive-${randomUUID()}@ex.com`,
    other: `pos-other-${randomUUID()}@ex.com`,
  }
  const ids: Record<keyof typeof emails, string> = {
    adminA: '',
    adminB: '',
    w1: '',
    w2: '',
    inactive: '',
    other: '',
  }
  const bearer = (id: string, role: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role })}` })

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    const userIds = users.map((u) => u.id)
    await prisma.workerPositionSample.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.workerPosition.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    jwt = new JwtService({ secret: requireJwtSecret() })
    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyA = (await prisma.company.create({ data: { name: 'Pos A', cnpj: CNPJ_A, ...endereco } })).id
    const companyB = (await prisma.company.create({ data: { name: 'Pos B', cnpj: CNPJ_B, ...endereco } })).id
    const user = async (key: keyof typeof emails, role: 'ADMIN' | 'WORKER', companyId: string, active = true) => {
      ids[key] = (
        await prisma.user.create({
          data: {
            email: emails[key],
            name: key,
            passwordHash: 'nao-usado-neste-spec',
            role,
            emailVerified: true,
            approvalStatus: 'APPROVED',
            active,
            companyId,
          },
        })
      ).id
    }
    await user('adminA', 'ADMIN', companyA)
    await user('adminB', 'ADMIN', companyB)
    await user('w1', 'WORKER', companyA)
    await user('w2', 'WORKER', companyA)
    await user('inactive', 'WORKER', companyA, false)
    await user('other', 'WORKER', companyB)
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('o heartbeat grava a trilha com espaçamento: o mesmo ponto em seguida não duplica', async () => {
    await request(app.getHttpServer())
      .post('/positions/heartbeat')
      .set(bearer(ids.w1, 'WORKER'))
      .send({ lat: -23.55, lng: -46.63 })
      .expect(204)
    await request(app.getHttpServer())
      .post('/positions/heartbeat')
      .set(bearer(ids.w1, 'WORKER'))
      .send({ lat: -23.55, lng: -46.63 })
      .expect(204)
    const samples = await prisma.workerPositionSample.findMany({ where: { workerId: ids.w1 } })
    expect(samples).toHaveLength(1)
    expect(samples[0]).toMatchObject({ source: 'real', lat: -23.55, lng: -46.63 })
  })

  it('o mapa de calor do banco bate com a regra pura e fica na empresa do admin', async () => {
    const now = Date.now()
    const minute = 60_000
    const rows = [
      { workerId: ids.w1, lat: -23.5501, lng: -46.6301, recordedAt: new Date(now - 10 * minute) },
      { workerId: ids.w1, lat: -23.5501, lng: -46.6301, recordedAt: new Date(now - 10 * minute + 20_000) },
      { workerId: ids.w2, lat: -23.5502, lng: -46.6302, recordedAt: new Date(now - 10 * minute) },
      { workerId: ids.w2, lat: -23.5601, lng: -46.6401, recordedAt: new Date(now - 5 * minute) },
    ]
    await prisma.workerPositionSample.deleteMany({ where: { workerId: { in: [ids.w1, ids.w2] } } })
    const companyA = (await prisma.user.findUniqueOrThrow({ where: { id: ids.w1 } })).companyId
    await prisma.workerPositionSample.createMany({
      data: rows.map((r) => ({ ...r, companyId: companyA, source: 'real' })),
    })
    // Simulador e outra empresa no mesmo lugar: nenhum dos dois pode aparecer.
    await prisma.workerPositionSample.create({
      data: { workerId: ids.w2, companyId: companyA, lat: -23.5501, lng: -46.6301, source: 'sim', recordedAt: new Date(now - minute) },
    })
    const companyB = (await prisma.user.findUniqueOrThrow({ where: { id: ids.other } })).companyId
    await prisma.workerPositionSample.create({
      data: { workerId: ids.other, companyId: companyB, lat: -23.5501, lng: -46.6301, source: 'real', recordedAt: new Date(now - minute) },
    })

    const res = await request(app.getHttpServer())
      .get('/positions/heat')
      .set(bearer(ids.adminA, 'ADMIN'))
      .expect(200)

    const expected = aggregateHeat(rows)
    expect(res.body.cells).toHaveLength(expected.length)
    expect(res.body.cells.map((c: { weight: number }) => c.weight)).toEqual(expected.map((c) => c.weight))
    for (const [i, cell] of expected.entries()) {
      expect(res.body.cells[i].lat).toBeCloseTo(cell.lat, 9)
      expect(res.body.cells[i].lng).toBeCloseTo(cell.lng, 9)
    }
  })

  it('admin de outra empresa vê só a própria empresa', async () => {
    const res = await request(app.getHttpServer())
      .get('/positions/heat')
      .set(bearer(ids.adminB, 'ADMIN'))
      .expect(200)
    expect(res.body.cells).toEqual([{ lat: expect.any(Number), lng: expect.any(Number), weight: 1 }])
  })

  it('funcionário lê o mapa de calor da própria empresa, igual ao do admin', async () => {
    const admin = await request(app.getHttpServer()).get('/positions/heat').set(bearer(ids.adminA, 'ADMIN')).expect(200)
    const w1 = await request(app.getHttpServer()).get('/positions/heat').set(bearer(ids.w1, 'WORKER')).expect(200)
    expect(w1.body.cells).toEqual(admin.body.cells)
    expect(w1.body.cells.length).toBeGreaterThan(0)
    // Só células e peso: nada que identifique quem esteve onde.
    for (const cell of w1.body.cells) expect(Object.keys(cell).sort()).toEqual(['lat', 'lng', 'weight'])

    const other = await request(app.getHttpServer()).get('/positions/heat').set(bearer(ids.other, 'WORKER')).expect(200)
    expect(other.body.cells).toEqual([{ lat: expect.any(Number), lng: expect.any(Number), weight: 1 }])
  })

  // Janela estreita desfaz a agregação: um minuto de uma empresa pequena é a
  // posição de uma pessoa naquele minuto. O funcionário só lê a janela padrão.
  it('funcionário não escolhe a janela do mapa de calor', async () => {
    const from = new Date(Date.now() - 11 * 60_000).toISOString()
    const to = new Date(Date.now() - 9 * 60_000).toISOString()
    await request(app.getHttpServer()).get(`/positions/heat?from=${from}`).set(bearer(ids.w1, 'WORKER')).expect(403)
    await request(app.getHttpServer()).get(`/positions/heat?to=${to}`).set(bearer(ids.w1, 'WORKER')).expect(403)
    await request(app.getHttpServer())
      .get(`/positions/heat?from=${from}&to=${to}`)
      .set(bearer(ids.adminA, 'ADMIN'))
      .expect(200)
  })

  it('funcionário não pede o simulador: recusa pelo papel, com a homologação ligada ou não', async () => {
    await request(app.getHttpServer()).get('/positions/heat?source=all').set(bearer(ids.w1, 'WORKER')).expect(403)
  })

  it('funcionário não pede as posições do simulador nem com a homologação ligada', async () => {
    const previous = process.env.POSITIONS_HEAT_INCLUDE_SIM
    process.env.POSITIONS_HEAT_INCLUDE_SIM = '1'
    try {
      await request(app.getHttpServer())
        .get('/positions/heat?source=all')
        .set(bearer(ids.w1, 'WORKER'))
        .expect(403)
    } finally {
      if (previous === undefined) delete process.env.POSITIONS_HEAT_INCLUDE_SIM
      else process.env.POSITIONS_HEAT_INCLUDE_SIM = previous
    }
  })

  it('janela inválida é recusada', async () => {
    await request(app.getHttpServer())
      .get('/positions/heat?from=ontem')
      .set(bearer(ids.adminA, 'ADMIN'))
      .expect(400)
    await request(app.getHttpServer())
      .get('/positions/heat?source=all')
      .set(bearer(ids.adminA, 'ADMIN'))
      .expect(400)
  })

  it('com a homologação ligada, source=all inclui o simulador', async () => {
    const previous = process.env.POSITIONS_HEAT_INCLUDE_SIM
    process.env.POSITIONS_HEAT_INCLUDE_SIM = '1'
    try {
      const real = await request(app.getHttpServer()).get('/positions/heat').set(bearer(ids.adminA, 'ADMIN')).expect(200)
      const all = await request(app.getHttpServer())
        .get('/positions/heat?source=all')
        .set(bearer(ids.adminA, 'ADMIN'))
        .expect(200)
      const total = (cells: Array<{ weight: number }>) => cells.reduce((s, c) => s + c.weight, 0)
      expect(total(all.body.cells)).toBe(total(real.body.cells) + 1)
    } finally {
      if (previous === undefined) delete process.env.POSITIONS_HEAT_INCLUDE_SIM
      else process.env.POSITIONS_HEAT_INCLUDE_SIM = previous
    }
  })

  it('colegas: só os outros ativos da mesma empresa com posição recente', async () => {
    await prisma.workerPosition.deleteMany({ where: { workerId: { in: Object.values(ids) } } })
    const fresh = new Date()
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await prisma.workerPosition.createMany({
      data: [
        { workerId: ids.w1, lat: -23.55, lng: -46.63, source: 'real', recordedAt: fresh },
        { workerId: ids.w2, lat: -23.56, lng: -46.64, source: 'real', recordedAt: fresh },
        { workerId: ids.inactive, lat: -23.57, lng: -46.65, source: 'real', recordedAt: fresh },
        { workerId: ids.other, lat: -23.58, lng: -46.66, source: 'real', recordedAt: fresh },
      ],
    })

    const res = await request(app.getHttpServer())
      .get('/positions/colleagues')
      .set(bearer(ids.w1, 'WORKER'))
      .expect(200)
    expect(res.body.map((m: { id: string }) => m.id)).toEqual([ids.w2])
    // Colega sem aparelho pareado: sem estado, e não "bom".
    expect(res.body[0]).toMatchObject({ lat: -23.56, lng: -46.64, recordedAt: fresh.toISOString(), status: 'unknown' })

    await prisma.workerPosition.update({ where: { workerId: ids.w2 }, data: { recordedAt: old } })
    const stale = await request(app.getHttpServer())
      .get('/positions/colleagues')
      .set(bearer(ids.w1, 'WORKER'))
      .expect(200)
    expect(stale.body).toEqual([])
  })

  it('colegas exigem login', async () => {
    await request(app.getHttpServer()).get('/positions/colleagues').expect(401)
  })
})
