import type { PrismaService } from '../../prisma/prisma.service'
import { ALERT_PROFILE_VERSION } from './alert-profile'
import { TelemetryConditionService } from './condition.service'

// O serviço decide QUAIS LINHAS entram na conta e grava o resultado; a conta
// é do motor, que é puro. O Prisma é dublê; o índice único e a migration são
// assunto do e2e. O que estes casos protegem: a ordem das instruções (lock
// antes de qualquer leitura), o que é gravado, e a regra de não empilhar
// alerta.

const NOW = new Date('2026-09-07T12:00:00.000Z')
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000)
const SESSION = { id: 'session-1', workerId: 'worker-1', origin: 'REAL' }

const sampleRow = (secAgo: number, heartRateBpm: number | null, over: Record<string, unknown> = {}) => ({
  eventTime: secondsAgo(secAgo),
  heartRateBpm,
  batteryPercent: null,
  systolicMmHg: null,
  diastolicMmHg: null,
  ...over,
})

/** 13 amostras a cada 5 s cobrindo os últimos 60 s: densidade que o motor aceita. */
const highSeries = (bpm = 185) => Array.from({ length: 13 }, (_, i) => sampleRow(60 - i * 5, bpm))

const prismaDouble = () => {
  const db: any = {
    open: false,
    telemetrySession: { findUnique: jest.fn().mockResolvedValue(SESSION) },
    telemetryCondition: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'condition-new', ...data })),
      update: jest.fn().mockImplementation(async ({ data }: any) => data),
    },
    operationalAlert: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'alert-new', ...data })),
    },
    telemetrySample: { findMany: jest.fn().mockResolvedValue([]) },
    telemetrySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    profile: { findUnique: jest.fn().mockResolvedValue({ birthDate: new Date('1991-05-10T00:00:00.000Z') }) },
    telemetryDailySummary: { findMany: jest.fn().mockResolvedValue([{ heartRateMin: 62 }]) },
  }
  db.$transaction = jest.fn(async (fn: any) => {
    db.open = true
    try {
      return await fn(db)
    } finally {
      db.open = false
    }
  })
  db.$queryRaw = jest.fn().mockResolvedValue([{ id: SESSION.id }])
  return db
}

const firstCall = (fn: jest.Mock) => fn.mock.invocationCallOrder[0]
const service = (prisma: any) => new TelemetryConditionService(prisma as PrismaService)

describe('TelemetryConditionService.evaluateSession: fiação', () => {
  it('trava a sessão antes de qualquer leitura', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    const sql = prisma.$queryRaw.mock.calls[0][0].join('?')
    expect(sql).toMatch(/TelemetrySession/)
    expect(sql).toMatch(/for no key update/i)
    expect(firstCall(prisma.$queryRaw)).toBeLessThan(firstCall(prisma.telemetryCondition.findMany))
    expect(firstCall(prisma.$queryRaw)).toBeLessThan(firstCall(prisma.telemetrySample.findMany))
  })

  it('grava com a transação aberta, não depois de ela fechar', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    let abertaNaGravacao = false
    prisma.telemetryCondition.create.mockImplementation(async ({ data }: any) => {
      abertaNaGravacao = prisma.open
      return { id: 'condition-new', ...data }
    })

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(abertaNaGravacao).toBe(true)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('sessão inexistente estoura', async () => {
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([])

    await expect(service(prisma).evaluateSession('nada', NOW, NOW)).rejects.toThrow(/não existe/)
  })

  it('lê as amostras dos últimos 60 s até o gatilho, com BPM, bateria e pressão', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', secondsAgo(5), NOW)

    const { where, select } = prisma.telemetrySample.findMany.mock.calls[0][0]
    expect(where).toEqual({ sessionId: 'session-1', eventTime: { gte: secondsAgo(65), lte: secondsAgo(5) } })
    expect(select).toMatchObject({
      eventTime: true,
      heartRateBpm: true,
      batteryPercent: true,
      systolicMmHg: true,
      diastolicMmHg: true,
    })
  })

  it('lê condições ativas do funcionário NA MESMA ORIGEM: demonstração não cega o real', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.telemetryCondition.findMany.mock.calls[0][0].where).toEqual({
      workerId: 'worker-1',
      origin: 'REAL',
      status: 'ACTIVE',
    })
  })
})

describe('TelemetryConditionService.evaluateSession: abrir', () => {
  it('BPM alto sustentado grava condição com perfil, regra, limite e valor, e abre alerta', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_HIGH'], recovered: [], alerts: 1 })
    const { data } = prisma.telemetryCondition.create.mock.calls[0][0]
    expect(data).toMatchObject({
      workerId: 'worker-1',
      sessionId: 'session-1',
      origin: 'REAL',
      kind: 'HEART_RATE_HIGH',
      status: 'ACTIVE',
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      thresholdProfile: ALERT_PROFILE_VERSION,
      thresholdRule: 'PERSONALIZED',
      observedValue: 185,
    })
    // Quem nasceu em 1991-05-10 tem 35 anos completos no dia monitorado de
    // 2026-09-07, então a máxima por idade (Tanaka) é 208 - 0,7 x 35 = 183,5, e
    // 90% dela arredondado dá 165. O número entra fixo de propósito: se o
    // perfil ou a fórmula mudarem, a mudança aparece aqui, e não numa condição
    // aberta em produção.
    expect(data.thresholdValue).toBe(165)
    expect(prisma.operationalAlert.create.mock.calls[0][0].data).toMatchObject({
      conditionId: 'condition-new',
      workerId: 'worker-1',
      origin: 'REAL',
      status: 'OPEN',
    })
  })

  it('sem data de nascimento, BPM alto abre pelo piso e a linha diz FLOOR', async () => {
    const prisma = prismaDouble()
    prisma.profile.findUnique.mockResolvedValue({ birthDate: null })
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries(182))

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.telemetryCondition.create.mock.calls[0][0].data).toMatchObject({
      thresholdRule: 'FLOOR',
      thresholdValue: 180,
    })
  })

  it('bateria baixa abre condição e NÃO abre alerta: aparelho é estado, não item de fila', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(5, null, { batteryPercent: 12 })])

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['DEVICE_BATTERY_LOW'])
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('pressão fora da faixa abre condição e alerta', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(5, null, { systolicMmHg: 150, diastolicMmHg: 80 })])

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['BLOOD_PRESSURE_REVIEW'])
    expect(prisma.operationalAlert.create).toHaveBeenCalledTimes(1)
  })

  it('não abre alerta novo enquanto houver um não resolvido do mesmo funcionário e tipo', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.operationalAlert.findFirst.mockResolvedValue({ id: 'alert-old' })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_HIGH'], recovered: [], alerts: 0 })
    expect(prisma.operationalAlert.findFirst.mock.calls[0][0].where).toEqual({
      workerId: 'worker-1',
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      condition: { kind: 'HEART_RATE_HIGH' },
    })
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('condição já ativa e ainda acima do limite: nada é gravado', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([{ id: 'c-1', kind: 'HEART_RATE_HIGH' }])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(prisma.telemetryCondition.create).not.toHaveBeenCalled()
    expect(prisma.telemetryCondition.update).not.toHaveBeenCalled()
  })
})

describe('TelemetryConditionService.evaluateSession: recuperar', () => {
  it('BPM de volta abaixo da banda recupera com motivo NORMALIZED e carimbo', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([{ id: 'c-1', kind: 'HEART_RATE_HIGH' }])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries(120))

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.recovered).toEqual(['HEART_RATE_HIGH'])
    expect(prisma.telemetryCondition.update.mock.calls[0][0]).toEqual({
      where: { id: 'c-1' },
      data: { status: 'RECOVERED', recoveredAt: NOW, recoveryReason: 'NORMALIZED', lastSeenAt: NOW },
    })
  })

  it('evento ao vivo recupera perda de sinal ativa, com motivo NORMALIZED', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([{ id: 'c-sig', kind: 'DEVICE_SIGNAL_LOST' }])

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.recovered).toEqual(['DEVICE_SIGNAL_LOST'])
    expect(prisma.telemetryCondition.update.mock.calls[0][0].data).toMatchObject({
      status: 'RECOVERED',
      recoveryReason: 'NORMALIZED',
    })
  })
})
