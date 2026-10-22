import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TelemetryDeviceKind } from '@prisma/client'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { TelemetryConditionService } from '../src/telemetry/alerts/condition.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'

// E2E da palavra do aparelho nos avisos de aparelho. Quem usa o Android mede
// com a pulseira, quem usa o iPhone mede com o relógio, e o aviso de bateria e
// o de perda de sinal têm de dizer o aparelho que a pessoa tem no pulso. O que
// decide é o aparelho da sessão que abriu a condição, e isso só se prova com o
// Postgres guardando a sessão e o aparelho de verdade.
//
// CNPJ exclusivo deste spec, pelo mesmo motivo das outras suítes: reusar o de
// outra apagaria a empresa dela.
const CNPJ = '99000000002701'

describe('Telemetry device wording e2e', () => {
  let app: INestApplication
  let prisma: PrismaService

  const emails = {
    pulseira: `telemetry-wording-band-${randomUUID()}@ex.com`,
    relogio: `telemetry-wording-watch-${randomUUID()}@ex.com`,
    admin: `telemetry-wording-admin-${randomUUID()}@ex.com`,
  }
  let workerPulseira = ''
  let workerRelogio = ''
  let adminId = ''
  let headersPulseira: Record<string, string> = {}
  let headersRelogio: Record<string, string> = {}

  const enroll = async (workerId: string, kind: TelemetryDeviceKind) => {
    const secret = randomUUID().replace(/-/g, '')
    const device = await prisma.telemetryDevice.create({ data: { workerId, kind, credentialHash: hashCredential(secret) } })
    return { Authorization: `Device ${encodeCredential(device.id, secret)}` }
  }

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    const ids = users.map((u) => u.id)
    await prisma.profile.deleteMany({ where: { userId: { in: ids } } })
    await prisma.notification.deleteMany({ where: { workerId: { in: ids } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await prisma.company.deleteMany({ where: { cnpj: CNPJ } })
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    await cleanup()

    const endereco = { cep: '01000-000', street: 'Rua A', number: '1', neighborhood: 'Centro', uf: 'SP' }
    const companyId = (await prisma.company.create({ data: { name: 'Wording Co', cnpj: CNPJ, ...endereco } })).id
    const user = async (email: string, name: string, role: 'WORKER' | 'ADMIN') =>
      (
        await prisma.user.create({
          data: {
            email,
            name,
            passwordHash: 'nao-usado-neste-spec',
            role,
            emailVerified: true,
            approvalStatus: 'APPROVED',
            companyId,
            profile: { create: { birthDate: new Date('1991-05-10T00:00:00.000Z') } },
          },
        })
      ).id

    workerPulseira = await user(emails.pulseira, 'Pessoa da Pulseira', 'WORKER')
    workerRelogio = await user(emails.relogio, 'Pessoa do Relogio', 'WORKER')
    adminId = await user(emails.admin, 'Wording Admin', 'ADMIN')
    headersPulseira = await enroll(workerPulseira, 'ANDROID_PHONE')
    headersRelogio = await enroll(workerRelogio, 'IPHONE')
  })

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  const post = (headers: Record<string, string>, body: object) =>
    request(app.getHttpServer()).post('/telemetry/v1/batches').set(headers).send(body).expect(200)

  let sequence = 0
  const event = (session: string, at: Date, measurements: object) => ({
    eventId: randomUUID(),
    monitoringSessionId: session,
    sequence: ++sequence,
    eventTime: at.toISOString(),
    origin: 'REAL',
    measurements,
  })

  const adminTitles = async (workerId: string) => {
    const conditions = await prisma.telemetryCondition.findMany({ where: { workerId }, select: { id: true } })
    const rows = await prisma.notification.findMany({
      where: { workerId: adminId, domain: 'health', targetId: { in: conditions.map((c) => c.id) } },
      select: { title: true },
    })
    return rows.map((r) => r.title)
  }

  it('bateria baixa do relógio avisa o funcionário falando do relógio', async () => {
    await post(headersRelogio, {
      events: [event(randomUUID(), new Date(), { battery: { value: 12, unit: '%', source: 'APPLE_WATCH' } })],
    })

    const condicao = await prisma.telemetryCondition.findFirstOrThrow({
      where: { workerId: workerRelogio, kind: 'DEVICE_BATTERY_LOW', status: 'ACTIVE' },
    })
    const avisos = await prisma.notification.findMany({ where: { workerId: workerRelogio, targetId: condicao.id } })
    expect(avisos).toEqual([
      expect.objectContaining({
        title: 'Bateria do relógio baixa',
        body: 'Bateria em 12%. Carregue o relógio para seguir monitorado.',
      }),
    ])
  })

  it('perda de sinal avisa a administração com a pulseira no Android e o relógio no iPhone', async () => {
    const agora = new Date(Date.now() - 1_000)
    await post(headersPulseira, {
      events: [event(randomUUID(), agora, { heartRate: { value: 80, unit: 'bpm', source: 'BLUETOOTH_HR' } })],
    })
    await post(headersRelogio, {
      events: [event(randomUUID(), agora, { heartRate: { value: 80, unit: 'bpm', source: 'APPLE_WATCH' } })],
    })

    await app.get(TelemetryConditionService).sweepSilentSessions(new Date(agora.getTime() + 150_000))

    expect(await adminTitles(workerPulseira)).toEqual(['Sem sinal da pulseira: Pessoa da Pulseira'])
    expect(await adminTitles(workerRelogio)).toEqual(['Sem sinal do relógio: Pessoa do Relogio'])
  })
})
