import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { TelemetryConditionService } from '../src/telemetry/alerts/condition.service'
import { SparseAssessmentService } from '../src/telemetry/assessment/sparse-assessment.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'
import { monitoredDayOf, monitoredDayWindow } from '../src/telemetry/domain/metric-state'
import { SUMMARIZER_VERSION } from '../src/telemetry/lifecycle/telemetry-summarizer'

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
    vivo: `telemetry-bt-vivo-${randomUUID()}@ex.com`,
  }
  let workerDia = ''
  let deviceDia = ''
  let workerVivo = ''
  let headersVivo: Record<string, string> = {}

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

    // O funcionário que fala pela rota, com credencial de verdade e um dia
    // fechado de repouso, como o do relógio no e2e das condições.
    workerVivo = await worker(emails.vivo)
    const secret = randomUUID().replace(/-/g, '')
    const deviceVivo = await prisma.telemetryDevice.create({
      data: { workerId: workerVivo, kind: 'ANDROID_PHONE', credentialHash: hashCredential(secret) },
    })
    headersVivo = { Authorization: `Device ${encodeCredential(deviceVivo.id, secret)}` }
    await prisma.telemetryDailySummary.create({
      data: {
        workerId: workerVivo,
        day: monitoredDayOf(new Date(Date.now() - 3 * DAY_MS)),
        origin: 'REAL',
        heartRateMin: 62,
        sampleCount: 10,
        summarizerVersion: SUMMARIZER_VERSION,
        computedAt: new Date(),
      },
    })
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

  describe('batimento ao vivo pela rota', () => {
    const post = (body: object) =>
      request(app.getHttpServer()).post('/telemetry/v1/batches').set(headersVivo).send(body).expect(200)

    let sequence = 0
    const beat = (session: string, at: Date, bpm: number, source: 'BLUETOOTH_HR' | 'HEALTH_CONNECT') => ({
      eventId: randomUUID(),
      monitoringSessionId: session,
      sequence: ++sequence,
      eventTime: at.toISOString(),
      origin: 'REAL',
      measurements: { heartRate: { value: bpm, unit: 'bpm', source } },
    })
    const sparseCount = () =>
      prisma.telemetryAssessment.count({ where: { workerId: workerVivo, formulaVersion: 'swi-fatigue-sparse-2' } })

    // Uma leitura aceita a cada 5 s, como a drenagem do app manda: 70 s cobrem
    // a janela de 60 s do batimento alto com folga nas duas pontas.
    const sessaoBluetooth = randomUUID()
    const fim = new Date(Date.now() - 1_000)
    const leituras = Array.from({ length: 15 }, (_, i) =>
      beat(sessaoBluetooth, new Date(fim.getTime() - (14 - i) * 5_000), 185, 'BLUETOOTH_HR'),
    )

    it('70 s de batimento alto pelo Bluetooth abrem a condição e o alerta, ao vivo', async () => {
      const { body } = await post({ events: leituras })

      expect(body.acceptedEventIds).toHaveLength(15)
      const snapshot = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: workerVivo } })
      expect(snapshot).toMatchObject({ heartRateBpm: 185, deviceKind: 'ANDROID_PHONE', sessionId: sessaoBluetooth })
      expect(snapshot.lastLiveEventTime?.toISOString()).toBe(fim.toISOString())

      const condicao = await prisma.telemetryCondition.findFirstOrThrow({
        where: { workerId: workerVivo, kind: 'HEART_RATE_HIGH', status: 'ACTIVE' },
      })
      expect(condicao.sessionId).toBe(sessaoBluetooth)
      expect(await prisma.operationalAlert.findUnique({ where: { conditionId: condicao.id } })).toMatchObject({
        status: 'OPEN',
      })
      // Cadeia ao vivo, e não a avaliação do dia da pulseira.
      expect(await sparseCount()).toBe(0)
      expect(await prisma.telemetryAssessment.count({ where: { workerId: workerVivo } })).toBeGreaterThanOrEqual(1)
    })

    it('120 s sem leitura viram perda de sinal, como no relógio', async () => {
      await app.get(TelemetryConditionService).sweepSilentSessions(new Date(fim.getTime() + 150_000))

      const batimento = await prisma.telemetryCondition.findFirstOrThrow({
        where: { workerId: workerVivo, kind: 'HEART_RATE_HIGH' },
      })
      expect(batimento).toMatchObject({ status: 'RECOVERED', recoveryReason: 'SIGNAL_LOST' })
      const perda = await prisma.telemetryCondition.findFirstOrThrow({
        where: { workerId: workerVivo, kind: 'DEVICE_SIGNAL_LOST', status: 'ACTIVE' },
      })
      expect(await prisma.operationalAlert.findUnique({ where: { conditionId: perda.id } })).toBeNull()
    })

    it('o lote do Health Connect que chega depois não troca a avaliação atual nem o carimbo ao vivo', async () => {
      const antes = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: workerVivo } })
      // Batimento de antes de a pulseira conectar: o app descarta o do Health
      // Connect dentro dos intervalos conectados, então o lote é mais velho.
      const sessaoLote = randomUUID()
      const tresHoras = Date.now() - 3 * 60 * 60_000
      const lote = [0, 10, 20].map((min) => beat(sessaoLote, new Date(tresHoras + min * 60_000), 95, 'HEALTH_CONNECT'))

      const { body } = await post({ events: lote })

      expect(body.acceptedEventIds).toHaveLength(3)
      expect(await sparseCount()).toBeGreaterThanOrEqual(1)
      // A mesma ordem com que o read model escolhe a avaliação atual.
      const atual = await prisma.telemetryAssessment.findFirstOrThrow({
        where: { workerId: workerVivo, origin: 'REAL' },
        orderBy: [{ windowEnd: 'desc' }, { computedAt: 'desc' }],
      })
      expect(atual.sessionId).toBe(sessaoBluetooth)
      expect(atual.formulaVersion).not.toBe('swi-fatigue-sparse-2')
      const snapshot = await prisma.telemetrySnapshot.findUniqueOrThrow({ where: { workerId: workerVivo } })
      expect(snapshot.lastLiveEventTime).toEqual(antes.lastLiveEventTime)
      expect(snapshot.heartRateBpm).toBe(185)
    })
  })
})
