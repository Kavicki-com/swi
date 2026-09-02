import { randomUUID } from 'node:crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { TelemetryOriginMismatchError } from '../src/telemetry/domain/telemetry.errors'
import type { TelemetryEvent } from '../src/telemetry/domain/telemetry.types'
import { PrismaTelemetryRepository } from '../src/telemetry/persistence/prisma-telemetry.repository'
import {
  TelemetryIntegrityConflictError,
  TelemetrySessionNotFoundError,
} from '../src/telemetry/persistence/telemetry.repository'

// E2E e não unitário de propósito: o contrato que esta camada precisa provar é
// idempotência sob índice único, e isso mora no Postgres. Um Prisma mockado
// provaria apenas que o código chama o método que o autor imaginou. Pelo mesmo
// motivo o spec fala com o PrismaService direto, sem subir o AppModule: não há
// HTTP aqui para exercitar, só o banco.
describe('Telemetry repository e2e', () => {
  let prisma: PrismaService
  let repo: PrismaTelemetryRepository

  const email = `telemetry-repo-${randomUUID()}@ex.com`
  let workerId = ''
  let deviceId = ''
  const realSessionId = `real-${randomUUID()}`
  const demoSessionId = `demo-${randomUUID()}`

  // "Agora" fixo: a fronteira entre promover e arquivar é a distância até este
  // instante, então o relógio da máquina deixaria o teste dependente da hora em
  // que ele roda.
  const now = new Date('2026-09-02T12:00:00.000Z')
  const liveAt = new Date(now.getTime() - 10_000)
  const backlogAt = new Date(now.getTime() - 30 * 60_000)

  let sequence = 0
  const event = (over: Partial<TelemetryEvent> = {}): TelemetryEvent => ({
    eventId: randomUUID(),
    deviceId,
    monitoringSessionId: realSessionId,
    sequence: ++sequence,
    eventTime: liveAt.toISOString(),
    receivedAt: now.toISOString(),
    origin: 'REAL',
    measurements: { heartRate: { value: 82, unit: 'bpm', source: 'APPLE_WATCH' } },
    ...over,
  })

  // Linha crua, sem passar pelo repositório: é assim que os dois testes de
  // índice provam a restrição do banco em vez da regra do adapter.
  const rawRow = (e: TelemetryEvent) => ({
    sessionId: e.monitoringSessionId,
    deviceId: e.deviceId,
    workerId,
    origin: e.origin,
    eventTime: new Date(e.eventTime),
    receivedAt: new Date(e.receivedAt),
    payload: {},
    payloadHash: 'hash-escrito-a-mao',
  })

  beforeAll(async () => {
    prisma = new PrismaService()
    await prisma.$connect()
    repo = new PrismaTelemetryRepository(prisma)

    const worker = await prisma.user.create({
      data: {
        email,
        name: 'Telemetry Repo',
        passwordHash: 'nao-usado-neste-spec',
        role: 'WORKER',
        emailVerified: true,
        approvalStatus: 'APPROVED',
      },
    })
    workerId = worker.id

    const device = await prisma.telemetryDevice.create({
      data: {
        workerId,
        kind: 'APPLE_WATCH',
        model: 'Apple Watch Series 10',
        credentialHash: 'hash-de-credencial-de-teste',
      },
    })
    deviceId = device.id

    // Duas sessões do mesmo dispositivo, uma por origem: a incompatibilidade
    // REAL/DEMO precisa ser exercitada nos dois sentidos.
    await prisma.telemetrySession.createMany({
      data: [
        {
          id: realSessionId,
          deviceId,
          workerId,
          origin: 'REAL',
          startedAt: new Date(now.getTime() - 3_600_000),
        },
        {
          id: demoSessionId,
          deviceId,
          workerId,
          origin: 'DEMO',
          startedAt: new Date(now.getTime() - 3_600_000),
        },
      ],
    })
  })

  // Cada teste começa sem amostra e sem snapshot; caso contrário a promoção de
  // um teste anterior responderia pela asserção do seguinte.
  beforeEach(async () => {
    await prisma.telemetrySample.deleteMany({ where: { workerId } })
    await prisma.telemetrySnapshot.deleteMany({ where: { workerId } })
  })

  afterAll(async () => {
    // Cascade a partir do User leva dispositivo, sessões, amostras e snapshot.
    await prisma.user.deleteMany({ where: { email } })
    await prisma.$disconnect()
  })

  it('guarda o evento ao vivo e promove o snapshot do funcionário', async () => {
    const e = event()

    const result = await repo.saveEvent(e, now)

    expect(result.outcome).toBe('STORED')
    expect(result.snapshotPromoted).toBe(true)
    const snapshot = await prisma.telemetrySnapshot.findUnique({ where: { workerId } })
    expect(snapshot?.lastEventId).toBe(e.eventId)
    expect(snapshot?.heartRateBpm).toBe(82)
  })

  it('aceita a repetição idêntica como sucesso idempotente sem duplicar a amostra', async () => {
    const e = event()
    await repo.saveEvent(e, now)

    const again = await repo.saveEvent(e, now)

    expect(again.outcome).toBe('DUPLICATE')
    expect(again.snapshotPromoted).toBe(false)
    expect(await prisma.telemetrySample.count({ where: { workerId } })).toBe(1)
  })

  it('recusa o mesmo eventId com conteúdo diferente', async () => {
    const e = event()
    await repo.saveEvent(e, now)
    const adulterado: TelemetryEvent = {
      ...e,
      measurements: { heartRate: { value: 140, unit: 'bpm', source: 'APPLE_WATCH' } },
    }

    await expect(repo.saveEvent(adulterado, now)).rejects.toBeInstanceOf(
      TelemetryIntegrityConflictError,
    )
    expect(await prisma.telemetrySample.count({ where: { workerId } })).toBe(1)
  })

  it('recusa outro evento na sequência já usada pela sessão', async () => {
    const primeiro = event()
    await repo.saveEvent(primeiro, now)

    await expect(repo.saveEvent(event({ sequence: primeiro.sequence }), now)).rejects.toBeInstanceOf(
      TelemetryIntegrityConflictError,
    )
    expect(await prisma.telemetrySample.count({ where: { workerId } })).toBe(1)
  })

  it('salva o evento atrasado no histórico sem promover o snapshot', async () => {
    const atual = event()
    await repo.saveEvent(atual, now)

    const atrasado = event({
      eventTime: backlogAt.toISOString(),
      measurements: { heartRate: { value: 55, unit: 'bpm', source: 'APPLE_WATCH' } },
    })
    const result = await repo.saveEvent(atrasado, now)

    expect(result.outcome).toBe('STORED')
    expect(result.snapshotPromoted).toBe(false)
    expect(await prisma.telemetrySample.count({ where: { workerId } })).toBe(2)
    const snapshot = await prisma.telemetrySnapshot.findUnique({ where: { workerId } })
    expect(snapshot?.lastEventId).toBe(atual.eventId)
    expect(snapshot?.heartRateBpm).toBe(82)
  })

  it('promove bateria e pressão guardando o horário de cada métrica', async () => {
    await repo.saveEvent(event(), now)

    const medidoEm = new Date(now.getTime() - 5_000)
    await repo.saveEvent(
      event({
        eventTime: medidoEm.toISOString(),
        measurements: {
          battery: { value: 64, unit: '%', source: 'APPLE_WATCH' },
          bloodPressure: {
            value: { systolic: 128, diastolic: 82 },
            unit: 'mmHg',
            source: 'EXTERNAL_CUFF',
          },
        },
      }),
      now,
    )

    const snapshot = await prisma.telemetrySnapshot.findUnique({ where: { workerId } })
    // O evento novo não trouxe BPM, então o valor anterior continua no lugar
    // com o horário em que foi medido. Métrica ausente não zera a vizinha.
    expect(snapshot?.heartRateBpm).toBe(82)
    expect(snapshot?.heartRateAt).toEqual(liveAt)
    expect(snapshot?.batteryPercent).toBe(64)
    expect(snapshot?.batteryAt).toEqual(medidoEm)
    expect(snapshot?.systolicMmHg).toBe(128)
    expect(snapshot?.diastolicMmHg).toBe(82)
    expect(snapshot?.bloodPressureSource).toBe('EXTERNAL_CUFF')
    expect(snapshot?.bloodPressureAt).toEqual(medidoEm)
  })

  it('não deixa um evento ao vivo mais antigo sobrescrever o snapshot mais novo', async () => {
    const novo = event()
    await repo.saveEvent(novo, now)

    // Ainda ao vivo (1 min < 2 min), mas medido antes do que já está promovido:
    // a fila do relógio entrega fora de ordem depois de uma reconexão.
    const antigo = event({
      eventTime: new Date(now.getTime() - 60_000).toISOString(),
      measurements: { heartRate: { value: 99, unit: 'bpm', source: 'APPLE_WATCH' } },
    })
    const result = await repo.saveEvent(antigo, now)

    expect(result.outcome).toBe('STORED')
    expect(result.snapshotPromoted).toBe(false)
    const snapshot = await prisma.telemetrySnapshot.findUnique({ where: { workerId } })
    expect(snapshot?.lastEventId).toBe(novo.eventId)
    expect(snapshot?.heartRateBpm).toBe(82)
  })

  it('troca de origem substitui o snapshot inteiro em vez de misturar métricas', async () => {
    // Snapshot DEMO com BPM, medido depois do evento REAL que vem em seguida:
    // nem a métrica nem a ordem da demonstração podem sobreviver ao real.
    await repo.saveEvent(
      event({
        monitoringSessionId: demoSessionId,
        origin: 'DEMO',
        eventTime: new Date(now.getTime() - 5_000).toISOString(),
      }),
      now,
    )

    const real = event({
      measurements: { battery: { value: 64, unit: '%', source: 'APPLE_WATCH' } },
    })
    const result = await repo.saveEvent(real, now)

    expect(result.snapshotPromoted).toBe(true)
    const snapshot = await prisma.telemetrySnapshot.findUnique({ where: { workerId } })
    expect(snapshot?.origin).toBe('REAL')
    expect(snapshot?.lastEventId).toBe(real.eventId)
    expect(snapshot?.batteryPercent).toBe(64)
    expect(snapshot?.heartRateBpm).toBeNull()
    expect(snapshot?.heartRateAt).toBeNull()
  })

  it('trata o mesmo instante escrito de outra forma como repetição, não conflito', async () => {
    const e = event({ eventTime: '2026-09-02T11:59:50.000Z' })
    await repo.saveEvent(e, now)

    const again = await repo.saveEvent({ ...e, eventTime: '2026-09-02T11:59:50Z' }, now)

    expect(again.outcome).toBe('DUPLICATE')
  })

  it('sessão sem amostra de passos não nasce com zero passos', async () => {
    const session = await prisma.telemetrySession.findUniqueOrThrow({
      where: { id: realSessionId },
    })
    expect(session.stepsTotal).toBeNull()
    expect(session.activeEnergyKcalTotal).toBeNull()
  })

  it('recusa evento DEMO em sessão REAL', async () => {
    await expect(repo.saveEvent(event({ origin: 'DEMO' }), now)).rejects.toBeInstanceOf(
      TelemetryOriginMismatchError,
    )
    expect(await prisma.telemetrySample.count({ where: { workerId } })).toBe(0)
  })

  it('recusa evento REAL em sessão DEMO', async () => {
    await expect(
      repo.saveEvent(event({ monitoringSessionId: demoSessionId, origin: 'REAL' }), now),
    ).rejects.toBeInstanceOf(TelemetryOriginMismatchError)
    expect(await prisma.telemetrySample.count({ where: { workerId } })).toBe(0)
  })

  it('recusa evento de sessão desconhecida', async () => {
    await expect(
      repo.saveEvent(event({ monitoringSessionId: `fantasma-${randomUUID()}` }), now),
    ).rejects.toBeInstanceOf(TelemetrySessionNotFoundError)
  })

  it('impede duas amostras com o mesmo eventId', async () => {
    const e = event()
    await repo.saveEvent(e, now)

    await expect(
      prisma.telemetrySample.create({
        data: { ...rawRow(e), eventId: e.eventId, sequence: e.sequence + 1000 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('impede duas amostras na mesma sequência da sessão', async () => {
    const e = event()
    await repo.saveEvent(e, now)

    await expect(
      prisma.telemetrySample.create({
        data: { ...rawRow(e), eventId: randomUUID(), sequence: e.sequence },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })
})
