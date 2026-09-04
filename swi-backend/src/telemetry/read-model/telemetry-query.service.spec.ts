import { ForbiddenException, NotFoundException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { TelemetryQueryService } from './telemetry-query.service'

// O que estes casos protegem é a fronteira entre o que o projetor calcula e o
// que o banco entrega: quais linhas entram na conta. Duas regras congeladas
// vivem aqui e em nenhum outro lugar: consulta REAL nunca lê linha DEMO, e a
// Jornada SWI não filtra nada, porque monitoramento e jornada são
// independentes. O Prisma é dublê; o que exige banco real é o e2e do
// repositório.

const NOW = new Date('2026-09-03T12:00:00.000Z')
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000)

const ADMIN = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }

const prismaDouble = () =>
  ({
    telemetrySnapshot: { findUnique: jest.fn(), findMany: jest.fn() },
    telemetrySample: { findMany: jest.fn(), groupBy: jest.fn(), aggregate: jest.fn() },
    $queryRaw: jest.fn(),
    telemetryAssessment: { findMany: jest.fn() },
    telemetryCondition: { findMany: jest.fn() },
    telemetryDevice: { findMany: jest.fn() },
    telemetrySession: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  }) as any

const service = (prisma: any) => new TelemetryQueryService(prisma as PrismaService)

const snapshotRow = (over: Record<string, unknown> = {}) => ({
  workerId: 'worker-1',
  origin: 'REAL',
  sessionId: 'session-1',
  heartRateBpm: 88,
  heartRateAt: secondsAgo(5),
  batteryPercent: 70,
  batteryAt: secondsAgo(60),
  systolicMmHg: null,
  diastolicMmHg: null,
  bloodPressureSource: null,
  bloodPressureAt: null,
  ...over,
})

/** Um agregado vazio, como o Prisma devolve quando nenhuma linha casa. */
const NO_TOTALS = {
  _sum: { stepDelta: null, activeEnergyKcal: null },
  _max: { eventTime: null },
  _min: { eventTime: null },
}

const emptyReads = (prisma: any) => {
  prisma.telemetrySample.findMany.mockResolvedValue([])
  prisma.telemetrySample.groupBy.mockResolvedValue([])
  prisma.telemetrySample.aggregate.mockResolvedValue(NO_TOTALS)
  prisma.$queryRaw.mockResolvedValue([])
  prisma.telemetryAssessment.findMany.mockResolvedValue([])
  prisma.telemetryCondition.findMany.mockResolvedValue([])
  prisma.telemetryDevice.findMany.mockResolvedValue([])
  prisma.telemetrySnapshot.findMany.mockResolvedValue([])
}

describe('TelemetryQueryService.currentForWorker', () => {
  it('lê o snapshot do funcionário e projeta o estado atual', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(snapshotRow())

    const result = await service(prisma).currentForWorker('worker-1', NOW)

    expect(result.workerId).toBe('worker-1')
    expect(result.origin).toBe('REAL')
    expect(result.metrics.heartRate.value).toBe(88)
    expect(result.observedAt).toBe(NOW.toISOString())
  })

  it('funcionário sem snapshot devolve leitura vazia, não erro', async () => {
    // Quem não reportou ainda não é quem não existe. Erro aqui faria a tela do
    // mobile falhar em vez de dizer "sem dados".
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(null)

    const result = await service(prisma).currentForWorker('worker-1', NOW)

    expect(result.origin).toBeNull()
    expect(result.metrics.heartRate.value).toBeNull()
    expect(prisma.telemetrySample.findMany).not.toHaveBeenCalled()
    expect(prisma.telemetrySample.aggregate).not.toHaveBeenCalled()
  })

  it('a janela e os totais do dia são filtrados pela origem do snapshot', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(snapshotRow({ origin: 'REAL' }))

    await service(prisma).currentForWorker('worker-1', NOW)

    const window = prisma.telemetrySample.findMany.mock.calls[0][0].where
    expect(window.workerId).toBe('worker-1')
    expect(window.origin).toBe('REAL')
    for (const call of prisma.telemetrySample.aggregate.mock.calls) {
      expect(call[0].where.workerId).toBe('worker-1')
      expect(call[0].where.origin).toBe('REAL')
    }
  })

  it('funcionário em demonstração lê só DEMO, e nunca linha REAL', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(snapshotRow({ origin: 'DEMO' }))

    const result = await service(prisma).currentForWorker('worker-1', NOW)

    expect(result.origin).toBe('DEMO')
    expect(prisma.telemetrySample.findMany.mock.calls[0][0].where.origin).toBe('DEMO')
    expect(prisma.telemetrySample.aggregate.mock.calls[0][0].where.origin).toBe('DEMO')
    expect(prisma.telemetryAssessment.findMany.mock.calls[0][0].where.origin).toBe('DEMO')
  })

  it('a janela do dia não é filtrada por jornada nem por tarefa', async () => {
    // Iniciar, pausar ou encerrar a Jornada SWI não inicia, pausa nem encerra o
    // monitoramento. Um filtro por journeyId aqui reintroduziria exatamente o
    // acoplamento que a ADR-0003 removeu.
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(snapshotRow())

    await service(prisma).currentForWorker('worker-1', NOW)

    const window = prisma.telemetrySample.findMany.mock.calls[0][0].where
    expect(window).not.toHaveProperty('journeyId')
    expect(window).not.toHaveProperty('taskId')
    // A série é só a janela das taxas: os últimos 60 minutos, nunca o dia.
    expect(window.eventTime).toEqual({ gte: new Date('2026-09-03T11:00:00.000Z') })

    for (const call of prisma.telemetrySample.aggregate.mock.calls) {
      expect(call[0].where).not.toHaveProperty('journeyId')
      expect(call[0].where.eventTime).toEqual({
        gte: new Date('2026-09-03T03:00:00.000Z'),
        lt: new Date('2026-09-04T03:00:00.000Z'),
      })
    }
  })

  it('os totais do dia são somados pelo banco, cada um sobre as amostras que o medem', async () => {
    // Sem o filtro por coluna não nula, o _max seria o horário de qualquer
    // evento, e um evento só de bateria deixaria os passos parecerem frescos.
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(snapshotRow())

    await service(prisma).currentForWorker('worker-1', NOW)

    const calls = prisma.telemetrySample.aggregate.mock.calls.map((c: any) => c[0])
    expect(calls).toHaveLength(2)
    const steps = calls.find((c: any) => c.where.stepDelta !== undefined)
    const energy = calls.find((c: any) => c.where.activeEnergyKcal !== undefined)
    expect(steps.where.stepDelta).toEqual({ not: null })
    expect(steps._sum).toEqual({ stepDelta: true })
    expect(steps._max).toEqual({ eventTime: true })
    expect(energy.where.activeEnergyKcal).toEqual({ not: null })
    expect(energy._sum).toEqual({ activeEnergyKcal: true })
    expect(energy._max).toEqual({ eventTime: true })
    // A primeira amostra de energia do dia é o que separa começo de lacuna.
    expect(energy._min).toEqual({ eventTime: true })
  })

  it('janela e totais viram taxa e acumulado, com horário em ISO', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(snapshotRow())
    prisma.telemetrySample.findMany.mockResolvedValue([
      { eventTime: secondsAgo(600), stepDelta: 1_200, activeEnergyKcal: 0, motionCount: null },
      { eventTime: secondsAgo(20), stepDelta: 300, activeEnergyKcal: 50, motionCount: null },
    ])
    prisma.telemetrySample.aggregate.mockImplementation(({ where }: any) =>
      where.stepDelta !== undefined
        ? { _sum: { stepDelta: 1_500 }, _max: { eventTime: secondsAgo(20) }, _min: { eventTime: null } }
        : {
            _sum: { activeEnergyKcal: 50 },
            _max: { eventTime: secondsAgo(20) },
            _min: { eventTime: secondsAgo(600) },
          },
    )

    const result = await service(prisma).currentForWorker('worker-1', NOW)

    expect(result.metrics.steps.value).toBe(1_500)
    expect(result.metrics.steps.measuredAt).toBe(secondsAgo(20).toISOString())
    // 50 kcal cobrindo 580 s, o intervalo entre as duas amostras de energia.
    expect(result.metrics.energyRatePerHour.value).toBe(310.3)
  })

  it('usa a avaliação mais recente do dia monitorado', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(snapshotRow())
    prisma.telemetryAssessment.findMany.mockResolvedValue([
      {
        computedAt: secondsAgo(10),
        effortPercent: 55,
        wearPercent: 40,
        formulaVersion: 'swi-fatigue-experimental',
      },
    ])

    const result = await service(prisma).currentForWorker('worker-1', NOW)

    const call = prisma.telemetryAssessment.findMany.mock.calls[0][0]
    expect(call.orderBy).toEqual({ computedAt: 'desc' })
    expect(call.take).toBe(1)
    expect(result.metrics.effort.value).toBe(55)
    expect(result.metrics.wear.value).toBe(40)
  })

  it('avaliação de segundos atrás não some na virada do dia monitorado', async () => {
    // 03:00:30Z é 00:00:30 em Brasília. Uma avaliação de 40 segundos atrás foi
    // calculada às 23:59:50, ou seja, no dia monitorado que acabou de terminar.
    // Recortar a busca por dia a descartaria, e esforço e desgaste sumiriam por
    // alguns minutos todo dia, na virada. Quem decide se a avaliação ainda vale
    // é o prazo de atualidade do domínio, não o calendário.
    const now = new Date('2026-09-04T03:00:30.000Z')
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(snapshotRow())
    prisma.telemetryAssessment.findMany.mockResolvedValue([
      {
        computedAt: new Date('2026-09-04T02:59:50.000Z'),
        effortPercent: 55,
        wearPercent: 40,
        formulaVersion: 'swi-fatigue-experimental',
      },
    ])

    const result = await service(prisma).currentForWorker('worker-1', now)

    expect(prisma.telemetryAssessment.findMany.mock.calls[0][0].where.computedAt).toBeUndefined()
    expect(result.metrics.effort.quality).toBe('CURRENT')
    expect(result.metrics.effort.value).toBe(55)
    expect(result.metrics.wear.value).toBe(40)
  })
})

describe('TelemetryQueryService.currentForAdmin', () => {
  it('administrador lê o funcionário da própria empresa', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.user.findUnique.mockResolvedValue({ id: 'worker-1', companyId: 'company-1' })
    prisma.telemetrySnapshot.findUnique.mockResolvedValue(snapshotRow())

    const result = await service(prisma).currentForAdmin(ADMIN, 'worker-1', NOW)

    expect(result.metrics.heartRate.value).toBe(88)
  })

  it('funcionário de outra empresa responde igual a inexistente', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.user.findUnique.mockResolvedValue({ id: 'worker-1', companyId: 'outra-empresa' })

    await expect(service(prisma).currentForAdmin(ADMIN, 'worker-1', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('administrador sem empresa não alcança conta órfã', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    prisma.user.findUnique.mockResolvedValue({ id: 'worker-1', companyId: null })

    await expect(
      service(prisma).currentForAdmin({ ...ADMIN, companyId: null }, 'worker-1', NOW),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('TelemetryQueryService.adminSummary', () => {
  const population = (prisma: any, workerIds: string[]) => {
    prisma.telemetryDevice.findMany.mockResolvedValue(workerIds.map((workerId) => ({ workerId })))
  }

  it('a população do painel são os funcionários com aparelho ativo na empresa', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    population(prisma, ['worker-1', 'worker-2'])

    const summary = await service(prisma).adminSummary(ADMIN, NOW)

    const { where } = prisma.telemetryDevice.findMany.mock.calls[0][0]
    expect(where.revokedAt).toBeNull()
    expect(where.worker).toEqual({ companyId: 'company-1' })
    expect(summary.heartRateAverage.coverage.total).toBe(2)
  })

  it('todas as consultas do painel são REAL: demonstração nunca entra na média', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    population(prisma, ['worker-1'])

    await service(prisma).adminSummary(ADMIN, NOW)

    for (const model of [
      prisma.telemetrySnapshot.findMany,
      prisma.telemetrySample.groupBy,
      prisma.telemetryCondition.findMany,
    ]) {
      expect(model.mock.calls[0][0].where.origin).toBe('REAL')
    }
    // A última avaliação por funcionário sai em SQL cru; a origem vai como
    // parâmetro, e é aqui que se prova que ela é REAL.
    const latest = prisma.$queryRaw.mock.calls[0][0]
    expect(latest.values).toContain('REAL')
    expect(prisma.telemetryAssessment.findMany).not.toHaveBeenCalled()
  })

  it('agrega snapshots, amostras, avaliações e condições da população', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    population(prisma, ['worker-1', 'worker-2'])
    prisma.telemetrySnapshot.findMany.mockResolvedValue([
      snapshotRow({ workerId: 'worker-1', heartRateBpm: 70 }),
      snapshotRow({ workerId: 'worker-2', heartRateBpm: 90 }),
    ])
    prisma.telemetrySample.groupBy.mockResolvedValue([
      { workerId: 'worker-1', _sum: { stepDelta: 1_000 }, _max: { eventTime: secondsAgo(20) } },
      { workerId: 'worker-2', _sum: { stepDelta: 500 }, _max: { eventTime: secondsAgo(20) } },
    ])
    prisma.telemetryCondition.findMany.mockResolvedValue([
      { workerId: 'worker-2', kind: 'HEART_RATE_HIGH' },
    ])

    const summary = await service(prisma).adminSummary(ADMIN, NOW)

    expect(summary.heartRateAverage.value).toBe(80)
    expect(summary.heartRateAverage.coverage).toEqual({ evaluated: 2, total: 2 })
    expect(summary.movements.value).toBe(1_500)
    expect(summary.urgentAlerts.workers).toBe(1)
    expect(summary.vitalSigns.value).toBe(1)
  })

  it('a última avaliação por funcionário é escolhida pelo banco, não em memória', async () => {
    // Trazer todas as avaliações do dia para ficar com uma por pessoa custaria
    // milhares de linhas por refresh do painel. DISTINCT ON faz a escolha no
    // Postgres e devolve uma linha por funcionário.
    const prisma = prismaDouble()
    emptyReads(prisma)
    population(prisma, ['worker-1', 'worker-2'])
    prisma.telemetrySnapshot.findMany.mockResolvedValue([snapshotRow({ workerId: 'worker-1' })])
    prisma.$queryRaw.mockResolvedValue([
      {
        workerId: 'worker-1',
        computedAt: secondsAgo(10),
        effortPercent: null,
        wearPercent: 35,
        formulaVersion: 'swi-fatigue-experimental',
      },
    ])

    const summary = await service(prisma).adminSummary(ADMIN, NOW)

    const query = prisma.$queryRaw.mock.calls[0][0]
    expect(query.sql).toMatch(/DISTINCT ON \("workerId"\)/)
    expect(query.sql).toMatch(/ORDER BY "workerId", "computedAt" DESC/)
    expect(query.values).toEqual(expect.arrayContaining(['worker-1', 'worker-2']))
    expect(summary.wearRate.value).toBe(35)
    expect(summary.wearRate.coverage).toEqual({ evaluated: 1, total: 2 })
  })

  it('a última avaliação do painel não é recortada pelo dia monitorado', async () => {
    // Mesmo motivo do caso da rota do funcionário: na virada do dia, o recorte
    // por dia zeraria a cobertura de desgaste do painel inteiro por alguns
    // minutos. A escolha da linha continua sendo do banco, pela mais recente.
    const prisma = prismaDouble()
    emptyReads(prisma)
    population(prisma, ['worker-1'])

    await service(prisma).adminSummary(ADMIN, NOW)

    const query = prisma.$queryRaw.mock.calls[0][0]
    expect(query.sql).not.toMatch(/"computedAt" >=/)
    expect(query.sql).not.toMatch(/"computedAt" </)
  })

  it('soma vazia do banco não vira zero passo', async () => {
    // O tipo do groupBy admite soma nula, e a diferença importa: sem passos
    // conhecidos o funcionário fica fora da cobertura, e não dentro dela com
    // zero, que seria afirmar que ele não andou.
    const prisma = prismaDouble()
    emptyReads(prisma)
    population(prisma, ['worker-1'])
    prisma.telemetrySample.groupBy.mockResolvedValue([
      { workerId: 'worker-1', _sum: { stepDelta: null }, _max: { eventTime: null } },
    ])

    const summary = await service(prisma).adminSummary(ADMIN, NOW)

    expect(summary.movements.value).toBeNull()
    expect(summary.movements.coverage).toEqual({ evaluated: 0, total: 1 })
  })

  it('duas condições ativas do mesmo funcionário contam um alerta só', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    population(prisma, ['worker-1', 'worker-2'])
    prisma.telemetryCondition.findMany.mockResolvedValue([
      { workerId: 'worker-1', kind: 'HEART_RATE_HIGH' },
      { workerId: 'worker-1', kind: 'HEART_RATE_LOW' },
      // Alerta de aparelho não é urgência de saúde.
      { workerId: 'worker-2', kind: 'DEVICE_BATTERY_LOW' },
    ])

    const summary = await service(prisma).adminSummary(ADMIN, NOW)

    expect(summary.urgentAlerts.workers).toBe(1)
  })

  it('a busca de métricas é restrita à população, e não à tabela inteira', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    population(prisma, ['worker-1'])
    prisma.telemetrySnapshot.findMany.mockResolvedValue([
      snapshotRow({ workerId: 'worker-1', heartRateBpm: 70 }),
    ])

    const summary = await service(prisma).adminSummary(ADMIN, NOW)

    expect(prisma.telemetrySnapshot.findMany.mock.calls[0][0].where.workerId).toEqual({
      in: ['worker-1'],
    })
    expect(summary.heartRateAverage.coverage.total).toBe(1)
  })

  it('empresa sem nenhum aparelho pareado não vai ao banco atrás de métrica', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)
    population(prisma, [])

    const summary = await service(prisma).adminSummary(ADMIN, NOW)

    expect(prisma.telemetrySnapshot.findMany).not.toHaveBeenCalled()
    expect(summary.heartRateAverage.value).toBeNull()
    expect(summary.heartRateAverage.coverage).toEqual({ evaluated: 0, total: 0 })
  })

  it('administrador sem empresa não vê painel de ninguém', async () => {
    const prisma = prismaDouble()
    emptyReads(prisma)

    await expect(
      service(prisma).adminSummary({ ...ADMIN, companyId: null }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('TelemetryQueryService.sessionHistory', () => {
  const sessionRow = (over: Record<string, unknown> = {}) => ({
    id: 'session-1',
    workerId: 'worker-1',
    deviceId: 'device-1',
    origin: 'REAL',
    status: 'ACTIVE',
    startedAt: secondsAgo(3_600),
    endedAt: null,
    worker: { companyId: 'company-1' },
    ...over,
  })

  const sampleRow = (sequence: number) => ({
    id: `sample-${sequence}`,
    sequence,
    eventTime: secondsAgo(100 - sequence),
    receivedAt: secondsAgo(99 - sequence),
    origin: 'REAL',
    heartRateBpm: 80 + sequence,
    stepDelta: null,
    activeEnergyKcal: null,
    motionCount: null,
    batteryPercent: null,
    systolicMmHg: null,
    diastolicMmHg: null,
    bloodPressureSource: null,
    journeyId: null,
    taskId: null,
  })

  it('devolve as amostras em ordem de sequência, para a lacuna ficar visível', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue(sessionRow())
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(1), sampleRow(3)])

    const page = await service(prisma).sessionHistory(ADMIN, 'session-1', {})

    expect(prisma.telemetrySample.findMany.mock.calls[0][0].orderBy).toEqual({ sequence: 'asc' })
    expect(page.samples.map((s: { sequence: number }) => s.sequence)).toEqual([1, 3])
    expect(page.session.id).toBe('session-1')
  })

  it('pagina por sequência e devolve o cursor da próxima página', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue(sessionRow())
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(4), sampleRow(5)])

    const page = await service(prisma).sessionHistory(ADMIN, 'session-1', {
      limit: 2,
      afterSequence: 3,
    })

    const call = prisma.telemetrySample.findMany.mock.calls[0][0]
    expect(call.where.sequence).toEqual({ gt: 3 })
    expect(call.take).toBe(2)
    expect(page.nextCursor).toBe(5)
  })

  it('última página não oferece cursor', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue(sessionRow())
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(4)])

    const page = await service(prisma).sessionHistory(ADMIN, 'session-1', { limit: 2 })

    expect(page.nextCursor).toBeNull()
  })

  it('página vazia devolve cursor nulo, e não estoura procurando a última linha', async () => {
    // Com limite zero, página cheia e página vazia teriam o mesmo tamanho, e
    // ler a última linha de uma lista vazia derrubaria a rota. Quem recusa
    // limite zero é o DTO; esta guarda protege os outros chamadores do serviço.
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue(sessionRow())
    prisma.telemetrySample.findMany.mockResolvedValue([])

    const page = await service(prisma).sessionHistory(ADMIN, 'session-1', { limit: 0 })

    expect(page.samples).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it('o funcionário audita a própria sessão', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue(sessionRow())
    prisma.telemetrySample.findMany.mockResolvedValue([])

    const page = await service(prisma).sessionHistory(
      { userId: 'worker-1', role: 'WORKER', companyId: 'company-1' },
      'session-1',
      {},
    )

    expect(page.session.workerId).toBe('worker-1')
  })

  it('sessão de outro funcionário responde igual a inexistente', async () => {
    // Distinguir as duas contaria a quem sonda quais identificadores existem.
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue(sessionRow())

    await expect(
      service(prisma).sessionHistory(
        { userId: 'worker-9', role: 'WORKER', companyId: 'company-1' },
        'session-1',
        {},
      ),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('sessão de outra empresa responde igual a inexistente para o administrador', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue(
      sessionRow({ worker: { companyId: 'outra-empresa' } }),
    )

    await expect(service(prisma).sessionHistory(ADMIN, 'session-1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('sessão inexistente responde a mesma recusa', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue(null)

    await expect(service(prisma).sessionHistory(ADMIN, 'nao-existe', {})).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
