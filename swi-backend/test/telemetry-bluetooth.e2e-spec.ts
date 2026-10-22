import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { SparseAssessmentService } from '../src/telemetry/assessment/sparse-assessment.service'
import { hashCredential } from '../src/telemetry/devices/device-auth.service'
import { monitoredDayOf, monitoredDayWindow } from '../src/telemetry/domain/metric-state'

// E2E da pulseira lida pelo Bluetooth do celular Android. O mesmo celular manda
// o batimento ao vivo pelo Bluetooth e o resto em lote pelo Health Connect, e o
// que separa os dois caminhos é a origem gravada em cada amostra: isso só se
// prova com o Postgres respondendo às consultas de verdade.
describe('Telemetry Bluetooth e2e', () => {
  let app: INestApplication
  let prisma: PrismaService
  let sparse: SparseAssessmentService

  const emails = {
    dia: `telemetry-bt-dia-${randomUUID()}@ex.com`,
  }
  let workerDia = ''
  let deviceDia = ''

  const DAY_MS = 24 * 60 * 60 * 1000
  const day = monitoredDayOf(new Date(Date.now() - DAY_MS))
  const { start } = monitoredDayWindow(day)
  /** Minutos depois do meio-dia de ontem, em Brasília. */
  const t = (minutes: number) => new Date(start.getTime() + 12 * 60 * 60_000 + minutes * 60_000)

  const worker = async (email: string) =>
    (
      await prisma.user.create({
        data: {
          email,
          name: email,
          passwordHash: 'nao-usado-neste-spec',
          role: 'WORKER',
          emailVerified: true,
          approvalStatus: 'APPROVED',
          profile: { create: { birthDate: new Date('1991-05-10T00:00:00.000Z') } },
        },
      })
    ).id

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)
    sparse = app.get(SparseAssessmentService)

    workerDia = await worker(emails.dia)
    deviceDia = (
      await prisma.telemetryDevice.create({
        data: { workerId: workerDia, kind: 'ANDROID_PHONE', credentialHash: hashCredential(randomUUID()) },
      })
    ).id
  })

  afterAll(async () => {
    const workers = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true } })
    await prisma.profile.deleteMany({ where: { userId: { in: workers.map((w) => w.id) } } })
    await prisma.notification.deleteMany({ where: { workerId: { in: workers.map((w) => w.id) } } })
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } })
    await app.close()
  })

  it('a avaliação do dia lê só o batimento do Health Connect, nunca o do Bluetooth', async () => {
    const session = randomUUID()
    await prisma.telemetrySession.create({
      data: { id: session, deviceId: deviceDia, workerId: workerDia, origin: 'REAL', startedAt: t(0) },
    })
    const rows = [
      { at: t(0), bpm: 90, source: 'HEALTH_CONNECT' as const },
      { at: t(5), bpm: 92, source: null },
      { at: t(30), bpm: 170, source: 'BLUETOOTH_HR' as const },
      { at: t(31), bpm: 172, source: 'BLUETOOTH_HR' as const },
    ]
    let sequence = 0
    for (const row of rows) {
      await prisma.telemetrySample.create({
        data: {
          eventId: randomUUID(),
          sessionId: session,
          deviceId: deviceDia,
          workerId: workerDia,
          origin: 'REAL',
          sequence: ++sequence,
          eventTime: row.at,
          receivedAt: new Date(),
          heartRateBpm: row.bpm,
          heartRateSource: row.source,
          payload: {},
          payloadHash: randomUUID(),
        },
      })
    }

    const out = await sparse.assessDay(workerDia, 'REAL', day, new Date())

    expect(out.outcome).toBe('assessed')
    const assessment = await prisma.telemetryAssessment.findFirstOrThrow({
      where: { workerId: workerDia },
      orderBy: { computedAt: 'desc' },
    })
    // Amostra sem origem é anterior à coluna, e nenhuma delas veio do Bluetooth.
    expect(assessment.windowEnd.toISOString()).toBe(t(5).toISOString())
    expect((assessment.inputs as { window: { sampleCount: number } }).window.sampleCount).toBe(2)
  })
})
