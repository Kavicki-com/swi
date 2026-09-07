import type { PrismaService } from '../../prisma/prisma.service'
import { EXPERIMENTAL_PROFILE, FORMULA_VERSION } from './assessment-profile'
import { ASSESSMENT_THROTTLE_MS, TelemetryAssessmentService } from './assessment.service'

// O que estes casos protegem é a fronteira entre a fórmula e o banco: de onde
// vem cada entrada, como a cadeia liga uma avaliação à seguinte, quando o
// corte de 15 s segura, e o que é gravado quando falta dado. O Prisma é dublê;
// a migration e o read model lendo a linha são assunto do e2e.

const NOW = new Date('2026-09-04T12:00:00.000Z')
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000)

const SESSION = { id: 'session-1', workerId: 'worker-1', origin: 'REAL', startedAt: secondsAgo(3_600) }

// O dublê é o mesmo objeto dentro e fora da transação, como o do device-auth:
// o que interessa afirmar é a ordem das instruções e que a gravação aconteceu
// com a transação aberta, não que o Prisma entrega outro cliente.
const prismaDouble = () => {
  const db: any = {
    open: false,
    createdWithTransactionOpen: false,
    telemetrySession: { findUnique: jest.fn().mockResolvedValue(SESSION) },
    telemetryAssessment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    telemetrySample: { findMany: jest.fn().mockResolvedValue([]) },
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
  db.telemetryAssessment.create.mockImplementation(async ({ data }: any) => {
    db.createdWithTransactionOpen = db.open
    return { id: 'assessment-new', ...data }
  })
  return db
}

/** Em que ponto da execução um dublê foi chamado pela primeira vez. */
const firstCall = (fn: jest.Mock) => fn.mock.invocationCallOrder[0]

const service = (prisma: any) => new TelemetryAssessmentService(prisma as PrismaService)

const sampleRow = (secAgo: number, heartRateBpm: number | null = 118, motionCount: number | null = null) => ({
  eventTime: secondsAgo(secAgo),
  heartRateBpm,
  motionCount,
})

const previousRow = (over: Record<string, unknown> = {}) => ({
  id: 'assessment-prev',
  computedAt: secondsAgo(20),
  windowEnd: secondsAgo(20),
  formulaVersion: FORMULA_VERSION,
  inputs: {
    chain: {
      nextState: {
        strainDose: 12,
        effortEma: 0.4,
        lastHeartRate: { bpm: 110, atMs: secondsAgo(21).getTime() },
        lastSampleAtMs: secondsAgo(20).getTime(),
      },
    },
  },
  ...over,
})

describe('TelemetryAssessmentService.assessSession', () => {
  it('grava uma avaliação com esforço e desgaste a partir das amostras da janela', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(10), sampleRow(5), sampleRow(0)])

    const out = await service(prisma).assessSession('session-1', NOW, NOW)

    expect(out.outcome).toBe('assessed')
    const { data } = prisma.telemetryAssessment.create.mock.calls[0][0]
    expect(data).toMatchObject({
      workerId: 'worker-1',
      sessionId: 'session-1',
      origin: 'REAL',
      formulaVersion: FORMULA_VERSION,
      computedAt: NOW,
      windowEnd: NOW,
    })
    expect(data.effortPercent).toBeGreaterThan(0)
    expect(data.wearPercent).toBeGreaterThanOrEqual(0)
  })

  it('primeira da sessão: estado zero, janela de no máximo 120 s para trás, motivo registrado', async () => {
    const prisma = prismaDouble()
    await service(prisma).assessSession('session-1', NOW, NOW)

    const { data } = prisma.telemetryAssessment.create.mock.calls[0][0]
    expect(data.windowStart).toEqual(secondsAgo(120))
    expect(data.inputs.chain).toMatchObject({ reason: 'first_of_session', previousAssessmentId: null, previousState: null })
    const where = prisma.telemetrySample.findMany.mock.calls[0][0].where
    expect(where.eventTime).toEqual({ gt: secondsAgo(120), lte: NOW })
  })

  it('sessão que começou há menos de 120 s: a janela começa no início dela', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue({ ...SESSION, startedAt: secondsAgo(30) })
    await service(prisma).assessSession('session-1', NOW, NOW)
    expect(prisma.telemetryAssessment.create.mock.calls[0][0].data.windowStart).toEqual(secondsAgo(30))
  })

  it('encadeia: a janela começa no fim da anterior e o estado anterior entra na conta', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue(previousRow())
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(10), sampleRow(0)])

    await service(prisma).assessSession('session-1', NOW, NOW)

    const { data } = prisma.telemetryAssessment.create.mock.calls[0][0]
    expect(data.windowStart).toEqual(secondsAgo(20))
    expect(data.inputs.chain).toMatchObject({ reason: null, previousAssessmentId: 'assessment-prev' })
    expect(data.inputs.chain.previousState.strainDose).toBe(12)
    expect(data.inputs.chain.nextState.strainDose).toBeGreaterThan(0)
  })

  it('versão diferente reinicia a cadeia de propósito', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue(previousRow({ formulaVersion: 'swi-fatigue-experimental-0' }))
    await service(prisma).assessSession('session-1', NOW, NOW)
    const { data } = prisma.telemetryAssessment.create.mock.calls[0][0]
    expect(data.inputs.chain).toMatchObject({ reason: 'version_changed', previousState: null })
    expect(data.windowStart).toEqual(secondsAgo(120))
  })

  it('corte de 15 s: anterior com menos de 15 s segura, sem ler amostra nem gravar', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue(previousRow({ computedAt: secondsAgo(14) }))

    const out = await service(prisma).assessSession('session-1', NOW, NOW)

    expect(out.outcome).toBe('throttled')
    expect(prisma.telemetrySample.findMany).not.toHaveBeenCalled()
    expect(prisma.telemetryAssessment.create).not.toHaveBeenCalled()
    expect(ASSESSMENT_THROTTLE_MS).toBe(15_000)
  })

  it('corte de 15 s: exatamente 15 s já avalia', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue(previousRow({ computedAt: secondsAgo(15), windowEnd: secondsAgo(15) }))
    const out = await service(prisma).assessSession('session-1', NOW, NOW)
    expect(out.outcome).toBe('assessed')
  })

  it('gatilho que não passa do fim da janela anterior não tem nada novo', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue(previousRow({ computedAt: secondsAgo(20), windowEnd: NOW }))
    const out = await service(prisma).assessSession('session-1', NOW, NOW)
    expect(out.outcome).toBe('nothing_new')
    expect(prisma.telemetryAssessment.create).not.toHaveBeenCalled()
  })

  it('repouso observado: mediana dos mínimos diários dos últimos 14 dias fechados da mesma origem', async () => {
    const prisma = prismaDouble()
    prisma.telemetryDailySummary.findMany.mockResolvedValue([{ heartRateMin: 70 }, { heartRateMin: 20 }, { heartRateMin: 62 }])
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(0)])

    await service(prisma).assessSession('session-1', NOW, NOW)

    const where = prisma.telemetryDailySummary.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ workerId: 'worker-1', origin: 'REAL', heartRateMin: { not: null } })
    expect(where.day.gte).toEqual(new Date('2026-08-21T00:00:00.000Z'))
    expect(prisma.telemetryAssessment.create.mock.calls[0][0].data.inputs.baseline).toMatchObject({ restingBpm: 62, days: 3 })
  })

  it('sem dia fechado com batimento: grava linha indisponível com o motivo, e não inventa repouso', async () => {
    const prisma = prismaDouble()
    prisma.telemetryDailySummary.findMany.mockResolvedValue([])
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(0)])

    const out = await service(prisma).assessSession('session-1', NOW, NOW)

    expect(out.outcome).toBe('assessed')
    const { data } = prisma.telemetryAssessment.create.mock.calls[0][0]
    expect(data.effortPercent).toBeNull()
    expect(data.wearPercent).toBeNull()
    expect(data.inputs.unavailableReason).toBe('no_resting_baseline')
  })

  it('sem data de nascimento: grava linha indisponível com o motivo', async () => {
    const prisma = prismaDouble()
    prisma.profile.findUnique.mockResolvedValue({ birthDate: null })
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(0)])
    await service(prisma).assessSession('session-1', NOW, NOW)
    expect(prisma.telemetryAssessment.create.mock.calls[0][0].data.inputs.unavailableReason).toBe('no_birth_date')
  })

  it('máxima vem da idade no calendário de Brasília', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(0)])
    await service(prisma).assessSession('session-1', NOW, NOW)
    // 1991-05-10 em 2026-09-04: 35 anos; 208 - 0.7*35 = 183.5
    expect(prisma.telemetryAssessment.create.mock.calls[0][0].data.inputs.baseline).toMatchObject({ ageYears: 35, maxBpm: 183.5 })
  })

  it('grava o perfil inteiro em inputs, para a linha se reproduzir depois de o perfil mudar', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(0)])
    await service(prisma).assessSession('session-1', NOW, NOW)
    expect(prisma.telemetryAssessment.create.mock.calls[0][0].data.inputs.profile).toEqual(EXPERIMENTAL_PROFILE)
  })

  it('sessão inexistente estoura: é invariante quebrado, não caso normal', async () => {
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([])
    await expect(service(prisma).assessSession('nao-existe', NOW, NOW)).rejects.toThrow(/nao-existe/)
  })
})

// Dois lotes da mesma sessão em voo ao mesmo tempo bifurcavam a cadeia: os dois
// liam a mesma anterior, os dois passavam o corte, e os dois gravavam apontando
// para o mesmo previousAssessmentId. Quem serializa é o banco, com lock na
// linha da sessão, porque a garantia tem de valer para qualquer cliente.
describe('TelemetryAssessmentService.assessSession, serialização por sessão', () => {
  it('trava a linha da sessão antes de qualquer leitura', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue(previousRow())

    await service(prisma).assessSession('session-1', NOW, NOW)

    const [sql] = prisma.$queryRaw.mock.calls[0]
    expect(sql.join('?')).toMatch(/TelemetrySession/)
    expect(sql.join('?')).toMatch(/for no key update/i)
    expect(firstCall(prisma.$queryRaw)).toBeLessThan(firstCall(prisma.telemetryAssessment.findFirst))
    expect(firstCall(prisma.$queryRaw)).toBeLessThan(firstCall(prisma.telemetrySession.findUnique))
    expect(firstCall(prisma.$queryRaw)).toBeLessThan(firstCall(prisma.telemetrySample.findMany))
  })

  it('grava com a transação aberta, não depois de ela fechar', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(10), sampleRow(0)])

    const out = await service(prisma).assessSession('session-1', NOW, NOW)

    expect(out.outcome).toBe('assessed')
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.createdWithTransactionOpen).toBe(true)
  })

  it('sonda o corte lendo só computedAt, e carrega inputs só depois de ele deixar passar', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue(previousRow())

    await service(prisma).assessSession('session-1', NOW, NOW)

    expect(prisma.telemetryAssessment.findFirst).toHaveBeenCalledTimes(2)
    expect(prisma.telemetryAssessment.findFirst.mock.calls[0][0].select).toEqual({ computedAt: true })
    expect(prisma.telemetryAssessment.findFirst.mock.calls[1][0].select).toMatchObject({ inputs: true })
  })

  it('primeira da sessão não faz a segunda consulta: não há anterior para carregar', async () => {
    const prisma = prismaDouble()
    await service(prisma).assessSession('session-1', NOW, NOW)
    expect(prisma.telemetryAssessment.findFirst).toHaveBeenCalledTimes(1)
  })

  it('cortado: nem a sessão inteira, nem inputs, nem amostra são lidos', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue(previousRow({ computedAt: secondsAgo(14) }))

    const out = await service(prisma).assessSession('session-1', NOW, NOW)

    expect(out.outcome).toBe('throttled')
    expect(prisma.telemetryAssessment.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.telemetrySession.findUnique).not.toHaveBeenCalled()
    expect(prisma.telemetrySample.findMany).not.toHaveBeenCalled()
    expect(prisma.telemetryDailySummary.findMany).not.toHaveBeenCalled()
  })

  it('sessão que não existe estoura no lock, antes de sondar o corte', async () => {
    const prisma = prismaDouble()
    prisma.$queryRaw.mockResolvedValue([])

    await expect(service(prisma).assessSession('sumida', NOW, NOW)).rejects.toThrow(/sumida/)
    expect(prisma.telemetryAssessment.findFirst).not.toHaveBeenCalled()
  })
})
