import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { requireJwtSecret } from '../src/auth/jwt-secret'
import { PrismaService } from '../src/prisma/prisma.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'

// CNPJ exclusivo deste spec. Reusar o do seed apagaria a empresa demo.
const CNPJ = '99000000001101'

// E2E do estado do funcionário (ADR-0011): a cor do colega no mapa só existe
// com batimento válido, e a condição só pinta enquanto o dado que a sustenta
// vale. A fonte do batimento é gravada no snapshot pela ingestão, e é isso que
// só se prova com o Postgres respondendo de verdade.
describe('Telemetry worker status e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  let jwt: JwtService

  const emails = {
    admin: `status-admin-${randomUUID()}@ex.com`,
    viewer: `status-viewer-${randomUUID()}@ex.com`,
    subject: `status-subject-${randomUUID()}@ex.com`,
  }
  const ids = { admin: '', viewer: '', subject: '' }
  let deviceHeaders: Record<string, string> = {}
  let sequence = 0

  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const ago = (ms: number) => new Date(Date.now() - ms)
  const bearer = (id: string, role: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, role })}` })

  const beat = (at: Date, bpm: number, source: 'HEALTH_CONNECT' | 'BLUETOOTH_HR') => ({
    eventId: randomUUID(),
    monitoringSessionId: randomUUID(),
    sequence: ++sequence,
    eventTime: at.toISOString(),
    origin: 'REAL',
    measurements: { heartRate: { value: bpm, unit: 'bpm', source } },
  })
  const post = (events: object[]) =>
    request(app.getHttpServer()).post('/telemetry/v1/batches').set(deviceHeaders).send({ events }).expect(200)

  const colleagueStatus = async () => {
    const res = await request(app.getHttpServer())
      .get('/positions/colleagues')
      .set(bearer(ids.viewer, 'WORKER'))
      .expect(200)
    return (res.body as { id: string; status: string }[]).find((c) => c.id === ids.subject)?.status
  }
  /** O tempo passa no banco: o batimento promovido passa a ter a idade pedida. */
  const ageHeartRate = (ms: number) =>
    prisma.telemetrySnapshot.update({ where: { workerId: ids.subject }, data: { heartRateAt: ago(ms) } })

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    const userIds = users.map((u) => u.id)
    await prisma.notification.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.workerPosition.deleteMany({ where: { workerId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    jwt = new JwtService({ secret: requireJwtSecret() })
    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Status Co', cnpj: CNPJ, ...endereco } })).id
    const user = async (key: keyof typeof emails, role: 'ADMIN' | 'WORKER') => {
      ids[key] = (
        await prisma.user.create({
          data: {
            email: emails[key],
            name: key,
            passwordHash: 'nao-usado-neste-spec',
            role,
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId,
          },
        })
      ).id
    }
    await user('admin', 'ADMIN')
    await user('viewer', 'WORKER')
    await user('subject', 'WORKER')

    const secret = randomUUID().replace(/-/g, '')
    const device = await prisma.telemetryDevice.create({
      data: { workerId: ids.subject, kind: 'ANDROID_PHONE', credentialHash: hashCredential(secret) },
    })
    deviceHeaders = { Authorization: `Device ${encodeCredential(device.id, secret)}` }
    await prisma.workerPosition.create({
      data: { workerId: ids.subject, lat: -23.56, lng: -46.64, source: 'real', recordedAt: new Date() },
    })
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  it('batimento do Health Connect de 30 min é válido: o colega aparece com cor', async () => {
    await post([beat(ago(30 * MINUTE), 82, 'HEALTH_CONNECT')])

    const snapshot = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: ids.subject } })
    expect(snapshot.heartRateSource).toBe('HEALTH_CONNECT')
    expect(await colleagueStatus()).toBe('good')
  })

  it('batimento do Health Connect de mais de 60 min deixa o colega neutro', async () => {
    await ageHeartRate(61 * MINUTE)

    expect(await colleagueStatus()).toBe('unknown')
  })

  it('o Bluetooth é ao vivo: parado há 50 min, o colega fica neutro', async () => {
    await post([beat(ago(1_000), 90, 'BLUETOOTH_HR')])
    const snapshot = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: ids.subject } })
    expect(snapshot.heartRateSource).toBe('BLUETOOTH_HR')
    expect(await colleagueStatus()).toBe('good')

    await ageHeartRate(50 * MINUTE)

    expect(await colleagueStatus()).toBe('unknown')
  })

  describe('pressão aberta pinta por 6 h, e a leitura diz de quando é a medição', () => {
    const openPressureCondition = async (measuredAgoMs: number) => {
      await prisma.telemetryCondition.deleteMany({ where: { workerId: ids.subject } })
      const measuredAt = ago(measuredAgoMs)
      await prisma.telemetrySnapshot.update({
        where: { workerId: ids.subject },
        data: {
          heartRateAt: ago(10 * MINUTE),
          heartRateSource: 'HEALTH_CONNECT',
          systolicMmHg: 170,
          diastolicMmHg: 110,
          bloodPressureSource: 'HEALTH_CONNECT',
          bloodPressureAt: measuredAt,
        },
      })
      await prisma.telemetryCondition.create({
        data: {
          workerId: ids.subject,
          origin: 'REAL',
          kind: 'BLOOD_PRESSURE_HIGH',
          firstSeenAt: measuredAt,
          lastSeenAt: new Date(),
          thresholdProfile: 'e2e',
          observedValue: 170,
          thresholdValue: 160,
        },
      })
      return measuredAt.toISOString()
    }

    it('medida há 5 h, o colega aparece urgente', async () => {
      await openPressureCondition(5 * HOUR)

      expect(await colleagueStatus()).toBe('low')
    })

    it('medida há 7 h, a cor sai mas a condição continua na leitura com o instante medido', async () => {
      const measuredAt = await openPressureCondition(7 * HOUR)

      expect(await colleagueStatus()).toBe('good')

      const own = await request(app.getHttpServer())
        .get('/telemetry/v1/me/current')
        .set(bearer(ids.subject, 'WORKER'))
        .expect(200)
      expect(own.body.conditions).toEqual([expect.objectContaining({ kind: 'BLOOD_PRESSURE_HIGH', measuredAt })])

      const panel = await request(app.getHttpServer())
        .get('/telemetry/v1/admin/workers')
        .set(bearer(ids.admin, 'ADMIN'))
        .expect(200)
      const listed = (panel.body.workers as { worker: { id: string }; telemetry: { conditions: unknown[] } }[]).find(
        (w) => w.worker.id === ids.subject,
      )
      expect(listed?.telemetry.conditions).toEqual([
        expect.objectContaining({ kind: 'BLOOD_PRESSURE_HIGH', measuredAt }),
      ])
    })
  })
})
