import { randomUUID } from 'node:crypto'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'
import { encodeCredential, hashCredential } from '../src/telemetry/devices/device-auth.service'
import { MAX_BATCH_EVENTS } from '../src/telemetry/ingestion/dto/telemetry-batch.dto'

// E2E de verdade porque o que a Task 5 promete só existe com HTTP e Postgres
// juntos: o guard trocando credencial por identidade, o índice único
// sustentando a idempotência e a sessão nascendo do primeiro evento. Com Prisma
// mockado, os três viram promessa do autor do mock.
describe('Telemetry ingestion e2e', () => {
  let app: INestApplication
  let prisma: PrismaService

  const emailA = `telemetry-ingest-a-${randomUUID()}@ex.com`
  const emailB = `telemetry-ingest-b-${randomUUID()}@ex.com`
  const emails = [emailA, emailB]

  let workerA = ''
  let workerB = ''
  let headersA: Record<string, string> = {}
  let headersB: Record<string, string> = {}

  const post = (headers: Record<string, string>, body: object) =>
    request(app.getHttpServer()).post('/telemetry/v1/batches').set(headers).send(body)

  let sequence = 0
  const event = (over: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    monitoringSessionId: randomUUID(),
    sequence: ++sequence,
    eventTime: new Date(Date.now() - 5_000).toISOString(),
    origin: 'REAL',
    measurements: { heartRate: { value: 82, unit: 'bpm', source: 'APPLE_WATCH' } },
    ...over,
  })

  // Dispositivo criado direto no banco: o caminho do pareamento é assunto do
  // spec de enrollment, e repeti-lo aqui só acrescentaria maneiras de falhar.
  const enroll = async (workerId: string) => {
    const secret = randomUUID().replace(/-/g, '')
    const device = await prisma.telemetryDevice.create({
      data: { workerId, kind: 'IPHONE', credentialHash: hashCredential(secret) },
    })
    return { Authorization: `Device ${encodeCredential(device.id, secret)}` }
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication()
    await app.init()
    prisma = app.get(PrismaService)

    const worker = async (email: string, name: string) =>
      (
        await prisma.user.create({
          data: {
            email,
            name,
            passwordHash: 'nao-usado-neste-spec',
            role: 'WORKER',
            emailVerified: true,
            approvalStatus: 'APPROVED',
          },
        })
      ).id

    workerA = await worker(emailA, 'Telemetry Ingest A')
    workerB = await worker(emailB, 'Telemetry Ingest B')
    headersA = await enroll(workerA)
    headersB = await enroll(workerB)
  })

  afterAll(async () => {
    // Cascade a partir do User leva dispositivo, sessões, amostras e snapshot.
    await prisma.user.deleteMany({ where: { email: { in: emails } } })
    await app.close()
  })

  describe('credencial', () => {
    it('recusa sem cabeçalho de dispositivo', () => post({}, { events: [event()] }).expect(401))

    it('recusa credencial que não confere', () =>
      post({ Authorization: `Device ${randomUUID()}.segredo-errado` }, { events: [event()] }).expect(
        401,
      ))

    it('recusa aparelho revogado na hora, sem esperar validade de token', async () => {
      const headers = await enroll(workerA)
      const deviceId = headers.Authorization.split(' ')[1].split('.')[0]
      await prisma.telemetryDevice.update({
        where: { id: deviceId },
        data: { revokedAt: new Date() },
      })

      await post(headers, { events: [event()] }).expect(401)
    })
  })

  describe('envelope', () => {
    it('recusa eventId que não é UUID', () =>
      post(headersA, { events: [event({ eventId: 'evento-1' })] }).expect(400))

    it('recusa lote vazio', () => post(headersA, { events: [] }).expect(400))

    it('recusa lote acima do teto por requisição', () =>
      post(headersA, {
        events: Array.from({ length: MAX_BATCH_EVENTS + 1 }, () => event()),
      }).expect(400))
  })

  it('aceita o evento, abre a sessão do aparelho e promove o estado atual', async () => {
    const e = event()

    const { body } = await post(headersA, { events: [e] }).expect(200)

    expect(body.acceptedEventIds).toEqual([e.eventId])
    expect(body.duplicateEventIds).toEqual([])
    expect(body.conflicts).toEqual([])
    expect(Date.parse(body.serverTime)).not.toBeNaN()

    const sample = await prisma.telemetrySample.findUnique({ where: { eventId: e.eventId } })
    expect(sample?.workerId).toBe(workerA)
    expect(sample?.heartRateBpm).toBe(82)

    // A sessão nasce do primeiro evento: não há rota para abri-la, e quem a
    // nomeia é o relógio.
    const session = await prisma.telemetrySession.findUnique({
      where: { id: e.monitoringSessionId },
    })
    expect(session?.workerId).toBe(workerA)

    const snapshot = await prisma.telemetrySnapshot.findUnique({ where: { workerId: workerA } })
    expect(snapshot?.heartRateBpm).toBe(82)
  })

  it('confirma o reenvio idêntico sem gravar uma segunda amostra', async () => {
    const e = event()
    await post(headersA, { events: [e] }).expect(200)

    const { body } = await post(headersA, { events: [e] }).expect(200)

    expect(body.duplicateEventIds).toEqual([e.eventId])
    expect(body.acceptedEventIds).toEqual([])
    const gravadas = await prisma.telemetrySample.count({ where: { eventId: e.eventId } })
    expect(gravadas).toBe(1)
  })

  it('recusa o mesmo eventId com conteúdo diferente, em vez de sobrescrever', async () => {
    const e = event()
    await post(headersA, { events: [e] }).expect(200)

    const { body } = await post(headersA, {
      events: [
        { ...e, measurements: { heartRate: { value: 130, unit: 'bpm', source: 'APPLE_WATCH' } } },
      ],
    }).expect(200)

    expect(body.conflicts).toEqual([
      { eventId: e.eventId, reason: 'event_id_conflict', detail: expect.any(String) },
    ])
    const sample = await prisma.telemetrySample.findUnique({ where: { eventId: e.eventId } })
    expect(sample?.heartRateBpm).toBe(82)
  })

  it('recusa a sequência já usada na sessão por outro evento', async () => {
    const sessionId = randomUUID()
    const primeiro = event({ monitoringSessionId: sessionId })
    await post(headersA, { events: [primeiro] }).expect(200)

    const { body } = await post(headersA, {
      events: [event({ monitoringSessionId: sessionId, sequence: primeiro.sequence })],
    }).expect(200)

    expect(body.conflicts.map((c: { reason: string }) => c.reason)).toEqual(['sequence_conflict'])
  })

  it('separa aceitos e recusados no mesmo lote', async () => {
    const sessionId = randomUUID()
    const bom = event({ monitoringSessionId: sessionId })
    const ruim = event({
      monitoringSessionId: sessionId,
      measurements: { heartRate: { value: 999, unit: 'bpm', source: 'APPLE_WATCH' } },
    })

    const { body } = await post(headersA, { events: [bom, ruim] }).expect(200)

    expect(body.acceptedEventIds).toEqual([bom.eventId])
    expect(body.conflicts.map((c: { reason: string }) => c.reason)).toEqual(['invalid_measurement'])
    const rejeitada = await prisma.telemetrySample.findUnique({ where: { eventId: ruim.eventId } })
    expect(rejeitada).toBeNull()
  })

  // A regra que sustenta o evento sem workerId. Recusar e não apenas ignorar:
  // o pipe global roda com whitelist e removeria o campo caladamente, e aí o
  // aparelho seguiria mandando um workerId que ninguém lê nem contesta.
  it('recusa o evento que tenta impor workerId, sem gravar nada', async () => {
    const e = event()

    await post(headersA, { events: [{ ...e, workerId: workerB }] }).expect(400)

    const sample = await prisma.telemetrySample.findUnique({ where: { eventId: e.eventId } })
    expect(sample).toBeNull()
  })

  // Sem workerId o mesmo evento entra, e o funcionário sai da credencial.
  it('atribui a amostra ao dono da credencial, não a quem o corpo indicaria', async () => {
    const e = event()

    await post(headersA, { events: [e] }).expect(200)

    const sample = await prisma.telemetrySample.findUnique({ where: { eventId: e.eventId } })
    expect(sample?.workerId).toBe(workerA)
    expect(sample?.workerId).not.toBe(workerB)
  })

  it('recusa evento que não mede nada', async () => {
    const vazio = event({ measurements: {} })

    const { body } = await post(headersA, { events: [vazio] }).expect(200)

    expect(body.conflicts.map((c: { reason: string }) => c.reason)).toEqual(['invalid_event'])
    const gravada = await prisma.telemetrySample.findUnique({ where: { eventId: vazio.eventId } })
    expect(gravada).toBeNull()
  })

  // Sem a conferência de dono bastaria acertar o identificador da sessão para
  // gravar amostras no nome de outro funcionário: a persistência tira workerId
  // da sessão, não de quem chamou.
  it('não deixa um aparelho escrever na sessão de outro', async () => {
    const daA = event()
    await post(headersA, { events: [daA] }).expect(200)

    const invasor = event({ monitoringSessionId: daA.monitoringSessionId })
    const { body } = await post(headersB, { events: [invasor] }).expect(200)

    expect(body.conflicts).toEqual([
      { eventId: invasor.eventId, reason: 'session_unavailable', detail: expect.any(String) },
    ])
    const gravada = await prisma.telemetrySample.findUnique({ where: { eventId: invasor.eventId } })
    expect(gravada).toBeNull()
  })

  it('recusa evento medido no futuro', async () => {
    const adiantado = event({ eventTime: new Date(Date.now() + 30 * 60_000).toISOString() })

    const { body } = await post(headersA, { events: [adiantado] }).expect(200)

    expect(body.conflicts.map((c: { reason: string }) => c.reason)).toEqual(['invalid_event'])
  })

  it('guarda evento de mais de 48 horas como histórico, sem mexer no estado atual', async () => {
    const atual = event({
      measurements: { heartRate: { value: 77, unit: 'bpm', source: 'APPLE_WATCH' } },
    })
    await post(headersB, { events: [atual] }).expect(200)

    const antigo = event({
      eventTime: new Date(Date.now() - 72 * 3_600_000).toISOString(),
      measurements: { heartRate: { value: 120, unit: 'bpm', source: 'APPLE_WATCH' } },
    })
    const { body } = await post(headersB, { events: [antigo] }).expect(200)

    expect(body.acceptedEventIds).toEqual([antigo.eventId])
    const guardada = await prisma.telemetrySample.findUnique({ where: { eventId: antigo.eventId } })
    expect(guardada?.heartRateBpm).toBe(120)
    const snapshot = await prisma.telemetrySnapshot.findUnique({ where: { workerId: workerB } })
    expect(snapshot?.heartRateBpm).toBe(77)
  })
})
