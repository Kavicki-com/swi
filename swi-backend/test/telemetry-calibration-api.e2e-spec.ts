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

// As rotas de calibração de ponta a ponta: matriz de permissões (faixa pelo
// painel, trava só pelo admin), escopo de empresa, validação e histórico
// contra o banco real. O recálculo em si está em telemetry-calibration.e2e.
//
// CNPJs EXCLUSIVOS deste teste: o cleanup apaga por CNPJ.
const CNPJ_A = '99000000002201'
const CNPJ_B = '99000000002202'

describe('Calibração: rotas do painel e2e', () => {
  let app: INestApplication, prisma: PrismaService
  const emails = {
    admin: 'calib-api-admin@ex.com',
    supervisor: 'calib-api-sup@ex.com',
    worker: 'calib-api-worker@ex.com',
    outro: 'calib-api-outro-admin@ex.com',
  }
  const ids: Record<string, string> = {}

  // Calibração, faixas, travas e histórico caem em cascata com o usuário.
  const cleanup = async () => {
    await prisma.profile.deleteMany({ where: { user: { email: { in: Object.values(emails) } } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B] } } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication(); await app.init()
    prisma = app.get(PrismaService)
    await cleanup()
    const addr = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyA = (await prisma.company.create({ data: { name: 'Calib A', cnpj: CNPJ_A, ...addr } })).id
    const companyB = (await prisma.company.create({ data: { name: 'Calib B', cnpj: CNPJ_B, ...addr } })).id
    const bcrypt = await import('bcrypt')
    const base = { passwordHash: await bcrypt.hash('test1234', 10), emailVerified: true, approvalStatus: 'APPROVED' as const }
    const user = async (email: string, name: string, role: 'ADMIN' | 'SUPERVISOR' | 'WORKER', companyId: string) =>
      (await prisma.user.create({ data: { email, name, role, companyId, ...base } })).id
    ids.admin = await user(emails.admin, 'Ana Admin', 'ADMIN', companyA)
    ids.supervisor = await user(emails.supervisor, 'Sara Supervisora', 'SUPERVISOR', companyA)
    ids.worker = await user(emails.worker, 'Fábio Funcionário', 'WORKER', companyA)
    ids.outro = await user(emails.outro, 'Outro Admin', 'ADMIN', companyB)

    const now = new Date()
    await prisma.workerCalibration.create({
      data: {
        workerId: ids.worker,
        version: 'swi-calibration-1',
        deviceFamily: 'WATCH',
        phaseStartedAt: new Date('2026-09-01T00:00:00.000Z'),
        validDays: 12,
        restingBpm: 62,
        computedAt: now,
      },
    })
    await prisma.workerCalibrationBand.create({
      data: {
        workerId: ids.worker,
        metric: 'HEART_RATE',
        validDays: 12,
        startCuts: { excellence: null, fatigue: 160 },
        learnedCuts: { excellence: 68, fatigue: 152 },
        computedAt: now,
      },
    })
  })
  afterAll(async () => { await cleanup(); await app.close() })

  const login = async (who: string) => {
    const { body } = await request(app.getHttpServer()).post('/auth/login').send({ email: who, password: 'test1234' }).expect(200)
    return { Authorization: `Bearer ${body.accessToken as string}` }
  }
  const base = () => `/telemetry/v1/workers/${ids.worker}/calibration`
  const metricOf = (body: any, metric: string) => body.metrics.find((m: { metric: string }) => m.metric === metric)
  const ruleOf = (body: any, rule: string) => body.safety.find((s: { rule: string }) => s.rule === rule)

  it('o detalhe traz fase, régua, as 11 medições e as 5 travas', async () => {
    const { body } = await request(app.getHttpServer()).get(base()).set(await login(emails.supervisor)).expect(200)
    expect(body).toMatchObject({ workerId: ids.worker, phase: 'CALIBRATING', day: 13, deviceFamily: 'WATCH', ruler: { restingBpm: 62 } })
    expect(body.metrics).toHaveLength(11)
    expect(metricOf(body, 'HEART_RATE')).toMatchObject({ source: 'LEARNED', effective: { excellence: 68, fatigue: 152 } })
    expect(metricOf(body, 'STEPS')).toMatchObject({ source: 'START', validDays: 0 })
    expect(body.safety).toHaveLength(5)
    expect(ruleOf(body, 'HEART_RATE_LOW')).toMatchObject({ custom: false, defaultValues: { openAt: 47, closeAt: 57 } })
  })

  it('admin e supervisor corrigem a faixa; DELETE volta ao aprendido', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)
    const s = await login(emails.supervisor)

    const { body: corrigido } = await request(server).put(`${base()}/bands/HEART_RATE`).set(a)
      .send({ cuts: { excellence: 70, fatigue: 150 } }).expect(200)
    expect(metricOf(corrigido, 'HEART_RATE')).toMatchObject({ source: 'OVERRIDE', effective: { excellence: 70, fatigue: 150 } })

    // Medição sem linha ainda: nasce da partida mínima com a correção.
    const { body: sistolica } = await request(server).put(`${base()}/bands/SYSTOLIC`).set(s)
      .send({ cuts: { excellence: 110, fatigue: 135 } }).expect(200)
    expect(metricOf(sistolica, 'SYSTOLIC')).toMatchObject({
      source: 'OVERRIDE',
      validDays: 0,
      learned: { excellence: 120, fatigue: 140 },
      effective: { excellence: 110, fatigue: 135 },
    })

    const { body: revertido } = await request(server).delete(`${base()}/bands/HEART_RATE`).set(s).expect(200)
    expect(metricOf(revertido, 'HEART_RATE')).toMatchObject({ source: 'LEARNED', override: null, effective: { excellence: 68, fatigue: 152 } })
    // Repetir não muda nada nem grava histórico.
    await request(server).delete(`${base()}/bands/HEART_RATE`).set(s).expect(200)
  })

  it('corte invertido, medição ou trava desconhecida e corpo sem objeto respondem 400', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)
    const { body } = await request(server).put(`${base()}/bands/HEART_RATE`).set(a)
      .send({ cuts: { excellence: 150, fatigue: 70 } }).expect(400)
    expect(body.message).toMatch(/excelência deve ficar abaixo/)
    await request(server).put(`${base()}/bands/NAO_EXISTE`).set(a).send({ cuts: { excellence: 1, fatigue: 2 } }).expect(400)
    await request(server).put(`${base()}/bands/HEART_RATE`).set(a).send({ cuts: 5 }).expect(400)
    await request(server).put(`${base()}/safety/NAO_EXISTE`).set(a).send({ values: { openAt: 1, closeAt: 2 } }).expect(400)
    await request(server).put(`${base()}/safety/OXYGEN_LOW`).set(a).send({ values: { openAt: 50, closeAt: 60 } }).expect(400)
  })

  it('a trava é só do admin: supervisor e funcionário recebem 403', async () => {
    const server = app.getHttpServer()
    const s = await login(emails.supervisor)
    const w = await login(emails.worker)
    await request(server).put(`${base()}/safety/OXYGEN_LOW`).set(s).send({ values: { openAt: 88, closeAt: 92 } }).expect(403)
    await request(server).delete(`${base()}/safety/OXYGEN_LOW`).set(s).expect(403)
    await request(server).get(base()).set(w).expect(403)
    await request(server).put(`${base()}/bands/HEART_RATE`).set(w).send({ cuts: { excellence: 70, fatigue: 150 } }).expect(403)
  })

  it('o admin grava e remove a trava', async () => {
    const server = app.getHttpServer()
    const a = await login(emails.admin)
    const { body: gravada } = await request(server).put(`${base()}/safety/OXYGEN_LOW`).set(a)
      .send({ values: { openAt: 88, closeAt: 92 } }).expect(200)
    expect(ruleOf(gravada, 'OXYGEN_LOW')).toMatchObject({ custom: true, effective: { openAt: 88, closeAt: 92 } })
    const { body: removida } = await request(server).delete(`${base()}/safety/OXYGEN_LOW`).set(a).expect(200)
    expect(ruleOf(removida, 'OXYGEN_LOW')).toMatchObject({ custom: false, updatedAt: null })
    expect(await prisma.workerSafetyLimit.count({ where: { workerId: ids.worker } })).toBe(0)
  })

  it('o histórico traz as quatro ações, do mais novo ao mais antigo, com o nome de quem fez', async () => {
    const { body } = await request(app.getHttpServer()).get(`${base()}/history`).set(await login(emails.supervisor)).expect(200)
    expect(body.nextCursor).toBeNull()
    expect(body.items.map((i: { action: string }) => i.action)).toEqual([
      'SAFETY_REVERT',
      'SAFETY_SET',
      'BAND_REVERT',
      'BAND_OVERRIDE',
      'BAND_OVERRIDE',
    ])
    expect(body.items[0]).toMatchObject({ rule: 'OXYGEN_LOW', from: { openAt: 88, closeAt: 92 }, to: null, actor: { id: ids.admin, name: 'Ana Admin' } })
    expect(body.items[2]).toMatchObject({ metric: 'HEART_RATE', from: { excellence: 70, fatigue: 150 }, to: null, actor: { name: 'Sara Supervisora' } })
    expect(body.items[4]).toMatchObject({ metric: 'HEART_RATE', from: null, to: { excellence: 70, fatigue: 150 } })

    // Cursor: a página seguinte começa depois do item informado.
    const { body: next } = await request(app.getHttpServer()).get(`${base()}/history?cursor=${body.items[1].id as string}`)
      .set(await login(emails.admin)).expect(200)
    expect(next.items.map((i: { action: string }) => i.action)).toEqual(['BAND_REVERT', 'BAND_OVERRIDE', 'BAND_OVERRIDE'])
    await request(app.getHttpServer()).get(`${base()}/history?cursor=nao-uuid`).set(await login(emails.admin)).expect(400)
  })

  it('outra empresa e id que não é funcionário respondem o mesmo 404', async () => {
    const server = app.getHttpServer()
    const o = await login(emails.outro)
    const a = await login(emails.admin)
    const res = await request(server).get(base()).set(o).expect(404)
    expect(res.body.message).toBe('Funcionário não encontrado')
    await request(server).put(`${base()}/bands/HEART_RATE`).set(o).send({ cuts: { excellence: 70, fatigue: 150 } }).expect(404)
    await request(server).delete(`${base()}/safety/OXYGEN_LOW`).set(o).expect(404)
    await request(server).get(`/telemetry/v1/workers/${ids.supervisor}/calibration`).set(a).expect(404)
    await request(server).get('/telemetry/v1/workers/00000000-0000-0000-0000-000000000000/calibration').set(a).expect(404)
  })
})
