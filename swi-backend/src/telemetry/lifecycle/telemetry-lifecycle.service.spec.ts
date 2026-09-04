import { Logger } from '@nestjs/common'
import { RETENTION_DEFAULT_BATCH } from '../../config/runtime-env'
import type { PrismaService } from '../../prisma/prisma.service'
import {
  closedDayCutoff,
  MAX_TRIPLES_PER_RUN,
  RETENTION_BUDGET_MS,
  TelemetryLifecycleService,
} from './telemetry-lifecycle.service'
import { SUMMARIZER_VERSION } from './telemetry-summarizer'

// O que estes casos protegem é a fronteira entre o que o resumidor calcula e o
// que o banco entrega: quais dias entram na rodada e como a linha é gravada.
// Duas regras congeladas vivem aqui: um dia só é resumido depois de fechado, e
// origem real e de demonstração nunca se misturam. O Prisma é dublê; o que
// exige banco real (a migration, o upsert e o SQL da varredura) é o e2e.

const NOW = new Date('2026-09-04T12:00:00.000Z')
/** Dia civil em Brasília 2026-09-01, já fechado às 12:00Z de 2026-09-04. */
const DAY = new Date('2026-09-01T00:00:00.000Z')

const prismaDouble = () =>
  ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    telemetrySample: { findMany: jest.fn().mockResolvedValue([]) },
    telemetryAssessment: { findMany: jest.fn().mockResolvedValue([]) },
    telemetryDailySummary: { upsert: jest.fn().mockResolvedValue({}) },
  }) as any

const service = (prisma: any) => new TelemetryLifecycleService(prisma as PrismaService)

const candidate = (over: Record<string, unknown> = {}) => ({
  workerId: 'worker-1',
  day: DAY,
  origin: 'REAL',
  ...over,
})

const sampleRow = (clock: string, over: Record<string, unknown> = {}) => ({
  eventTime: new Date(`2026-09-01T${clock}.000Z`),
  sessionId: 'session-1',
  heartRateBpm: null,
  stepDelta: null,
  activeEnergyKcal: null,
  batteryPercent: null,
  systolicMmHg: null,
  diastolicMmHg: null,
  bloodPressureSource: null,
  ...over,
})

describe('closedDayCutoff: um dia só é resumido depois de fechado', () => {
  it('o corte é a meia-noite de Brasília 48 horas atrás', () => {
    // 48 horas antes de 2026-09-04T12:00Z é 2026-09-02T12:00Z, que em Brasília
    // é o dia 2026-09-02, começado às 03:00Z. Tudo anterior a esse instante
    // pertence a dia que já fechou.
    expect(closedDayCutoff(NOW).toISOString()).toBe('2026-09-02T03:00:00.000Z')
  })

  it('o prazo é o mesmo que separa backlog de histórico, e não um número novo', () => {
    // O dia 2026-09-01 termina às 2026-09-02T03:00Z e fecha 48 h depois, em
    // 2026-09-04T03:00Z. No instante exato ele já entra na rodada.
    expect(closedDayCutoff(new Date('2026-09-04T03:00:00.000Z')).toISOString()).toBe(
      '2026-09-02T03:00:00.000Z',
    )
    // Um segundo antes, o corte ainda é o dia anterior: 2026-09-01 fica de fora.
    expect(closedDayCutoff(new Date('2026-09-04T02:59:59.999Z')).toISOString()).toBe(
      '2026-09-01T03:00:00.000Z',
    )
  })
})

describe('TelemetryLifecycleService.summarizeClosedDays: quem entra na rodada', () => {
  it('procura candidatas até o corte do dia fechado', async () => {
    const prisma = prismaDouble()

    await service(prisma).summarizeClosedDays(NOW)

    const query = prisma.$queryRaw.mock.calls[0][0]
    expect(query.values).toContainEqual(closedDayCutoff(NOW))
  })

  it('não recandidata dia que já tem Resumo gravado', async () => {
    // Sem esta exclusão a rodada recomputaria os mesmos dias para sempre e
    // nunca alcançaria os mais recentes, porque a Leitura só some na retenção.
    const prisma = prismaDouble()

    await service(prisma).summarizeClosedDays(NOW)

    const { sql } = prisma.$queryRaw.mock.calls[0][0]
    expect(sql).toMatch(/NOT EXISTS/)
    expect(sql).toMatch(/"TelemetryDailySummary"/)
  })

  it('pede das mais antigas para as mais recentes, com teto por execução', async () => {
    // O teto é o que dá tamanho previsível à rodada. O que sobra entra na
    // seguinte, porque o job roda todo dia.
    const prisma = prismaDouble()

    await service(prisma).summarizeClosedDays(NOW)

    const query = prisma.$queryRaw.mock.calls[0][0]
    expect(query.sql).toMatch(/ORDER BY[\s\S]*ASC/)
    expect(query.values).toContainEqual(MAX_TRIPLES_PER_RUN)
  })

  it('recandidata dia cujo Resumo veio de outra versão do resumidor', async () => {
    // Sem a versão no filtro, subir a conta do resumidor não recalcularia nada:
    // o histórico ficaria congelado no que a versão antiga soube apurar, e duas
    // linhas vizinhas do mesmo painel viriam de regras diferentes.
    const prisma = prismaDouble()

    await service(prisma).summarizeClosedDays(NOW)

    const query = prisma.$queryRaw.mock.calls[0][0]
    expect(query.sql).toMatch(/"summarizerVersion"/)
    expect(query.values).toContainEqual(SUMMARIZER_VERSION)
  })

  it('conta leitura e avaliação como motivo para resumir o dia', async () => {
    const prisma = prismaDouble()

    await service(prisma).summarizeClosedDays(NOW)

    const { sql } = prisma.$queryRaw.mock.calls[0][0]
    expect(sql).toMatch(/"TelemetrySample"/)
    expect(sql).toMatch(/"TelemetryAssessment"/)
  })
})

describe('TelemetryLifecycleService.summarizeClosedDays: o que ela carrega e grava', () => {
  it('carrega só as leituras daquele funcionário, dia e origem', async () => {
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([candidate()])
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow('12:00:00', { heartRateBpm: 80 })])

    await service(prisma).summarizeClosedDays(NOW)

    expect(prisma.telemetrySample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workerId: 'worker-1',
          origin: 'REAL',
          eventTime: {
            gte: new Date('2026-09-01T03:00:00.000Z'),
            lt: new Date('2026-09-02T03:00:00.000Z'),
          },
        },
      }),
    )
  })

  it('grava pela tripla funcionário, dia e origem', async () => {
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([candidate()])
    prisma.telemetrySample.findMany.mockResolvedValue([
      sampleRow('12:00:00', { heartRateBpm: 60 }),
      sampleRow('12:00:30', { heartRateBpm: 80 }),
    ])

    await service(prisma).summarizeClosedDays(NOW)

    expect(prisma.telemetryDailySummary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workerId_day_origin: { workerId: 'worker-1', day: DAY, origin: 'REAL' } },
        create: expect.objectContaining({ heartRateMin: 60, heartRateMax: 80, sampleCount: 2 }),
        update: expect.objectContaining({ heartRateMin: 60, heartRateMax: 80, sampleCount: 2 }),
      }),
    )
  })

  it('carrega toda métrica que o Resumo carrega, e não só BPM e passos', async () => {
    // O select é o contrato entre a linha do banco e o resumidor: um campo
    // esquecido aqui vira coluna nula no Resumo, indistinguível de "ninguém
    // mediu", e ninguém percebe até alguém ler o relatório.
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([candidate()])
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow('12:00:00', { heartRateBpm: 70 })])

    await service(prisma).summarizeClosedDays(NOW)

    expect(prisma.telemetrySample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          eventTime: true,
          sessionId: true,
          heartRateBpm: true,
          stepDelta: true,
          activeEnergyKcal: true,
          batteryPercent: true,
          systolicMmHg: true,
          diastolicMmHg: true,
          bloodPressureSource: true,
        },
      }),
    )
  })

  it('grava as colunas de toda métrica, e não só as da primeira fatia', async () => {
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([candidate()])
    prisma.telemetrySample.findMany.mockResolvedValue([
      sampleRow('12:00:00', {
        activeEnergyKcal: 2.5,
        batteryPercent: 44,
        systolicMmHg: 128,
        diastolicMmHg: 82,
        bloodPressureSource: 'EXTERNAL_CUFF',
      }),
    ])
    prisma.telemetryAssessment.findMany.mockResolvedValue([
      { computedAt: new Date('2026-09-01T12:00:00.000Z'), effortPercent: 88, wearPercent: 30 },
    ])

    await service(prisma).summarizeClosedDays(NOW)

    expect(prisma.telemetryDailySummary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          activeEnergyKcalTotal: 2.5,
          activeEnergyCount: 1,
          batteryMin: 44,
          bloodPressureCount: 1,
          lastSystolicMmHg: 128,
          lastDiastolicMmHg: 82,
          lastBloodPressureSource: 'EXTERNAL_CUFF',
          effortMax: 88,
          effortCount: 1,
          wearMax: 30,
          sessionCount: 1,
          summarizerVersion: SUMMARIZER_VERSION,
        }),
      }),
    )
  })

  it('origem de demonstração gera Resumo próprio, sem se misturar com o real', async () => {
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([candidate({ origin: 'DEMO' })])
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow('12:00:00', { stepDelta: 9 })])

    await service(prisma).summarizeClosedDays(NOW)

    expect(prisma.telemetrySample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ origin: 'DEMO' }) }),
    )
    expect(prisma.telemetryDailySummary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workerId_day_origin: { workerId: 'worker-1', day: DAY, origin: 'DEMO' } },
      }),
    )
  })

  it('dia que não tem nada a resumir não vira linha, e não passa em silêncio', async () => {
    // A candidata veio do banco, mas a janela não trouxe leitura nem avaliação.
    // Gravar aqui inventaria um dia monitorado que não existiu. E é um
    // invariante quebrado, não um caso normal: a varredura e a janela usam a
    // mesma fronteira de dia, então uma candidata vazia é as duas contas
    // discordando. Sem aviso, ela voltaria toda noite sem ninguém notar.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([candidate()])

    const result = await service(prisma).summarizeClosedDays(NOW)

    expect(prisma.telemetryDailySummary.upsert).not.toHaveBeenCalled()
    expect(result.summarized).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('TelemetryLifecycleService.purgeRetainedData: só apaga o que já foi resumido', () => {
  /** Um dublê com tudo que a retenção NÃO pode tocar, para provar que não toca. */
  const prismaWithNeighbours = () => {
    const prisma = prismaDouble()
    prisma.telemetryDailySummary.findMany = jest.fn().mockResolvedValue([])
    prisma.$executeRaw = jest.fn().mockResolvedValue(0)
    prisma.telemetryCondition = { deleteMany: jest.fn(), findMany: jest.fn() }
    prisma.operationalAlert = { deleteMany: jest.fn() }
    prisma.telemetrySession = { deleteMany: jest.fn(), findMany: jest.fn() }
    prisma.telemetrySnapshot = { deleteMany: jest.fn() }
    prisma.telemetryDevice = { deleteMany: jest.fn() }
    prisma.telemetrySample.deleteMany = jest.fn()
    prisma.telemetryAssessment.deleteMany = jest.fn()
    return prisma
  }

  const summaryRow = (over: Record<string, unknown> = {}) => ({
    workerId: 'worker-1',
    day: new Date('2026-07-01T00:00:00.000Z'),
    origin: 'REAL',
    ...over,
  })

  it('procura só dia resumido pela versão corrente e mais velho que a janela', async () => {
    // As duas condições juntas, nunca "mais antigo que X" a seco: o gate é a
    // existência do Resumo, e um Resumo de versão velha ainda vai ser
    // recalculado, então a Leitura dele não pode sumir antes.
    const prisma = prismaWithNeighbours()

    await service(prisma).purgeRetainedData(NOW)

    expect(prisma.telemetryDailySummary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          summarizerVersion: SUMMARIZER_VERSION,
          // 30 dias antes de 2026-09-04T12:00Z é 2026-08-05T12:00Z, cujo dia
          // monitorado é 2026-08-05: só dias estritamente anteriores a ele
          // estão inteiros fora da janela.
          day: { lt: new Date('2026-08-05T00:00:00.000Z') },
        },
      }),
    )
  })

  it('apaga em lotes dentro da janela do dia, até o lote vir curto', async () => {
    const prisma = prismaWithNeighbours()
    prisma.telemetryDailySummary.findMany.mockResolvedValue([summaryRow()])
    // Dois lotes cheios de leitura e depois um curto; avaliação já vem curta.
    prisma.$executeRaw
      .mockResolvedValueOnce(RETENTION_DEFAULT_BATCH)
      .mockResolvedValueOnce(RETENTION_DEFAULT_BATCH)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(3)

    const result = await service(prisma).purgeRetainedData(NOW)

    expect(result.samplesDeleted).toBe(RETENTION_DEFAULT_BATCH * 2 + 7)
    expect(result.assessmentsDeleted).toBe(3)
    expect(result.daysPurged).toBe(1)
  })

  it('nunca toca condição, alerta, sessão, snapshot, aparelho nem o próprio Resumo', async () => {
    // A retenção apaga trilha bruta. Condição e alerta são a memória clínica do
    // piloto, e sessão, snapshot e aparelho são prova de que houve
    // monitoramento: apagá-los junto destruiria a história que o Resumo existe
    // para preservar.
    const prisma = prismaWithNeighbours()
    prisma.telemetryDailySummary.findMany.mockResolvedValue([summaryRow()])
    prisma.$executeRaw.mockResolvedValue(0)

    await service(prisma).purgeRetainedData(NOW)

    expect(prisma.telemetryCondition.deleteMany).not.toHaveBeenCalled()
    expect(prisma.operationalAlert.deleteMany).not.toHaveBeenCalled()
    expect(prisma.telemetrySession.deleteMany).not.toHaveBeenCalled()
    expect(prisma.telemetrySnapshot.deleteMany).not.toHaveBeenCalled()
    expect(prisma.telemetryDevice.deleteMany).not.toHaveBeenCalled()
    expect(prisma.telemetryDailySummary.upsert).not.toHaveBeenCalled()
  })

  it('origem de demonstração é apagada pela mesma regra, sem exceção', async () => {
    const prisma = prismaWithNeighbours()
    prisma.telemetryDailySummary.findMany.mockResolvedValue([summaryRow({ origin: 'DEMO' })])
    prisma.$executeRaw.mockResolvedValue(0)

    await service(prisma).purgeRetainedData(NOW)

    const values = prisma.$executeRaw.mock.calls[0][0].values
    expect(values).toContainEqual('DEMO')
  })

  it('para no orçamento de tempo em vez de varrer a noite inteira', async () => {
    // Cada lote é uma transação curta e o que sobrar entra na rodada de
    // amanhã. Sem o orçamento, uma primeira execução sobre anos de histórico
    // seguraria o banco por horas.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    try {
      const prisma = prismaWithNeighbours()
      prisma.telemetryDailySummary.findMany.mockResolvedValue([
        summaryRow({ workerId: 'worker-1' }),
        summaryRow({ workerId: 'worker-2' }),
      ])
      // Cada lote gasta o orçamento inteiro e volta cheio: sem a parada, o
      // laço seguiria para os lotes seguintes e para o segundo dia.
      prisma.$executeRaw.mockImplementation(() => {
        jest.advanceTimersByTime(RETENTION_BUDGET_MS + 1)
        return Promise.resolve(RETENTION_DEFAULT_BATCH)
      })

      const result = await service(prisma).purgeRetainedData(NOW)

      expect(result.stoppedByBudget).toBe(true)
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('TelemetryLifecycleService.summarizeClosedDays: uma falha não derruba a rodada', () => {
  it('tripla que falha é contada e as demais seguem', async () => {
    // A rodada é diária e o teto é por execução: parar na primeira falha
    // deixaria toda a fila parada atrás de um dia problemático.
    // O aviso é o comportamento esperado aqui, então ele é silenciado para a
    // saída da suíte continuar limpa.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([
      candidate({ workerId: 'worker-1' }),
      candidate({ workerId: 'worker-2' }),
    ])
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow('12:00:00', { heartRateBpm: 70 })])
    prisma.telemetryDailySummary.upsert
      .mockRejectedValueOnce(new Error('banco fora do ar'))
      .mockResolvedValueOnce({})

    const result = await service(prisma).summarizeClosedDays(NOW)

    expect(result).toEqual({ summarized: 1, failed: 1 })
    expect(prisma.telemetryDailySummary.upsert).toHaveBeenCalledTimes(2)
    expect(prisma.telemetryDailySummary.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { workerId_day_origin: { workerId: 'worker-2', day: DAY, origin: 'REAL' } },
      }),
    )
    // A falha não passa em silêncio: sem aviso, um dia problemático sumiria da
    // rodada todo dia sem ninguém notar.
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
