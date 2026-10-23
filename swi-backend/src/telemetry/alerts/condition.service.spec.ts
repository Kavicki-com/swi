import { Logger } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import type { RealtimeGateway } from '../../realtime/realtime.gateway'
import type { TelemetryAudienceService } from '../realtime/telemetry-audience.service'
import type { TelemetryHealthNotifier } from './health-notifier'
import { ALERT_PROFILE_VERSION, CALIBRATED_ALERT_PROFILE_VERSION } from './alert-profile'
import {
  MAX_NO_NEW_READING_PER_RUN,
  MAX_SILENT_SESSIONS_PER_RUN,
  MONITORED_SILENCE_FLOOR_MS,
  NO_NEW_READING_METRIC,
  NO_NEW_READING_MS,
  TelemetryConditionService,
} from './condition.service'

// O serviço decide QUAIS LINHAS entram na conta e grava o resultado; a conta
// é do motor, que é puro. O Prisma é dublê; o índice único e a migration são
// assunto do e2e. O que estes casos protegem: a ordem das instruções (lock
// antes de qualquer leitura), o que é gravado, e a regra de não empilhar
// alerta.

const NOW = new Date('2026-09-07T12:00:00.000Z')
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000)
const minutesAgo = (m: number) => secondsAgo(m * 60)
const hoursAgo = (h: number) => minutesAgo(h * 60)
const daysAgo = (d: number) => hoursAgo(d * 24)
const SESSION = { id: 'session-1', workerId: 'worker-1', origin: 'REAL' }

// A oxigenação também é lida por findMany de amostras: a linha de batimento
// traz a coluna nula, como o banco traria, e a busca de oxigenação a ignora.
const sampleRow = (secAgo: number, heartRateBpm: number | null, over: Record<string, unknown> = {}) => ({
  eventTime: secondsAgo(secAgo),
  heartRateBpm,
  oxygenSaturationPct: null,
  ...over,
})

/**
 * As duas últimas leituras de oxigenação, mais nova primeiro. O dublê separa a
 * busca dela da série de batimento pela coluna que o `where` filtra.
 */
const withOxygen = (prisma: any, readings: Array<{ minAgo: number; pct: number }>) => {
  const series = prisma.telemetrySample.findMany
  prisma.telemetrySample.findMany = jest
    .fn()
    .mockImplementation(async (args: any) =>
      args.where.oxygenSaturationPct === undefined
        ? series(args)
        : readings.map((r) => ({ eventTime: minutesAgo(r.minAgo), oxygenSaturationPct: r.pct })),
    )
}
const oxygenCall = (prisma: any) =>
  prisma.telemetrySample.findMany.mock.calls.map((c: any) => c[0]).find((arg: any) => arg.where.oxygenSaturationPct)

/** 13 amostras a cada 5 s cobrindo os últimos 60 s: densidade que o motor aceita. */
const highSeries = (bpm = 185) => Array.from({ length: 13 }, (_, i) => sampleRow(60 - i * 5, bpm))

/** Condição ativa vista agora há pouco: o carimbo não precisa de renovação. */
const activeRow = (id: string, kind: string, lastSeenAt: Date = secondsAgo(10)) => ({ id, kind, lastSeenAt })

// A pressão do banco sempre vem com a hora medida; o dublê põe NOW quando o
// teste não diz outra.
const withEventTime = (pressure: unknown) =>
  pressure === undefined || pressure === null ? null : { eventTime: NOW, ...pressure }

/**
 * Bateria e pressão são lidas por chamadas próprias, cada uma com o prazo da
 * sua métrica. O dublê separa as duas pela coluna que cada `where` filtra.
 */
const latestReadings = (readings: { battery?: unknown; pressure?: unknown }) =>
  jest.fn().mockImplementation(async ({ where }: any) =>
    where.batteryPercent === undefined ? withEventTime(readings.pressure) : (readings.battery ?? null),
  )

/**
 * Leituras gravadas em OUTRA sessão do mesmo funcionário. O dublê filtra como o
 * banco filtraria: recorte por sessão não as acha, recorte por funcionário e
 * origem acha.
 */
const readingsOfAnotherSession = (readings: { battery?: unknown; pressure?: unknown }) =>
  jest.fn().mockImplementation(async ({ where }: any) => {
    const row = where.batteryPercent === undefined ? withEventTime(readings.pressure) : (readings.battery ?? null)
    const visivel =
      where.sessionId === undefined && where.workerId === SESSION.workerId && where.origin === SESSION.origin
    return visivel ? row : null
  })

/**
 * Reconhece o INSERT cru da condição. Hoje ele é a única coisa que passa pelo
 * `$queryRaw` do serviço, porque o lock consultivo saiu para o `$executeRaw`;
 * o filtro fica porque a varredura e o caminho do evento inserem pelo mesmo
 * caminho, e os casos precisam separar as duas inserções de uma rodada.
 */
const isInsert = (call: unknown[]) =>
  Array.isArray(call[0]) &&
  (call[0] as unknown as TemplateStringsArray).join('?').includes('INSERT INTO "TelemetryCondition"')
const insertCalls = (fn: jest.Mock) => fn.mock.calls.filter(isInsert)
const insertSql = (fn: jest.Mock, i = 0) =>
  (insertCalls(fn)[i][0] as TemplateStringsArray).join('?').replace(/\s+/g, ' ').trim()
const insertValues = (fn: jest.Mock, i = 0) => insertCalls(fn)[i].slice(1)
const firstInsert = (fn: jest.Mock) => fn.mock.invocationCallOrder[fn.mock.calls.findIndex(isInsert)]

const prismaDouble = () => {
  const db: any = {
    open: false,
    telemetrySession: { findUnique: jest.fn().mockResolvedValue(SESSION) },
    telemetryCondition: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(async ({ data }: any) => data),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      // Só a pulseira cria condição pelo cliente: a que já nasce recuperada.
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'condition-history', ...data })),
      // Último encerramento por vencimento de cada tipo: por padrão, nenhum.
      groupBy: jest.fn().mockResolvedValue([]),
    },
    operationalAlert: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'alert-new', ...data })),
    },
    telemetrySample: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    telemetrySnapshot: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    telemetryAssessment: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    profile: { findUnique: jest.fn().mockResolvedValue({ birthDate: new Date('1991-05-10T00:00:00.000Z') }) },
    telemetryDailySummary: { findMany: jest.fn().mockResolvedValue([{ heartRateMin: 62 }]) },
    // Calibração da origem REAL: sem linha nenhuma, vale a partida mínima e as
    // travas padrão do perfil calibrado.
    workerCalibration: { findUnique: jest.fn().mockResolvedValue(null) },
    workerCalibrationBand: { findMany: jest.fn().mockResolvedValue([]) },
    workerSafetyLimit: { findMany: jest.fn().mockResolvedValue([]) },
    // Pausa dos alertas: por padrão, monitorado normalmente.
    user: { findUnique: jest.fn().mockResolvedValue({ monitoringPausedAt: null }) },
  }
  db.$transaction = jest.fn(async (fn: any) => {
    db.open = true
    try {
      return await fn(db)
    } finally {
      db.open = false
    }
  })
  // O lock consultivo é comando, não leitura: pg_advisory_xact_lock devolve
  // void e o $queryRaw do Prisma estoura ao desserializar isso. O dublê separa
  // os dois caminhos como o serviço separa, para um caso não poder passar com o
  // serviço chamando a função errada.
  db.$executeRaw = jest.fn().mockResolvedValue(1)
  // A inserção da condição é crua, então o dublê responde o id criado.
  // `conflicting` faz o papel do índice único parcial: para o tipo que outro
  // escritor já abriu, o ON CONFLICT DO NOTHING devolve zero linhas em vez de
  // levantar.
  db.conflicting = new Set<string>()
  // A busca de candidatas do vencimento também é crua: `staleCandidates` faz o
  // papel das linhas que o NOT EXISTS devolveria.
  db.staleCandidates = []
  db.$queryRaw = jest.fn().mockImplementation(async (strings: any, ...values: unknown[]) => {
    // A busca do vencimento chega montada, como Prisma.Sql, e não como template.
    if (!Array.isArray(strings) && strings.sql.includes('NOT EXISTS')) return db.staleCandidates
    return values.some((v) => db.conflicting.has(v)) ? [] : [{ id: 'condition-new' }]
  })
  return db
}

/** Sessão de demonstração: a origem que segue o perfil v2, intocado pela calibração. */
const demoDouble = () => {
  const db = prismaDouble()
  db.telemetrySession.findUnique.mockResolvedValue({ ...SESSION, origin: 'DEMO' })
  return db
}

const firstCall = (fn: jest.Mock) => fn.mock.invocationCallOrder[0]
const realtimeDouble = () => ({ emitToUsers: jest.fn() })
/** Por padrão só o próprio funcionário, como quem não tem empresa. */
const audienceDouble = () => ({
  recipientsFor: jest.fn().mockImplementation(async (workerId: string) => [workerId]),
})
const notifierDouble = () => ({ notifyOpened: jest.fn().mockResolvedValue(undefined) })
const service = (
  prisma: any,
  realtime: ReturnType<typeof realtimeDouble> = realtimeDouble(),
  audience: ReturnType<typeof audienceDouble> = audienceDouble(),
  notifier: ReturnType<typeof notifierDouble> = notifierDouble(),
) =>
  new TelemetryConditionService(
    prisma as PrismaService,
    realtime as unknown as RealtimeGateway,
    audience as unknown as TelemetryAudienceService,
    notifier as unknown as TelemetryHealthNotifier,
  )
/** A chamada de leitura pontual que filtra a coluna dada. */
const readingCall = (fn: jest.Mock, column: string) =>
  fn.mock.calls.map((c) => c[0]).find((arg) => arg.where[column] !== undefined)

describe('TelemetryConditionService.evaluateSession: fiação', () => {
  it('trava o par funcionário e origem antes de qualquer leitura de condição', async () => {
    // O lock tem o escopo do invariante do índice único, (workerId, kind,
    // origin), e não o da linha da sessão: reconexão cria sessão nova, e duas
    // sessões do mesmo funcionário travando linhas diferentes não se enfileiram
    // e mexem no mesmo conjunto de condições.
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    // Pelo $executeRaw, e não pelo $queryRaw: a função devolve void, e o
    // desserializador do Prisma levanta antes de o lock ser tomado.
    const [sql, ...values] = prisma.$executeRaw.mock.calls[0]
    expect(sql.join('?')).toMatch(/pg_advisory_xact_lock\(hashtext\(/)
    expect(values[0]).toContain('worker-1')
    expect(values[0]).toContain('REAL')
    expect(firstCall(prisma.$executeRaw)).toBeLessThan(firstCall(prisma.telemetryCondition.findMany))
    expect(firstCall(prisma.$executeRaw)).toBeLessThan(firstCall(prisma.telemetrySample.findMany))
  })

  it('grava com a transação aberta, não depois de ela fechar', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    const abertaNaGravacao: boolean[] = []
    const raw = prisma.$queryRaw.getMockImplementation()
    prisma.$queryRaw.mockImplementation(async (...args: any[]) => {
      if (isInsert(args)) abertaNaGravacao.push(prisma.open)
      return raw(...args)
    })

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(abertaNaGravacao).toEqual([true])
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('sessão inexistente estoura', async () => {
    // Com o lock consultivo, zero linhas deixou de ser a prova de que a sessão
    // não existe: quem responde por isso agora é a busca da sessão, e a
    // conferência não pode sumir junto com o lock de linha.
    const prisma = prismaDouble()
    prisma.telemetrySession.findUnique.mockResolvedValue(null)

    await expect(service(prisma).evaluateSession('nada', NOW, NOW)).rejects.toThrow(/não existe/)
  })

  it('a janela de amostras serve só ao BPM, com a persistência mais longa do perfil da origem', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', secondsAgo(5), NOW)

    const { where, select } = prisma.telemetrySample.findMany.mock.calls[0][0]
    // Na REAL a janela é a da Atenção, 10 min; a trava recorta o último minuto.
    expect(where).toEqual({ sessionId: 'session-1', eventTime: { gte: secondsAgo(605), lte: secondsAgo(5) } })
    expect(select).toEqual({ eventTime: true, heartRateBpm: true })

    // Na DEMO segue a de 60 s do perfil v2.
    const demo = demoDouble()
    await service(demo).evaluateSession('session-1', secondsAgo(5), NOW)
    expect(demo.telemetrySample.findMany.mock.calls[0][0].where).toEqual({
      sessionId: 'session-1',
      eventTime: { gte: secondsAgo(65), lte: secondsAgo(5) },
    })
  })

  it('bateria é lida pelo prazo da bateria, 30 min, e não pela janela do BPM', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(readingCall(prisma.telemetrySample.findFirst, 'batteryPercent')).toEqual({
      where: {
        workerId: 'worker-1',
        origin: 'REAL',
        batteryPercent: { not: null },
        eventTime: { gte: minutesAgo(30), lte: NOW },
      },
      select: { batteryPercent: true },
      orderBy: { eventTime: 'desc' },
    })
  })

  it('pressão é lida pelo prazo do vencimento, 24 h, e não pela janela do BPM', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(readingCall(prisma.telemetrySample.findFirst, 'systolicMmHg')).toEqual({
      where: {
        workerId: 'worker-1',
        origin: 'REAL',
        systolicMmHg: { not: null },
        diastolicMmHg: { not: null },
        eventTime: { gt: hoursAgo(24), lte: NOW },
      },
      select: { systolicMmHg: true, diastolicMmHg: true, eventTime: true },
      orderBy: { eventTime: 'desc' },
    })
  })

  // A pulseira entrega a pressão horas depois de medir. Abrir com a hora da
  // chegada diria ao painel que a pessoa estava com 150 agora, quando a
  // medição é de manhã.
  it('pressão abre com a hora em que foi medida, não com a da chegada', async () => {
    const prisma = prismaDouble()
    const medidaEm = hoursAgo(3)
    prisma.telemetrySample.findFirst = latestReadings({
      pressure: { systolicMmHg: 150, diastolicMmHg: 80, eventTime: medidaEm },
    })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['BLOOD_PRESSURE_FATIGUE'])
    expect(insertValues(prisma.$queryRaw).slice(5, 7)).toEqual([medidaEm, NOW])
  })

  it('pressão carimbada no futuro, pela folga do relógio adiantado, abre com agora', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findFirst = latestReadings({
      pressure: { systolicMmHg: 150, diastolicMmHg: 80, eventTime: new Date(NOW.getTime() + 30_000) },
    })

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(insertValues(prisma.$queryRaw)[5]).toEqual(NOW)
  })

  it('lê condições ativas do funcionário NA MESMA ORIGEM: demonstração não cega o real', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    const { where, select } = prisma.telemetryCondition.findMany.mock.calls[0][0]
    expect(where).toEqual({ workerId: 'worker-1', origin: 'REAL', status: 'ACTIVE' })
    // lastSeenAt entra na projeção porque é ele que decide se o carimbo precisa
    // ser renovado no fim da avaliação.
    expect(select).toEqual({ id: true, kind: true, lastSeenAt: true })
  })

  it('evento que não é ao vivo não avalia nada: condição descreve o agora', async () => {
    // Um gatilho de horas atrás veria uma série densa e sustentada da manhã e
    // gravaria firstSeenAt de agora, jurando 185 bpm neste instante; e a perda
    // de sinal recuperaria com o backlog "provando" que o sinal voltou.
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-sig', 'DEVICE_SIGNAL_LOST')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    const outcome = await service(prisma).evaluateSession('session-1', secondsAgo(121), NOW)

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
    expect(prisma.telemetryCondition.update).not.toHaveBeenCalled()
  })
})

describe('TelemetryConditionService.evaluateSession: abrir', () => {
  it('BPM alto sustentado na origem REAL grava a trava padrão do perfil calibrado, o dia da calibração e abre alerta', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_HIGH'], recovered: [], alerts: 1 })
    const values = insertValues(prisma.$queryRaw)
    expect(values).toEqual([
      'worker-1',
      'session-1',
      'REAL',
      'HEART_RATE_HIGH',
      'ACTIVE',
      NOW,
      NOW,
      CALIBRATED_ALERT_PROFILE_VERSION,
      'SAFETY_DEFAULT',
      expect.any(Number),
      185,
      1,
      NOW,
    ])
    // Quem nasceu em `1991-05-10` tem 35 anos completos no dia monitorado de
    // `2026-09-07`, então a máxima por idade (Tanaka) é 208 - 0,7 x 35 = 183,5, e
    // 90% dela arredondado dá 165. O número entra fixo de propósito: se o
    // perfil ou a fórmula mudarem, a mudança aparece aqui, e não numa condição
    // aberta em produção.
    expect(values[9]).toBe(165)
    expect(prisma.operationalAlert.create.mock.calls[0][0].data).toMatchObject({
      conditionId: 'condition-new',
      workerId: 'worker-1',
      origin: 'REAL',
      status: 'OPEN',
    })
  })

  it('sem data de nascimento, BPM alto abre pelo piso e a linha diz FLOOR', async () => {
    const prisma = demoDouble()
    prisma.profile.findUnique.mockResolvedValue({ birthDate: null })
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries(182))

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(insertValues(prisma.$queryRaw).slice(8, 10)).toEqual(['FLOOR', 180])
  })

  it('bateria baixa abre condição e NÃO abre alerta: aparelho é estado, não item de fila', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findFirst = latestReadings({ battery: { batteryPercent: 12 } })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['DEVICE_BATTERY_LOW'])
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('bateria lida há dez minutos ainda abre: o prazo dela é 30 min, não os 60 s do BPM', async () => {
    const prisma = prismaDouble()
    // A janela do BPM não traz coluna de bateria nenhuma; quem acha a leitura é
    // a busca própria, e é ela que prova que o prazo é o do domínio.
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(5, 80)])
    prisma.telemetrySample.findFirst = latestReadings({ battery: { batteryPercent: 9 } })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['DEVICE_BATTERY_LOW'])
  })

  it('bateria medida em outra sessão do mesmo funcionário, dentro do prazo, ainda abre', async () => {
    // Sessão nova nasce a cada reconexão do relógio, e o prazo da bateria é de
    // 30 min. Recortada por sessão, uma leitura de dez minutos atrás ficaria
    // invisível só porque o relógio reconectou no meio. A condição já é
    // chaveada por funcionário e origem justamente porque sobrevive à sessão.
    const prisma = prismaDouble()
    prisma.telemetrySample.findFirst = readingsOfAnotherSession({ battery: { batteryPercent: 9 } })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['DEVICE_BATTERY_LOW'])
  })

  it('pressão medida em outra sessão do mesmo funcionário, dentro do prazo, ainda abre', async () => {
    // O prazo da pressão é de 24 h: uma medição de horas atrás é atual,
    // e nesse intervalo o relógio reconectou várias vezes. Recorte por sessão
    // esconderia dela a medição que o painel mostra na tela.
    const prisma = prismaDouble()
    prisma.telemetrySample.findFirst = readingsOfAnotherSession({
      pressure: { systolicMmHg: 150, diastolicMmHg: 80 },
    })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['BLOOD_PRESSURE_FATIGUE'])
  })

  it('pressão fora da faixa abre condição e alerta, com a régua que cruzou', async () => {
    const prisma = demoDouble()
    prisma.telemetrySample.findFirst = latestReadings({ pressure: { systolicMmHg: 150, diastolicMmHg: 80 } })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['BLOOD_PRESSURE_REVIEW'])
    expect(prisma.operationalAlert.create).toHaveBeenCalledTimes(1)
    expect(insertValues(prisma.$queryRaw).slice(8, 10)).toEqual(['FLOOR', 140])
  })

  it('pressão carimbada antes da janela do BPM ainda é avaliada', async () => {
    // Pressão é medida à mão e raramente. Presa à janela de 60 s do BPM, uma
    // medição que chegasse com carimbo mais velho que a amostra mais nova do
    // lote não seria avaliada por chamada nenhuma: a janela seguinte já andou.
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue([sampleRow(5, 80)])
    prisma.telemetrySample.findFirst = latestReadings({ pressure: { systolicMmHg: 150, diastolicMmHg: 80 } })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['BLOOD_PRESSURE_FATIGUE'])
  })

  it('desgaste em 80% ou mais abre condição E alerta: é o alerta que a narrativa do piloto promete', async () => {
    const prisma = demoDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue({ wearPercent: 82 })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['WEAR_HIGH'])
    expect(outcome.alerts).toBe(1)
    expect(prisma.operationalAlert.create).toHaveBeenCalledTimes(1)
    expect(insertValues(prisma.$queryRaw).slice(8, 11)).toEqual(['FLOOR', 80, 82])
  })

  it('desgaste em 79% não abre nada', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue({ wearPercent: 79 })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual([])
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('o desgaste é lido da avaliação mais recente DA SESSÃO, até o gatilho e dentro do prazo do domínio', async () => {
    // Por sessão, e não por funcionário: a cadeia da fórmula reinicia a cada
    // sessão, e é o desgaste dessa cadeia que a condição descreve. O prazo é o
    // mesmo que torna esforço e desgaste indisponíveis no painel: avaliação
    // mais velha que isso não descreve o agora, e não pode abrir condição.
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.telemetryAssessment.findFirst).toHaveBeenCalledWith({
      where: { sessionId: 'session-1', windowEnd: { gte: secondsAgo(120), lte: NOW } },
      select: { wearPercent: true },
      orderBy: { windowEnd: 'desc' },
    })
  })

  it('não abre alerta novo enquanto houver um não resolvido do mesmo funcionário, tipo E ORIGEM', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.operationalAlert.findFirst.mockResolvedValue({ id: 'alert-old' })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_HIGH'], recovered: [], alerts: 0 })
    expect(prisma.operationalAlert.findFirst.mock.calls[0][0].where).toEqual({
      workerId: 'worker-1',
      origin: 'REAL',
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      condition: { kind: 'HEART_RATE_HIGH', OR: [{ recoveryReason: null }, { recoveryReason: { not: 'NO_NEW_READING' } }] },
    })
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('alerta de demonstração aberto não suprime o alerta real do mesmo tipo', async () => {
    // Demonstração nunca é triada, então o alerta dela fica OPEN para sempre.
    // Sem a origem na busca, ele calaria a fila real daquele funcionário e
    // daquele tipo para o resto do piloto, e o painel voltaria a mostrar zero
    // urgente com a condição real aberta.
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    const fila = [{ id: 'alert-demo', workerId: 'worker-1', origin: 'DEMO', status: 'OPEN' }]
    prisma.operationalAlert.findFirst.mockImplementation(
      async ({ where }: any) =>
        fila.find(
          (a) => a.workerId === where.workerId && (where.origin === undefined || a.origin === where.origin),
        ) ?? null,
    )

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_HIGH'], recovered: [], alerts: 1 })
    expect(prisma.operationalAlert.create).toHaveBeenCalledTimes(1)
  })

  it('a inserção da condição é crua, com ON CONFLICT DO NOTHING e as mesmas colunas de antes', async () => {
    // Crua porque é a única escrita do serviço que pode conflitar, e o preço do
    // conflito é a transação inteira: o Prisma não envolve consulta individual
    // em savepoint. As colunas são afirmadas uma a uma porque é aqui que a
    // linha nasce, e uma coluna esquecida no SQL só apareceria em produção.
    const prisma = demoDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    const sql = insertSql(prisma.$queryRaw)
    const colunas = /INSERT INTO "TelemetryCondition" \(([^)]*)\)/
      .exec(sql)?.[1]
      .split(',')
      .map((c) => c.trim().replaceAll('"', ''))
    expect(colunas).toEqual([
      'id',
      'workerId',
      'sessionId',
      'origin',
      'kind',
      'status',
      'firstSeenAt',
      'lastSeenAt',
      'thresholdProfile',
      'thresholdRule',
      'thresholdValue',
      'observedValue',
      'calibrationDay',
      'updatedAt',
    ])
    // id e updatedAt não têm padrão no banco: os do schema são do cliente
    // Prisma, e a inserção crua passa por fora dele.
    expect(sql).toMatch(/gen_random_uuid\(\)::text/)
    expect(sql).toMatch(/ON CONFLICT \("workerId", "kind", "origin"\) WHERE "status" = 'ACTIVE' DO NOTHING/)
    expect(sql).toMatch(/RETURNING id/)
    expect(insertValues(prisma.$queryRaw)).toEqual([
      'worker-1',
      'session-1',
      'DEMO',
      'HEART_RATE_HIGH',
      'ACTIVE',
      NOW,
      NOW,
      ALERT_PROFILE_VERSION,
      'PERSONALIZED',
      165,
      185,
      null,
      NOW,
    ])
  })

  it('conflito na inserção não conta como aberta, não abre alerta e não estoura', async () => {
    // Zero linhas do ON CONFLICT DO NOTHING é o sinal de que outro escritor
    // chegou primeiro, e o estado desejado já é o que está no banco.
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.conflicting.add('HEART_RATE_HIGH')

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('conflito na primeira abertura não impede a segunda nem desfaz a recuperação do lote', async () => {
    // O caso que a ordem sozinha não cobria: com duas aberturas no mesmo lote,
    // a violação de unicidade na primeira punha a transação em estado abortado
    // e a segunda morria com 25P02, que não é P2002, subia, e levava junto a
    // recuperação já gravada. Sem exceção nenhuma, as três escritas convivem.
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-sig', 'DEVICE_SIGNAL_LOST')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.telemetrySample.findFirst = latestReadings({ pressure: { systolicMmHg: 150, diastolicMmHg: 80 } })
    prisma.conflicting.add('HEART_RATE_HIGH')

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['BLOOD_PRESSURE_FATIGUE'], recovered: ['DEVICE_SIGNAL_LOST'], alerts: 1 })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(2)
    expect(insertValues(prisma.$queryRaw, 1)).toContain('BLOOD_PRESSURE_FATIGUE')
    expect(prisma.telemetryCondition.update.mock.calls[0][0].data).toMatchObject({ status: 'RECOVERED' })
  })

  it('recuperação do lote é gravada ANTES de qualquer abertura', async () => {
    // Deixou de ser a garantia contra a transação abortada, que agora é do ON
    // CONFLICT, e virou ordem de leitura: fechar o que já não vale antes de
    // abrir o que passou a valer.
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-sig', 'DEVICE_SIGNAL_LOST')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_HIGH'], recovered: ['DEVICE_SIGNAL_LOST'], alerts: 1 })
    expect(prisma.telemetryCondition.update.mock.calls[0][0]).toMatchObject({ where: { id: 'c-sig' } })
    expect(firstCall(prisma.telemetryCondition.update)).toBeLessThan(firstInsert(prisma.$queryRaw))
  })

  it('erro de escrita que não é conflito de unicidade continua subindo', async () => {
    // O ON CONFLICT cobre a violação do índice único, e só ela: deadlock,
    // tempo esgotado e afins continuam derrubando a avaliação, como devem.
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    const raw = prisma.$queryRaw.getMockImplementation()
    prisma.$queryRaw.mockImplementation(async (...args: any[]) => {
      if (isInsert(args)) throw new Error('deadlock detected')
      return raw(...args)
    })

    await expect(service(prisma).evaluateSession('session-1', NOW, NOW)).rejects.toThrow(/deadlock/)
  })

  it('condição já ativa e ainda acima do limite: nada é gravado', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-1', 'HEART_RATE_HIGH')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
    expect(prisma.telemetryCondition.update).not.toHaveBeenCalled()
  })
})

describe('TelemetryConditionService.evaluateSession: lastSeenAt', () => {
  it('condição ativa não recuperada tem o carimbo renovado', async () => {
    // lastSeenAt é "última vez que uma avaliação cobriu este funcionário com a
    // condição ainda aberta", e não "quando ela abriu" nem "quando a evidência
    // foi confirmada". Sem renovar, uma condição ativa há três horas com o
    // funcionário mandando dado o tempo todo mostra carimbo de três horas
    // atrás, e o índice [status, lastSeenAt] passa a apontar para o nada.
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-1', 'HEART_RATE_HIGH', minutesAgo(180))])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.telemetryCondition.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { lastSeenAt: NOW },
    })
  })

  it('carimbo com menos de 60 s não é reescrito: esta é a rota mais quente do backend', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-1', 'HEART_RATE_HIGH', secondsAgo(59))])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.telemetryCondition.update).not.toHaveBeenCalled()
  })

  it('condição recuperada não leva renovação por cima: quem fechou não segue aberta', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-1', 'HEART_RATE_HIGH', minutesAgo(180))])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries(120))

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.telemetryCondition.update).toHaveBeenCalledTimes(1)
    expect(prisma.telemetryCondition.update.mock.calls[0][0].data).toMatchObject({ status: 'RECOVERED' })
  })
})

describe('TelemetryConditionService.evaluateSession: recuperar', () => {
  it('desgaste ativo recupera abaixo de 70, e não entre 70 e 80', async () => {
    const prisma = demoDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-wear', 'WEAR_HIGH')])
    prisma.telemetryAssessment.findFirst.mockResolvedValue({ wearPercent: 75 })

    expect((await service(prisma).evaluateSession('session-1', NOW, NOW)).recovered).toEqual([])
    expect(prisma.telemetryCondition.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RECOVERED' }) }),
    )

    prisma.telemetryAssessment.findFirst.mockResolvedValue({ wearPercent: 65 })

    expect((await service(prisma).evaluateSession('session-1', NOW, NOW)).recovered).toEqual(['WEAR_HIGH'])
    expect(prisma.telemetryCondition.update).toHaveBeenCalledWith({
      where: { id: 'c-wear' },
      data: { status: 'RECOVERED', recoveredAt: NOW, recoveryReason: 'NORMALIZED', lastSeenAt: NOW },
    })
  })

  it('BPM de volta abaixo da banda recupera com motivo NORMALIZED e carimbo', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-1', 'HEART_RATE_HIGH')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries(120))

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.recovered).toEqual(['HEART_RATE_HIGH'])
    expect(prisma.telemetryCondition.update.mock.calls[0][0]).toEqual({
      where: { id: 'c-1' },
      data: { status: 'RECOVERED', recoveredAt: NOW, recoveryReason: 'NORMALIZED', lastSeenAt: NOW },
    })
  })

  it('evento ao vivo recupera perda de sinal ativa, com motivo SIGNAL_RESTORED', async () => {
    // NORMALIZED quer dizer "o valor voltou pela banda", e perda de sinal não
    // tem valor nem banda. Sem motivo próprio, quem audita não separa "o
    // batimento normalizou" de "o relógio voltou a falar", e esta é a condição
    // que mais vai oscilar no piloto.
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-sig', 'DEVICE_SIGNAL_LOST')])

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.recovered).toEqual(['DEVICE_SIGNAL_LOST'])
    expect(prisma.telemetryCondition.update.mock.calls[0][0].data).toMatchObject({
      status: 'RECOVERED',
      recoveryReason: 'SIGNAL_RESTORED',
    })
  })
})

// A origem REAL pelo perfil calibrado: a faixa da pessoa abre a Atenção, as
// travas (padrão ou do admin) abrem o urgente, e a condição leva o dia da
// calibração. As decisões estão provadas no motor; aqui, o que é lido e gravado.
describe('TelemetryConditionService.evaluateSession: origem REAL calibrada', () => {
  /** Amostras a cada 5 s cobrindo os últimos `minutes` minutos. */
  const beats = (minutes: number, bpm: number) =>
    Array.from({ length: minutes * 12 + 1 }, (_, i) => sampleRow(minutes * 60 - i * 5, bpm))
  /** Avaliações a cada 20 s cobrindo os últimos 10 min. */
  const wearRows = (percent: number) =>
    Array.from({ length: 31 }, (_, i) => ({ windowEnd: secondsAgo(600 - i * 20), wearPercent: percent }))
  const calibrated = (prisma: any, validDays: number) => {
    prisma.workerCalibration.findUnique.mockResolvedValue({ validDays, restingBpm: 58 })
    prisma.workerCalibrationBand.findMany.mockResolvedValue([
      { metric: 'HEART_RATE', learnedCuts: { excellence: 95, fatigue: 130 }, overrideCuts: null },
    ])
  }

  it('lê a calibração, as faixas e as travas do próprio funcionário', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.workerCalibration.findUnique.mock.calls[0][0].where).toEqual({ workerId: 'worker-1' })
    expect(prisma.workerCalibrationBand.findMany.mock.calls[0][0].where).toEqual({ workerId: 'worker-1' })
    expect(prisma.workerSafetyLimit.findMany.mock.calls[0][0].where).toEqual({ workerId: 'worker-1' })
  })

  it('10 min acima do corte de fadiga abrem a Atenção, com a régua da faixa e o dia da calibração', async () => {
    const prisma = prismaDouble()
    calibrated(prisma, 9)
    prisma.telemetrySample.findMany.mockResolvedValue(beats(10, 140))

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_FATIGUE'], recovered: [], alerts: 1 })
    expect(insertValues(prisma.$queryRaw).slice(7, 12)).toEqual([CALIBRATED_ALERT_PROFILE_VERSION, 'BAND', 130, 140, 10])
  })

  it('calibração fechada (30 dias válidos) grava a condição sem o dia', async () => {
    const prisma = prismaDouble()
    calibrated(prisma, 30)
    prisma.telemetrySample.findMany.mockResolvedValue(beats(10, 140))

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(insertValues(prisma.$queryRaw)[11]).toBeNull()
  })

  it('a trava de batimento alto do admin abre pelo valor dele', async () => {
    const prisma = prismaDouble()
    prisma.workerSafetyLimit.findMany.mockResolvedValue([{ rule: 'HEART_RATE_HIGH', values: { openAt: 150, closeAt: 140 } }])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries(155))

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['HEART_RATE_HIGH'])
    expect(insertValues(prisma.$queryRaw).slice(8, 11)).toEqual(['SAFETY_CUSTOM', 150, 155])
  })

  it('o desgaste da Atenção vem das avaliações da sessão dos últimos 10 min', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findMany.mockResolvedValue(wearRows(85))
    prisma.telemetryAssessment.findFirst.mockResolvedValue({ wearPercent: 85 })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.telemetryAssessment.findMany.mock.calls[0][0]).toEqual({
      where: { sessionId: 'session-1', wearPercent: { not: null }, windowEnd: { gte: minutesAgo(10), lte: NOW } },
      select: { windowEnd: true, wearPercent: true },
    })
    // 85% fica abaixo da trava de 90: só a Atenção, pelo corte de partida 80.
    expect(outcome.opened).toEqual(['WEAR_FATIGUE'])
    expect(insertValues(prisma.$queryRaw).slice(8, 11)).toEqual(['BAND', 80, 85])
  })

  it('desgaste em 90% abre a trava padrão', async () => {
    const prisma = prismaDouble()
    prisma.telemetryAssessment.findFirst.mockResolvedValue({ wearPercent: 92 })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['WEAR_HIGH'])
    expect(insertValues(prisma.$queryRaw).slice(8, 11)).toEqual(['SAFETY_DEFAULT', 90, 92])
  })

  it('pressão em 185 por 112 abre a Atenção e a trava, e nunca a revisão', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findFirst = latestReadings({ pressure: { systolicMmHg: 185, diastolicMmHg: 112 } })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['BLOOD_PRESSURE_FATIGUE', 'BLOOD_PRESSURE_HIGH'], recovered: [], alerts: 2 })
  })

  it('a medição avulsa decide só a pressão, pelo perfil calibrado, e renova o carimbo das condições de pressão', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([
      activeRow('c-bp', 'BLOOD_PRESSURE_HIGH', minutesAgo(5)),
      activeRow('c-hr', 'HEART_RATE_FATIGUE', minutesAgo(5)),
    ])
    prisma.telemetrySample.findMany.mockResolvedValue(beats(10, 175))
    prisma.telemetrySample.findFirst = latestReadings({ pressure: { systolicMmHg: 170, diastolicMmHg: 80 } })

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    // 170 por 80 está na faixa de fadiga (a partir de 140) e acima da
    // recuperação da trava (160): a trava segue aberta e a Atenção abre. O
    // batimento do relógio não é decidido, e o carimbo dele não anda.
    expect(outcome).toEqual({ opened: ['BLOOD_PRESSURE_FATIGUE'], recovered: [], alerts: 1 })
    expect(prisma.telemetryCondition.update.mock.calls.map((c: any) => c[0].where.id)).toEqual(['c-bp'])
  })

  it('a demonstração não lê calibração nem a série de desgaste', async () => {
    const prisma = demoDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.workerCalibration.findUnique).not.toHaveBeenCalled()
    expect(prisma.workerSafetyLimit.findMany).not.toHaveBeenCalled()
    expect(prisma.telemetryAssessment.findMany).not.toHaveBeenCalled()
    expect(oxygenCall(prisma)).toBeUndefined()
  })

  // Oxigenação é pontual, como a pressão: as duas últimas leituras do
  // funcionário e da origem nas últimas 12 h, em qualquer sessão.
  it('lê as duas últimas leituras de oxigenação do funcionário nas últimas 12 h', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(oxygenCall(prisma)).toEqual({
      where: {
        workerId: 'worker-1',
        origin: 'REAL',
        oxygenSaturationPct: { not: null },
        eventTime: { gte: hoursAgo(12), lte: NOW },
      },
      select: { eventTime: true, oxygenSaturationPct: true },
      orderBy: { eventTime: 'desc' },
      take: 2,
    })
  })

  it('oxigenação em 89% no evento do relógio abre a trava, urgente', async () => {
    const prisma = prismaDouble()
    withOxygen(prisma, [{ minAgo: 0, pct: 89 }])

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['OXYGEN_LOW'], recovered: [], alerts: 1 })
    expect(insertValues(prisma.$queryRaw)).toEqual(
      expect.arrayContaining(['OXYGEN_LOW', CALIBRATED_ALERT_PROFILE_VERSION, 'SAFETY_DEFAULT', 90, 89]),
    )
  })

  it('a Atenção de oxigenação só abre com corte de fadiga aprendido', async () => {
    const semFaixa = prismaDouble()
    withOxygen(semFaixa, [
      { minAgo: 0, pct: 93 },
      { minAgo: 12, pct: 93 },
    ])
    expect((await service(semFaixa).evaluateSession('session-1', NOW, NOW)).opened).toEqual([])

    const comFaixa = prismaDouble()
    comFaixa.workerCalibration.findUnique.mockResolvedValue({ validDays: 9, restingBpm: 58 })
    comFaixa.workerCalibrationBand.findMany.mockResolvedValue([
      { metric: 'OXYGEN_SATURATION', learnedCuts: { excellence: 97, fatigue: 94 }, overrideCuts: null },
    ])
    withOxygen(comFaixa, [
      { minAgo: 0, pct: 93 },
      { minAgo: 12, pct: 93 },
    ])
    expect((await service(comFaixa).evaluateSession('session-1', NOW, NOW)).opened).toEqual(['OXYGEN_FATIGUE'])
  })
})

// A porta da medição avulsa: pressão lida do app Saúde, que chega pelo iPhone
// sem o relógio ter falado. Ela decide a revisão de pressão e mais nada: tudo
// o que o relógio mede fica como o último evento dele deixou.
describe('TelemetryConditionService.evaluateSpotReading', () => {
  const HIGH = { systolicMmHg: 150, diastolicMmHg: 80 }
  const NORMAL = { systolicMmHg: 120, diastolicMmHg: 78 }

  it('pressão fora da faixa abre a revisão, com alerta', async () => {
    const prisma = demoDouble()
    prisma.telemetrySample.findFirst = latestReadings({ pressure: HIGH })

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome.opened).toEqual(['BLOOD_PRESSURE_REVIEW'])
    expect(prisma.operationalAlert.create).toHaveBeenCalledTimes(1)
  })

  it('medição nova dentro da banda recupera a revisão aberta', async () => {
    const prisma = demoDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-bp', 'BLOOD_PRESSURE_REVIEW')])
    prisma.telemetrySample.findFirst = latestReadings({ pressure: NORMAL })

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome.recovered).toEqual(['BLOOD_PRESSURE_REVIEW'])
  })

  // O relógio descarregou com 10% e parou de falar. A varredura já recuperou a
  // bateria baixa por silêncio. Uma pressão que chega pelo iPhone não pode
  // reabri-la a partir daquela leitura velha: ninguém mediu bateria de novo.
  it('não decide bateria: leitura velha do relógio não reabre bateria baixa', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findFirst = latestReadings({ battery: { batteryPercent: 10 }, pressure: NORMAL })

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome.opened).toEqual([])
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
  })

  it('não decide batimento nem desgaste', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.telemetryAssessment.findFirst.mockResolvedValue({ wearPercent: 95 })

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome.opened).toEqual([])
  })

  it('não recupera perda de sinal nem renova o carimbo de condição do relógio', async () => {
    // Uma pressão digitada no app Saúde não é o relógio falando, e o carimbo
    // das condições dele só anda quando uma avaliação DELE roda.
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([
      activeRow('c-sig', 'DEVICE_SIGNAL_LOST', minutesAgo(180)),
      activeRow('c-hr', 'HEART_RATE_HIGH', minutesAgo(180)),
    ])
    prisma.telemetrySample.findFirst = latestReadings({ pressure: NORMAL })

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome.recovered).toEqual([])
    expect(prisma.telemetryCondition.update).not.toHaveBeenCalled()
  })

  it('renova o carimbo da revisão de pressão que segue aberta', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([
      activeRow('c-bp', 'BLOOD_PRESSURE_REVIEW', minutesAgo(180)),
    ])
    prisma.telemetrySample.findFirst = latestReadings({ pressure: HIGH })

    await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(prisma.telemetryCondition.update).toHaveBeenCalledTimes(1)
    expect(prisma.telemetryCondition.update).toHaveBeenCalledWith({
      where: { id: 'c-bp' },
      data: { lastSeenAt: NOW },
    })
  })

  it('decide a oxigenação na REAL e renova o carimbo dela', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([
      activeRow('c-ox', 'OXYGEN_LOW', minutesAgo(5)),
      activeRow('c-hr', 'HEART_RATE_FATIGUE', minutesAgo(5)),
    ])
    withOxygen(prisma, [{ minAgo: 30, pct: 88 }])

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(prisma.telemetryCondition.update.mock.calls.map((c: any) => c[0].where.id)).toEqual(['c-ox'])
  })

  it('oxigenação de volta acima de 92% fecha a trava', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-ox', 'OXYGEN_LOW')])
    withOxygen(prisma, [{ minAgo: 0, pct: 93 }])

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome.recovered).toEqual(['OXYGEN_LOW'])
  })

  it('a demonstração não decide oxigenação', async () => {
    const prisma = demoDouble()
    withOxygen(prisma, [{ minAgo: 0, pct: 85 }])

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome.opened).toEqual([])
    expect(oxygenCall(prisma)).toBeUndefined()
  })

  it('lê a oxigenação até a folga de relógio adiantado', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(oxygenCall(prisma).where.eventTime).toEqual({ gte: hoursAgo(12), lte: new Date(NOW.getTime() + 2 * 60 * 1000) })
  })

  // A ingestão aceita horário até dois minutos à frente do servidor. Uma
  // medição carimbada nessa folga já está gravada e à vista no painel, então
  // tem de entrar na conta da revisão que a chegada dela dispara.
  it('lê a pressão até a folga de relógio adiantado, e não só até agora', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findFirst = latestReadings({ pressure: HIGH })

    await service(prisma).evaluateSpotReading('session-1', NOW)

    const { where } = readingCall(prisma.telemetrySample.findFirst, 'systolicMmHg')
    expect(where.eventTime.lte).toEqual(new Date(NOW.getTime() + 2 * 60 * 1000))
    expect(where.eventTime.gt).toEqual(hoursAgo(24))
  })
})

// A porta da AUSÊNCIA. Perda de sinal não nasce de um valor que chegou, nasce
// de nada ter chegado, e o caminho do evento é cego para isso por definição:
// relógio calado não dispara chamada nenhuma. Estes casos protegem a varredura
// periódica: quem entra na conta, o que ela grava, e que rodar de novo sobre o
// mesmo silêncio não grava nada.

/** Uma linha do snapshot como a busca de candidatas a lê: só a sessão. */
const candidateRow = (sessionId: string | null) => ({ sessionId })

/**
 * Uma candidata calada há `secAgo` segundos. A busca acha a sessão e a
 * releitura dentro da transação diz há quanto tempo ela está calada: os dois
 * passos são separados de propósito, porque o silêncio muda entre um e outro.
 */
const silentFor = (prisma: any, secAgo: number, sessionId = 'session-1') => {
  prisma.telemetrySnapshot.findMany.mockResolvedValue([candidateRow(sessionId)])
  prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastLiveEventTime: secondsAgo(secAgo) })
}

/**
 * Candidatas como o BANCO as devolveria: o dublê aplica a fronteira de
 * `lastLiveEventTime` que o serviço pediu, em vez de devolver a lista inteira.
 * É o que permite afirmar comportamento, e não só a forma do `where`.
 */
const snapshotOf = (prisma: any, rows: Array<{ sessionId: string; lastLiveEventTime: Date }>) => {
  prisma.telemetrySnapshot.findMany.mockImplementation(async ({ where }: any) =>
    rows
      .filter((r) => r.lastLiveEventTime < where.lastLiveEventTime.lt)
      .filter((r) => where.lastLiveEventTime.gte === undefined || r.lastLiveEventTime >= where.lastLiveEventTime.gte)
      .map((r) => candidateRow(r.sessionId)),
  )
  prisma.telemetrySnapshot.findFirst.mockImplementation(async ({ where }: any) => {
    const row = rows.find((r) => r.sessionId === where.sessionId)
    return row === undefined ? null : { lastLiveEventTime: row.lastLiveEventTime }
  })
}

/**
 * Dublê com estado nas condições: a inserção crua entra na lista de ativas e a
 * recuperação sai dela. É o que permite rodar a varredura duas vezes seguidas e
 * afirmar que a segunda não escreve.
 */
const withConditionState = (prisma: any, rows: Array<{ id: string; kind: string }>) => {
  const state: any[] = rows.map((r) => ({ ...r, lastSeenAt: secondsAgo(10), status: 'ACTIVE' }))
  prisma.telemetryCondition.findMany.mockImplementation(async () => state.filter((r) => r.status === 'ACTIVE'))
  prisma.telemetryCondition.update.mockImplementation(async ({ where, data }: any) => {
    const row = state.find((r) => r.id === where.id)
    Object.assign(row, data)
    return row
  })
  const raw = prisma.$queryRaw.getMockImplementation()
  prisma.$queryRaw.mockImplementation(async (...args: any[]) => {
    const result = await raw(...args)
    // O quarto valor do INSERT é o tipo da condição, pela ordem das colunas.
    if (isInsert(args)) state.push({ id: `c-${state.length}`, kind: args[4], lastSeenAt: NOW, status: 'ACTIVE' })
    return result
  })
  return state
}

describe('TelemetryConditionService.sweepSilentSessions: quem entra na conta', () => {
  it('só olha origem REAL: demonstração encerrada não pode corromper o estado real', async () => {
    // O snapshot tem UMA linha por funcionário e a origem é substituída por
    // inteiro. Sem o filtro, uma demonstração rodada por cima de um funcionário
    // com batimento alto aberto em REAL faria a varredura travar a sessão
    // DEMO, ler as condições de (funcionário, DEMO), não recuperar nada e abrir
    // perda de sinal em DEMO: a condição real ficaria aberta para sempre e
    // perda de sinal real nenhuma seria registrada.
    const prisma = prismaDouble()

    await service(prisma).sweepSilentSessions(NOW)

    expect(prisma.telemetrySnapshot.findMany.mock.calls[0][0].where.origin).toBe('REAL')
  })

  it('a busca de candidatas não tem teto de turno: recuperar não pode depender de a gente estar rodando', async () => {
    // Só a fronteira do silêncio, e fechada em cima de propósito: o prazo é o
    // mesmo que o caminho do evento usa para dizer "ao vivo", e um carimbo
    // exatamente em cima dele é ao vivo lá. Sessão nula não é candidata: não há
    // funcionário e origem para travar.
    const prisma = prismaDouble()

    await service(prisma).sweepSilentSessions(NOW)

    const { where, select } = prisma.telemetrySnapshot.findMany.mock.calls[0][0]
    expect(where).toEqual({
      origin: 'REAL',
      sessionId: { not: null },
      lastLiveEventTime: { lt: secondsAgo(120), gte: daysAgo(7) },
    })
    // lastLiveEventTime sai da projeção: o silêncio que vale é o relido dentro da
    // transação, e não este, que envelhece durante o laço.
    expect(select).toEqual({ sessionId: true })
  })

  it('mede pelo último evento ao vivo, sem olhar o tipo do aparelho', async () => {
    // Horas sem lote é o normal da pulseira pelo Health Connect, e o lote dela
    // nunca anda o carimbo ao vivo: quem só tem lote fica com ele nulo, e nulo
    // não passa em fronteira nenhuma. A pulseira pelo Bluetooth fala ao vivo e
    // entra na conta como o relógio.
    const prisma = prismaDouble()

    await service(prisma).sweepSilentSessions(NOW)

    const { where } = prisma.telemetrySnapshot.findMany.mock.calls[0][0]
    expect(where).not.toHaveProperty('OR')
    expect(where).not.toHaveProperty('deviceKind')
    expect(where).not.toHaveProperty('lastEventTime')
  })

  it('snapshot que nunca falou ao vivo não tem silêncio a medir', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySnapshot.findMany.mockResolvedValue([candidateRow('session-1')])
    prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastLiveEventTime: null })

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 1, signalLost: 0, recovered: 0 })
  })

  it('candidata calada há três dias continua sendo varrida', async () => {
    // O piso existe para descartar quem SAIU do piloto, e não para encurtar
    // queda longa: fim de semana emendado em feriado cabe folgado dentro dele,
    // e é exatamente esse caso que a ausência de teto superior protegia.
    const prisma = prismaDouble()
    snapshotOf(prisma, [{ sessionId: 'session-1', lastLiveEventTime: daysAgo(3) }])

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome.scanned).toBe(1)
  })

  it('candidata calada há oito dias deixa de ser candidata', async () => {
    // Sem o piso, quem devolveu o relógio fica candidato para sempre, e como a
    // ordem é pela mais calada ele vem NA FRENTE de todo mundo e come uma vaga
    // do teto a cada 30 s. Com desligados o bastante, os vivos param de ser
    // varridos: o histórico vira negação de serviço lenta.
    const prisma = prismaDouble()
    snapshotOf(prisma, [{ sessionId: 'session-1', lastLiveEventTime: daysAgo(8) }])

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome.scanned).toBe(0)
  })

  it('o piso é de sete dias', async () => {
    expect(MONITORED_SILENCE_FLOOR_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('a rodada tem teto de candidatas, e a mais calada vem primeiro', async () => {
    // Precedente do ciclo de vida: rodada de tamanho previsível. Sem o teto,
    // backend fora do ar por dez minutos põe todo mundo na mesma rodada. A
    // ordem faz o teto cortar as menos urgentes.
    const prisma = prismaDouble()

    await service(prisma).sweepSilentSessions(NOW)

    const { orderBy, take } = prisma.telemetrySnapshot.findMany.mock.calls[0][0]
    expect(orderBy).toEqual({ lastLiveEventTime: 'asc' })
    expect(take).toBe(MAX_SILENT_SESSIONS_PER_RUN)
  })

  it('rodada que bate o teto vira aviso: o resto ficou para a seguinte', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const prisma = prismaDouble()
    prisma.telemetrySnapshot.findMany.mockResolvedValue(
      Array.from({ length: MAX_SILENT_SESSIONS_PER_RUN }, (_, i) => candidateRow(`session-${i}`)),
    )
    prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastLiveEventTime: secondsAgo(300) })

    await service(prisma).sweepSilentSessions(NOW)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/teto/i)
    warn.mockRestore()
  })

  it('trava o par funcionário e origem, e não a linha da sessão', async () => {
    // O invariante do índice único é (workerId, kind, origin), e o lock tem de
    // ter o mesmo escopo. Travando a linha da SESSÃO, duas sessões do mesmo
    // funcionário (reconexão cria sessão nova) travam linhas distintas, não se
    // enfileiram, e mexem no mesmo conjunto de condições. A varredura torna
    // isso comum: ela trava a sessão que veio do snapshot enquanto o lote novo
    // trava a nova.
    const prisma = prismaDouble()
    silentFor(prisma, 300)

    await service(prisma).sweepSilentSessions(NOW)

    // Pelo $executeRaw, pelo mesmo motivo do caminho do evento: void não
    // desserializa, e o lock tem de ser tomado como comando.
    const [sql, ...values] = prisma.$executeRaw.mock.calls[0]
    expect(sql.join('?')).toMatch(/pg_advisory_xact_lock\(hashtext\(/)
    expect(values[0]).toContain('worker-1')
    expect(values[0]).toContain('REAL')
    expect(firstCall(prisma.$executeRaw)).toBeLessThan(firstCall(prisma.telemetryCondition.findMany))
  })

  it('sessão que sumiu entre a busca e o lock estoura', async () => {
    // O lock consultivo não olha linha nenhuma, então zero linhas deixou de
    // significar "sessão inexistente". A conferência tem de continuar existindo
    // por outro caminho.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const prisma = prismaDouble()
    silentFor(prisma, 300)
    prisma.telemetrySession.findUnique.mockResolvedValue(null)

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 1, signalLost: 0, recovered: 0 })
    expect(warn.mock.calls[0][0]).toMatch(/não existe/)
    warn.mockRestore()
  })
})

describe('TelemetryConditionService.sweepSilentSessions: abrir e recuperar', () => {
  it('silêncio abre DEVICE_SIGNAL_LOST com a régua do perfil, e NÃO abre alerta', async () => {
    // Sem regra personalizada: não se personaliza silêncio. O limite gravado é
    // o prazo que abriu, e o valor observado é o silêncio medido, para a
    // auditoria saber quanto tempo o relógio ficou calado. Aparelho fora do
    // alcance é estado do funcionário, não item de fila.
    const prisma = prismaDouble()
    silentFor(prisma, 300)

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 1, signalLost: 1, recovered: 0 })
    expect(insertValues(prisma.$queryRaw)).toEqual([
      'worker-1',
      'session-1',
      'REAL',
      'DEVICE_SIGNAL_LOST',
      'ACTIVE',
      NOW,
      NOW,
      CALIBRATED_ALERT_PROFILE_VERSION,
      null,
      120_000,
      300_000,
      null,
      NOW,
    ])
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('perda de sinal já ativa não é aberta de novo', async () => {
    const prisma = prismaDouble()
    silentFor(prisma, 300)
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-sig', 'DEVICE_SIGNAL_LOST')])

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 1, signalLost: 0, recovered: 0 })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
    expect(prisma.telemetryCondition.update).not.toHaveBeenCalled()
  })

  it('silêncio recupera batimento, bateria e desgaste com motivo SIGNAL_LOST, e deixa a pressão em paz', async () => {
    // Batimento, bateria e desgaste são contínuos: sem relógio falando, o
    // valor que sustentava a condição deixou de existir, e mantê-la aberta
    // seria afirmar um agora que ninguém mediu. Desgaste vem da avaliação, e
    // a avaliação só nasce de evento ao vivo. Pressão é medida à mão e vale
    // por 24 h: silêncio do relógio não diz nada sobre a pressão de ninguém, e
    // ela só recupera por medição nova (ou vence sem leitura nova).
    const prisma = prismaDouble()
    silentFor(prisma, 300)
    prisma.telemetryCondition.findMany.mockResolvedValue([
      activeRow('c-alto', 'HEART_RATE_HIGH'),
      activeRow('c-baixo', 'HEART_RATE_LOW'),
      activeRow('c-bat', 'DEVICE_BATTERY_LOW'),
      activeRow('c-wear', 'WEAR_HIGH'),
      activeRow('c-pressao', 'BLOOD_PRESSURE_REVIEW'),
    ])

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 1, signalLost: 1, recovered: 4 })
    const fechada = { status: 'RECOVERED', recoveredAt: NOW, recoveryReason: 'SIGNAL_LOST', lastSeenAt: NOW }
    expect(prisma.telemetryCondition.update.mock.calls.map((c: any[]) => c[0])).toEqual([
      { where: { id: 'c-alto' }, data: fechada },
      { where: { id: 'c-baixo' }, data: fechada },
      { where: { id: 'c-bat' }, data: fechada },
      { where: { id: 'c-wear' }, data: fechada },
    ])
  })

  it('a recuperação por silêncio é gravada ANTES da abertura da perda de sinal', async () => {
    // Mesma ordem do caminho do evento: fechar o que já não vale antes de abrir
    // o que passou a valer deixa a linha do tempo na ordem dos fatos.
    const prisma = prismaDouble()
    silentFor(prisma, 300)
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-alto', 'HEART_RATE_HIGH')])

    await service(prisma).sweepSilentSessions(NOW)

    expect(firstCall(prisma.telemetryCondition.update)).toBeLessThan(firstInsert(prisma.$queryRaw))
  })

  it('silêncio além do teto de turno recupera, mas não abre perda de sinal', async () => {
    // Os dois tetos são diferentes de propósito. Valor que ninguém mede não
    // vale, tenha o silêncio dois minutos ou dois dias, então recuperar não
    // olha teto nenhum: uma queda de fim de semana não pode deixar o batimento
    // alto de sexta aberto até alguém notar. Abrir olha, porque relógio no
    // armário há dois dias não é notícia para a operação.
    const prisma = prismaDouble()
    silentFor(prisma, 10 * 60 * 60)
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-alto', 'HEART_RATE_HIGH')])

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 1, signalLost: 0, recovered: 1 })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
  })

  it('o silêncio gravado é o relido dentro da transação, e não o da busca', async () => {
    // A busca acha a candidata e o laço leva tempo: gravar o carimbo da busca
    // subestima o silêncio pelo tempo que a rodada gastou até chegar nesta
    // sessão, e a coluna de auditoria passa a mentir para menos.
    const prisma = prismaDouble()
    prisma.telemetrySnapshot.findMany.mockResolvedValue([candidateRow('session-1')])
    prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastLiveEventTime: secondsAgo(600) })

    await service(prisma).sweepSilentSessions(NOW)

    // O silêncio observado é o penúltimo valor do INSERT, pela ordem das colunas.
    expect(insertValues(prisma.$queryRaw)[10]).toBe(600_000)
  })

  it('candidata que voltou a falar entre a busca e o lock não é tocada', async () => {
    // Quem chegou depois tem a informação mais nova: se um lote entrou entre a
    // busca e o lock, quem manda é ele, e a varredura não tem o que dizer.
    const prisma = prismaDouble()
    prisma.telemetrySnapshot.findMany.mockResolvedValue([candidateRow('session-1')])
    prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastLiveEventTime: secondsAgo(3) })
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-alto', 'HEART_RATE_HIGH')])

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 1, signalLost: 0, recovered: 0 })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
    expect(prisma.telemetryCondition.update).not.toHaveBeenCalled()
  })
})

describe('TelemetryConditionService.sweepSilentSessions: repetição e falha', () => {
  it('segunda varredura sobre a mesma sessão ainda silenciosa não grava nada', async () => {
    // A varredura roda a cada 30 s e o silêncio dura minutos: sem idempotência,
    // cada rodada empilharia escrita sobre o mesmo estado.
    const prisma = prismaDouble()
    silentFor(prisma, 300)
    withConditionState(prisma, [{ id: 'c-alto', kind: 'HEART_RATE_HIGH' }])
    const svc = service(prisma)

    const primeira = await svc.sweepSilentSessions(NOW)
    const gravacoes = insertCalls(prisma.$queryRaw).length + prisma.telemetryCondition.update.mock.calls.length
    const segunda = await svc.sweepSilentSessions(NOW)

    expect(primeira).toEqual({ scanned: 1, signalLost: 1, recovered: 1 })
    expect(segunda).toEqual({ scanned: 1, signalLost: 0, recovered: 0 })
    expect(insertCalls(prisma.$queryRaw).length + prisma.telemetryCondition.update.mock.calls.length).toBe(gravacoes)
  })

  it('falha numa sessão não impede a seguinte', async () => {
    // Cada candidata na sua transação: uma sessão problemática não pode deixar
    // o resto do turno sem perda de sinal registrada.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const prisma = prismaDouble()
    prisma.telemetrySnapshot.findMany.mockResolvedValue([candidateRow('session-ruim'), candidateRow('session-1')])
    prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastLiveEventTime: secondsAgo(300) })
    prisma.telemetrySession.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'session-ruim') throw new Error('deadlock detected')
      return SESSION
    })

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 2, signalLost: 1, recovered: 0 })
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

// A pulseira chega em lote, horas depois de medir: o dia é percorrido em ordem
// depois da avaliação esparsa. Só o que segue ativo na última leitura do lote
// vira item de fila e aviso; o episódio inteiro dentro do lote é histórico.
describe('TelemetryConditionService.evaluateBandDay', () => {
  const band = (beats: Array<[number, number]>, over: Record<string, unknown> = {}) => ({
    workerId: 'worker-1',
    origin: 'REAL' as const,
    sessionId: 'session-band',
    batch: {
      beats: beats.map(([minAgo, value]) => ({ atMs: minutesAgo(minAgo).getTime(), value })),
      wear: [],
      sinceMs: 0,
    },
    ...over,
  })

  it('trava o par funcionário e origem antes de ler as condições', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateBandDay(band([[30, 80]]), NOW)

    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['worker-1:REAL'])
    expect(firstCall(prisma.$executeRaw)).toBeLessThan(firstCall(prisma.telemetryCondition.findMany))
  })

  it('episódio que abriu e fechou no lote vira histórico já recuperado, sem alerta nem aviso', async () => {
    const prisma = prismaDouble()
    const realtime = realtimeDouble()
    const notifier = notifierDouble()

    // Nascido em 1991, 35 anos: a trava de batimento alto é 165, e recupera abaixo de 155.
    const outcome = await service(prisma, realtime, audienceDouble(), notifier).evaluateBandDay(
      band([
        [60, 200],
        [55, 150],
      ]),
      NOW,
    )

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(prisma.telemetryCondition.create).toHaveBeenCalledTimes(1)
    expect(prisma.telemetryCondition.create.mock.calls[0][0].data).toEqual({
      workerId: 'worker-1',
      sessionId: 'session-band',
      origin: 'REAL',
      kind: 'HEART_RATE_HIGH',
      status: 'RECOVERED',
      firstSeenAt: minutesAgo(60),
      lastSeenAt: minutesAgo(55),
      recoveredAt: minutesAgo(55),
      recoveryReason: 'NORMALIZED',
      thresholdProfile: CALIBRATED_ALERT_PROFILE_VERSION,
      thresholdRule: 'SAFETY_DEFAULT',
      thresholdValue: 165,
      observedValue: 200,
      calibrationDay: 1,
      receivedAt: NOW,
    })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
    expect(realtime.emitToUsers).not.toHaveBeenCalled()
    expect(notifier.notifyOpened).not.toHaveBeenCalled()
  })

  it('o que segue ativo no fim do lote abre no instante medido, com alerta e aviso depois do commit', async () => {
    const prisma = prismaDouble()
    const realtime = realtimeDouble()
    const notifier = notifierDouble()

    const outcome = await service(prisma, realtime, audienceDouble(), notifier).evaluateBandDay(band([[30, 200]]), NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_HIGH'], recovered: [], alerts: 1 })
    // firstSeenAt é o instante medido; lastSeenAt é a avaliação, agora.
    expect(insertValues(prisma.$queryRaw).slice(5, 7)).toEqual([minutesAgo(30), NOW])
    expect(insertValues(prisma.$queryRaw)).toEqual(
      expect.arrayContaining(['HEART_RATE_HIGH', CALIBRATED_ALERT_PROFILE_VERSION, 'SAFETY_DEFAULT', 165, 200]),
    )
    expect(prisma.operationalAlert.create).toHaveBeenCalledTimes(1)
    const change = { workerId: 'worker-1', conditionId: 'condition-new', kind: 'HEART_RATE_HIGH', change: 'OPENED', at: NOW.toISOString() }
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['worker-1'], 'telemetry.condition.changed', change)
    expect(notifier.notifyOpened).toHaveBeenCalledWith([change])
  })

  it('condição já aberta fecha no instante medido da leitura de volta', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-hr', 'HEART_RATE_HIGH')])

    const outcome = await service(prisma).evaluateBandDay(band([[10, 150]]), NOW)

    expect(outcome).toEqual({ opened: [], recovered: ['HEART_RATE_HIGH'], alerts: 0 })
    expect(prisma.telemetryCondition.update).toHaveBeenCalledWith({
      where: { id: 'c-hr' },
      data: { status: 'RECOVERED', recoveredAt: minutesAgo(10), recoveryReason: 'NORMALIZED', lastSeenAt: minutesAgo(10) },
    })
  })

  it('usa a faixa e as travas do próprio funcionário', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateBandDay(band([[30, 80]]), NOW)

    expect(prisma.workerCalibrationBand.findMany.mock.calls[0][0].where).toEqual({ workerId: 'worker-1' })
    expect(prisma.workerSafetyLimit.findMany.mock.calls[0][0].where).toEqual({ workerId: 'worker-1' })
  })

  it('a demonstração não é avaliada', async () => {
    const prisma = prismaDouble()

    const outcome = await service(prisma).evaluateBandDay(band([[30, 200]], { origin: 'DEMO' }), NOW)

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('TelemetryConditionService.evaluateBandDay: episódios repetidos', () => {
  // Um episódio atrasado de batimento alto: abre e fecha no mesmo lote.
  const band = (beats: Array<[number, number]>) => ({
    workerId: 'worker-1',
    origin: 'REAL' as const,
    sessionId: 'session-band',
    batch: {
      beats: beats.map(([minAgo, value]) => ({ atMs: minutesAgo(minAgo).getTime(), value })),
      wear: [],
      sinceMs: 0,
    },
  })
  const lateEpisode = band([
    [60, 200],
    [55, 150],
  ])
  // NOW é 12 h UTC de 7/9, 9 h em Brasília: o dia monitorado vai das 3 h UTC
  // de 7/9 às 3 h UTC de 8/9.
  const DAY = { gte: new Date('2026-09-07T03:00:00.000Z'), lt: new Date('2026-09-08T03:00:00.000Z') }

  /** Dublê com os episódios atrasados do dia e, se houver, o repetido já gravado. */
  const withLateEpisodes = (late: Date[], existing: { id: string } | null = null) => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockImplementation(async ({ where }: any) =>
      where.receivedAt === undefined ? [] : late.map((firstSeenAt) => ({ firstSeenAt })),
    )
    prisma.telemetryCondition.findFirst = jest.fn().mockResolvedValue(existing)
    prisma.telemetryCondition.create.mockImplementation(async ({ data }: any) => ({
      id: data.kind === 'REPEATED_EPISODES' ? 'condition-repeated' : 'condition-history',
    }))
    return prisma
  }
  const repeatedCreate = (prisma: any) =>
    prisma.telemetryCondition.create.mock.calls.map((c: any) => c[0].data).find((d: any) => d.kind === 'REPEATED_EPISODES')

  it('conta só os episódios atrasados do mesmo tipo, funcionário, origem e dia monitorado', async () => {
    const prisma = withLateEpisodes([minutesAgo(60)])

    await service(prisma).evaluateBandDay(lateEpisode, NOW)

    const count = prisma.telemetryCondition.findMany.mock.calls.map((c: any) => c[0]).find((a: any) => a.where.receivedAt)
    expect(count.where).toEqual({
      workerId: 'worker-1',
      origin: 'REAL',
      kind: 'HEART_RATE_HIGH',
      receivedAt: { not: null },
      firstSeenAt: DAY,
    })
    expect(count.orderBy).toEqual({ firstSeenAt: 'asc' })
  })

  it('dois episódios no dia não abrem nada', async () => {
    const prisma = withLateEpisodes([minutesAgo(120), minutesAgo(60)])
    const notifier = notifierDouble()

    const outcome = await service(prisma, realtimeDouble(), audienceDouble(), notifier).evaluateBandDay(lateEpisode, NOW)

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(repeatedCreate(prisma)).toBeUndefined()
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
    expect(notifier.notifyOpened).not.toHaveBeenCalled()
  })

  it('o terceiro abre a condição nascida recuperada no instante medido do terceiro, com alerta e aviso', async () => {
    const third = minutesAgo(60)
    const prisma = withLateEpisodes([minutesAgo(180), minutesAgo(120), third])
    const realtime = realtimeDouble()
    const notifier = notifierDouble()

    const outcome = await service(prisma, realtime, audienceDouble(), notifier).evaluateBandDay(lateEpisode, NOW)

    expect(outcome).toEqual({ opened: ['REPEATED_EPISODES'], recovered: [], alerts: 1 })
    expect(prisma.telemetryCondition.findFirst.mock.calls[0][0].where).toEqual({
      workerId: 'worker-1',
      origin: 'REAL',
      kind: 'REPEATED_EPISODES',
      episodeKind: 'HEART_RATE_HIGH',
      firstSeenAt: DAY,
    })
    expect(repeatedCreate(prisma)).toEqual({
      workerId: 'worker-1',
      sessionId: 'session-band',
      origin: 'REAL',
      kind: 'REPEATED_EPISODES',
      episodeKind: 'HEART_RATE_HIGH',
      status: 'RECOVERED',
      firstSeenAt: third,
      lastSeenAt: third,
      recoveredAt: third,
      recoveryReason: 'NORMALIZED',
      thresholdProfile: CALIBRATED_ALERT_PROFILE_VERSION,
      thresholdRule: null,
      thresholdValue: 3,
      observedValue: 3,
      calibrationDay: 1,
      receivedAt: NOW,
    })
    // O alerta nasce sem a regra de um pendente por tipo: ela olharia a fila.
    expect(prisma.operationalAlert.findFirst).not.toHaveBeenCalled()
    expect(prisma.operationalAlert.create).toHaveBeenCalledWith({
      data: { conditionId: 'condition-repeated', workerId: 'worker-1', origin: 'REAL', status: 'OPEN' },
    })
    const change = {
      workerId: 'worker-1',
      conditionId: 'condition-repeated',
      kind: 'REPEATED_EPISODES',
      change: 'OPENED',
      at: NOW.toISOString(),
    }
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['worker-1'], 'telemetry.condition.changed', change)
    expect(notifier.notifyOpened).toHaveBeenCalledWith([change])
  })

  it('o terceiro é o da hora medida, mesmo quando o lote que chegou por último é mais antigo', async () => {
    // A pulseira sincronizou o começo do dia depois: o terceiro medido é o de 120.
    const prisma = withLateEpisodes([minutesAgo(240), minutesAgo(180), minutesAgo(120), minutesAgo(60)])

    await service(prisma).evaluateBandDay(lateEpisode, NOW)

    expect(repeatedCreate(prisma)).toMatchObject({ firstSeenAt: minutesAgo(120), observedValue: 4 })
  })

  it('com a do dia já gravada, o quarto não repete', async () => {
    const prisma = withLateEpisodes([minutesAgo(240), minutesAgo(180), minutesAgo(120), minutesAgo(60)], {
      id: 'condition-old',
    })

    const outcome = await service(prisma).evaluateBandDay(lateEpisode, NOW)

    expect(outcome.alerts).toBe(0)
    expect(repeatedCreate(prisma)).toBeUndefined()
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('condição que fica ativa no fim do lote não é episódio atrasado e não entra na conta', async () => {
    const prisma = withLateEpisodes([minutesAgo(180), minutesAgo(120), minutesAgo(60)])

    await service(prisma).evaluateBandDay(band([[30, 200]]), NOW)

    expect(prisma.telemetryCondition.findMany.mock.calls.some((c: any) => c[0].where.receivedAt)).toBe(false)
    expect(repeatedCreate(prisma)).toBeUndefined()
  })
})

describe('TelemetryConditionService: alertas pausados', () => {
  const paused = (prisma: any) => prisma.user.findUnique.mockResolvedValue({ monitoringPausedAt: hoursAgo(2) })
  const band = (beats: Array<[number, number]>) => ({
    workerId: 'worker-1',
    origin: 'REAL' as const,
    sessionId: 'session-band',
    batch: { beats: beats.map(([minAgo, value]) => ({ atMs: minutesAgo(minAgo).getTime(), value })), wear: [], sinceMs: 0 },
  })

  it('lote ao vivo de risco não abre condição, alerta nem aviso, e lê a pausa dentro da transação', async () => {
    const prisma = prismaDouble()
    paused(prisma)
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    const realtime = realtimeDouble()
    const notifier = notifierDouble()

    const outcome = await service(prisma, realtime, audienceDouble(), notifier).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
    expect(realtime.emitToUsers).not.toHaveBeenCalled()
    expect(notifier.notifyOpened).not.toHaveBeenCalled()
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'worker-1' }, select: { monitoringPausedAt: true } })
    expect(firstCall(prisma.$executeRaw)).toBeLessThan(firstCall(prisma.user.findUnique))
  })

  it('o que já estava aberto segue o ciclo normal e recupera', async () => {
    const prisma = prismaDouble()
    paused(prisma)
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-1', 'HEART_RATE_HIGH')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries(120))

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.recovered).toEqual(['HEART_RATE_HIGH'])
    expect(prisma.telemetryCondition.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { status: 'RECOVERED', recoveredAt: NOW, recoveryReason: 'NORMALIZED', lastSeenAt: NOW },
    })
  })

  it('lote comum, sem nada a abrir, não consulta a pausa', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('medição avulsa fora da faixa não abre', async () => {
    const prisma = prismaDouble()
    paused(prisma)
    prisma.telemetrySample.findFirst = latestReadings({
      pressure: { systolicMmHg: 190, diastolicMmHg: 120, eventTime: NOW },
    })

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome.opened).toEqual([])
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
  })

  it('silêncio não abre perda de sinal', async () => {
    const prisma = prismaDouble()
    paused(prisma)
    silentFor(prisma, 300)

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 1, signalLost: 0, recovered: 0 })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
  })

  it('o lote da pulseira não grava episódio novo, nem o que já nasce recuperado', async () => {
    const prisma = prismaDouble()
    paused(prisma)

    const outcome = await service(prisma).evaluateBandDay(
      band([
        [90, 200],
        [85, 150],
        [30, 200],
      ]),
      NOW,
    )

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(prisma.telemetryCondition.create).not.toHaveBeenCalled()
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('no lote da pulseira, o que já estava aberto ainda recupera', async () => {
    const prisma = prismaDouble()
    paused(prisma)
    prisma.telemetryCondition.findMany.mockResolvedValue([{ id: 'c-band', kind: 'HEART_RATE_HIGH' }])

    const outcome = await service(prisma).evaluateBandDay(band([[30, 120]]), NOW)

    expect(outcome.recovered).toEqual(['HEART_RATE_HIGH'])
  })
})

describe('TelemetryConditionService: notificação de saúde', () => {
  // A notificação lê a condição gravada; antes do commit ela ainda não existe
  // para quem lê.
  it('entrega as mudanças ao notificador depois do commit', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    const notifier = notifierDouble()
    let openAtNotify: boolean | undefined
    notifier.notifyOpened.mockImplementation(async () => {
      openAtNotify = prisma.open
    })

    await service(prisma, realtimeDouble(), audienceDouble(), notifier).evaluateSession('session-1', NOW, NOW)

    expect(openAtNotify).toBe(false)
    expect(notifier.notifyOpened).toHaveBeenCalledWith([
      { workerId: 'worker-1', conditionId: 'condition-new', kind: 'HEART_RATE_HIGH', change: 'OPENED', at: NOW.toISOString() },
    ])
  })

  it('transação que falha não notifica', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.operationalAlert.create.mockRejectedValue(new Error('falha de escrita'))
    const notifier = notifierDouble()

    await expect(service(prisma, realtimeDouble(), audienceDouble(), notifier).evaluateSession('session-1', NOW, NOW)).rejects.toThrow('falha de escrita')
    expect(notifier.notifyOpened).not.toHaveBeenCalled()
  })

  it('falha do notificador não derruba a avaliação', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    const notifier = notifierDouble()
    notifier.notifyOpened.mockRejectedValue(new Error('fila fora'))
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const outcome = await service(prisma, realtimeDouble(), audienceDouble(), notifier).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_HIGH'], recovered: [], alerts: 1 })
    warn.mockRestore()
  })

  it('a varredura de silêncio entrega a perda de sinal ao notificador', async () => {
    const prisma = prismaDouble()
    silentFor(prisma, 300)
    const notifier = notifierDouble()

    await service(prisma, realtimeDouble(), audienceDouble(), notifier).sweepSilentSessions(NOW)

    const delivered = notifier.notifyOpened.mock.calls.flatMap((c: any[]) => c[0])
    expect(delivered).toContainEqual(expect.objectContaining({ kind: 'DEVICE_SIGNAL_LOST', change: 'OPENED' }))
  })
})

describe('TelemetryConditionService: aviso de condição em tempo real', () => {
  // O painel atualiza a fila sem recarregar. O aviso só carrega identificadores,
  // e sai depois do commit: antes, quem recebesse buscaria uma condição que o
  // banco ainda não mostra.
  it('condição aberta avisa depois do commit, com identificadores e nenhum valor de saúde', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    const realtime = realtimeDouble()
    let openAtEmit: boolean | undefined
    realtime.emitToUsers.mockImplementation(() => {
      openAtEmit = prisma.open
    })

    await service(prisma, realtime).evaluateSession('session-1', NOW, NOW)

    expect(openAtEmit).toBe(false)
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['worker-1'], 'telemetry.condition.changed', {
      workerId: 'worker-1',
      conditionId: 'condition-new',
      kind: 'HEART_RATE_HIGH',
      change: 'OPENED',
      at: NOW.toISOString(),
    })
  })

  it('condição recuperada avisa com o id da linha que fechou', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-1', 'HEART_RATE_HIGH')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries(120))
    const realtime = realtimeDouble()

    await service(prisma, realtime).evaluateSession('session-1', NOW, NOW)

    expect(realtime.emitToUsers).toHaveBeenCalledWith(['worker-1'], 'telemetry.condition.changed', {
      workerId: 'worker-1',
      conditionId: 'c-1',
      kind: 'HEART_RATE_HIGH',
      change: 'RECOVERED',
      at: NOW.toISOString(),
    })
  })

  it('vai ao funcionário e aos administradores da empresa dele', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    const realtime = realtimeDouble()
    const audience = audienceDouble()
    audience.recipientsFor.mockResolvedValue(['worker-1', 'admin-1'])

    await service(prisma, realtime, audience).evaluateSession('session-1', NOW, NOW)

    expect(audience.recipientsFor).toHaveBeenCalledWith('worker-1')
    expect(realtime.emitToUsers.mock.calls[0][0]).toEqual(['worker-1', 'admin-1'])
  })

  it('sem condição aberta nem recuperada, não avisa nada', async () => {
    const prisma = prismaDouble()
    const realtime = realtimeDouble()

    await service(prisma, realtime).evaluateSession('session-1', NOW, NOW)

    expect(realtime.emitToUsers).not.toHaveBeenCalled()
  })

  it('transação que falha não avisa: nada foi gravado', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.operationalAlert.create.mockRejectedValue(new Error('falha de escrita'))
    const realtime = realtimeDouble()

    await expect(service(prisma, realtime).evaluateSession('session-1', NOW, NOW)).rejects.toThrow('falha de escrita')
    expect(realtime.emitToUsers).not.toHaveBeenCalled()
  })

  // O alerta já está gravado: uma falha de socket não pode desfazer nem
  // esconder isso de quem chamou, e o painel reconcilia pelo REST.
  it('falha do socket não derruba a avaliação', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    const realtime = realtimeDouble()
    realtime.emitToUsers.mockImplementation(() => {
      throw new Error('socket down')
    })
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const outcome = await service(prisma, realtime).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: ['HEART_RATE_HIGH'], recovered: [], alerts: 1 })
    warn.mockRestore()
  })

  it('a varredura de silêncio avisa as recuperações e a perda de sinal, depois do commit', async () => {
    const prisma = prismaDouble()
    silentFor(prisma, 300)
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-alto', 'HEART_RATE_HIGH')])
    const realtime = realtimeDouble()
    const openAtEmit: boolean[] = []
    realtime.emitToUsers.mockImplementation(() => openAtEmit.push(prisma.open))

    await service(prisma, realtime).sweepSilentSessions(NOW)

    expect(openAtEmit).toEqual([false, false])
    expect(realtime.emitToUsers.mock.calls.map((c: any[]) => c[2])).toEqual([
      { workerId: 'worker-1', conditionId: 'c-alto', kind: 'HEART_RATE_HIGH', change: 'RECOVERED', at: NOW.toISOString() },
      {
        workerId: 'worker-1',
        conditionId: 'condition-new',
        kind: 'DEVICE_SIGNAL_LOST',
        change: 'OPENED',
        at: NOW.toISOString(),
      },
    ])
  })
})

/** Condição ativa de saúde como a busca crua do vencimento a devolve. */
const staleRow = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  workerId: 'worker-1',
  origin: 'REAL',
  kind,
  ...over,
})

/**
 * Amostras do banco para a reconferência sob o lock. O dublê filtra como o
 * banco filtraria (funcionário, origem, fronteira de eventTime e coluna não
 * nula), para os casos afirmarem a fronteira, e não a forma do `where`.
 */
const samplesOf = (prisma: any, rows: Array<{ hoursAgo: number; column: string; workerId?: string }>) => {
  prisma.telemetrySample.findFirst.mockImplementation(async ({ where }: any) => {
    const hit = rows.find(
      (r) =>
        (r.workerId ?? 'worker-1') === where.workerId &&
        where.origin === 'REAL' &&
        where[r.column] !== undefined &&
        hoursAgo(r.hoursAgo).getTime() > where.eventTime.gt.getTime(),
    )
    return hit === undefined ? null : { eventTime: hoursAgo(hit.hoursAgo) }
  })
}

const closedByNoNewReading = { status: 'RECOVERED', recoveredAt: NOW, recoveryReason: 'NO_NEW_READING', lastSeenAt: NOW }

describe('TelemetryConditionService.sweepNoNewReading: a métrica de cada condição', () => {
  it('o prazo é o "recente" da régua da medição: 24 h', () => {
    expect(NO_NEW_READING_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('batimento sustenta batimento e desgaste; oxigenação e pressão, as suas; aparelho não vence', () => {
    // O desgaste deriva do batimento: sem batimento novo em 24 h, a condição de
    // desgaste vence. Bateria e perda de sinal são estado do aparelho, e o
    // silêncio e o evento ao vivo já cuidam delas.
    expect(NO_NEW_READING_METRIC).toEqual({
      HEART_RATE_HIGH: 'heartRateBpm',
      HEART_RATE_LOW: 'heartRateBpm',
      HEART_RATE_FATIGUE: 'heartRateBpm',
      WEAR_HIGH: 'heartRateBpm',
      WEAR_FATIGUE: 'heartRateBpm',
      OXYGEN_FATIGUE: 'oxygenSaturationPct',
      OXYGEN_LOW: 'oxygenSaturationPct',
      BLOOD_PRESSURE_REVIEW: 'systolicMmHg',
      BLOOD_PRESSURE_FATIGUE: 'systolicMmHg',
      BLOOD_PRESSURE_HIGH: 'systolicMmHg',
      DEVICE_BATTERY_LOW: null,
      DEVICE_SIGNAL_LOST: null,
      REPEATED_EPISODES: null,
      HELP_REQUESTED: null,
    })
  })

  it('a busca de candidatas nunca pede tipo de aparelho', async () => {
    const prisma = prismaDouble()

    await service(prisma).sweepNoNewReading(NOW)

    const { sql, values } = prisma.$queryRaw.mock.calls[0][0]
    expect(sql).toContain('NOT EXISTS')
    expect(values).not.toContain('DEVICE_BATTERY_LOW')
    expect(values).not.toContain('DEVICE_SIGNAL_LOST')
    expect(values).toContain('BLOOD_PRESSURE_HIGH')
    expect(values).toContainEqual(new Date(NOW.getTime() - NO_NEW_READING_MS))
  })

  it.each([
    ['HEART_RATE_HIGH', 'heartRateBpm'],
    ['WEAR_FATIGUE', 'heartRateBpm'],
    ['OXYGEN_LOW', 'oxygenSaturationPct'],
    ['BLOOD_PRESSURE_FATIGUE', 'systolicMmHg'],
  ])('%s: amostra da própria métrica há 23 h segura a condição aberta', async (kind, column) => {
    const prisma = prismaDouble()
    prisma.staleCandidates = [staleRow('c-1', kind)]
    samplesOf(prisma, [{ hoursAgo: 23, column }])

    const outcome = await service(prisma).sweepNoNewReading(NOW)

    expect(outcome).toEqual({ scanned: 1, recovered: 0 })
    expect(prisma.telemetryCondition.updateMany).not.toHaveBeenCalled()
  })

  it('amostra de OUTRA métrica não segura: batimento de agora não renova a pressão', async () => {
    const prisma = prismaDouble()
    prisma.staleCandidates = [staleRow('c-pressao', 'BLOOD_PRESSURE_HIGH')]
    samplesOf(prisma, [{ hoursAgo: 0, column: 'heartRateBpm' }])

    const outcome = await service(prisma).sweepNoNewReading(NOW)

    expect(outcome).toEqual({ scanned: 1, recovered: 1 })
  })
})

describe('TelemetryConditionService.sweepNoNewReading: a fronteira das 24 h', () => {
  it('última medição a exatamente 24 h vence', async () => {
    const prisma = prismaDouble()
    prisma.staleCandidates = [staleRow('c-pressao', 'BLOOD_PRESSURE_HIGH')]
    samplesOf(prisma, [{ hoursAgo: 24, column: 'systolicMmHg' }])

    const outcome = await service(prisma).sweepNoNewReading(NOW)

    expect(outcome).toEqual({ scanned: 1, recovered: 1 })
    expect(prisma.telemetryCondition.updateMany).toHaveBeenCalledWith({
      where: { id: 'c-pressao', status: 'ACTIVE' },
      data: closedByNoNewReading,
    })
  })

  it('última medição um milissegundo antes das 24 h não vence', async () => {
    const prisma = prismaDouble()
    prisma.staleCandidates = [staleRow('c-pressao', 'BLOOD_PRESSURE_HIGH')]
    samplesOf(prisma, [{ hoursAgo: 24 - 1 / 3_600_000, column: 'systolicMmHg' }])

    const outcome = await service(prisma).sweepNoNewReading(NOW)

    expect(outcome).toEqual({ scanned: 1, recovered: 0 })
  })
})

describe('TelemetryConditionService.sweepNoNewReading: fechar', () => {
  it('trava funcionário e origem antes de reconferir a amostra e de gravar', async () => {
    // Mesmo lock do caminho do evento e da varredura de silêncio: é ele que
    // garante que uma condição fecha por um motivo só, o de quem chegou antes.
    const prisma = prismaDouble()
    prisma.staleCandidates = [staleRow('c-1', 'HEART_RATE_HIGH')]

    await service(prisma).sweepNoNewReading(NOW)

    const [sql, ...values] = prisma.$executeRaw.mock.calls[0]
    expect((sql as TemplateStringsArray).join('?')).toContain('pg_advisory_xact_lock')
    expect(values).toEqual(['worker-1:REAL'])
    expect(firstCall(prisma.$executeRaw)).toBeLessThan(firstCall(prisma.telemetrySample.findFirst))
    expect(firstCall(prisma.$executeRaw)).toBeLessThan(firstCall(prisma.telemetryCondition.updateMany))
  })

  it('condição já fechada por outro motivo não é regravada nem anunciada', async () => {
    // A varredura de silêncio chegou antes: o ACTIVE no `where` é o que mantém
    // o motivo dela, e zero linhas atualizadas não viram evento.
    const prisma = prismaDouble()
    prisma.staleCandidates = [staleRow('c-1', 'HEART_RATE_HIGH')]
    prisma.telemetryCondition.updateMany.mockResolvedValue({ count: 0 })
    const realtime = realtimeDouble()

    const outcome = await service(prisma, realtime).sweepNoNewReading(NOW)

    expect(outcome).toEqual({ scanned: 1, recovered: 0 })
    expect(realtime.emitToUsers).not.toHaveBeenCalled()
  })

  it('anuncia a recuperação depois do commit, e não notifica ninguém nem mexe no alerta', async () => {
    // "Sua condição foi encerrada" seria lido como melhora; o alerta só fecha
    // na mão de um humano.
    const prisma = prismaDouble()
    prisma.staleCandidates = [staleRow('c-1', 'BLOOD_PRESSURE_HIGH')]
    const realtime = realtimeDouble()
    const openAtEmit: boolean[] = []
    realtime.emitToUsers.mockImplementation(() => openAtEmit.push(prisma.open))
    const notifier = notifierDouble()

    await service(prisma, realtime, audienceDouble(), notifier).sweepNoNewReading(NOW)

    expect(openAtEmit).toEqual([false])
    expect(realtime.emitToUsers.mock.calls[0][2]).toEqual({
      workerId: 'worker-1',
      conditionId: 'c-1',
      kind: 'BLOOD_PRESSURE_HIGH',
      change: 'RECOVERED',
      at: NOW.toISOString(),
    })
    expect(notifier.notifyOpened).not.toHaveBeenCalled()
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('candidata que estoura vira aviso e não impede as outras', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const prisma = prismaDouble()
    prisma.staleCandidates = [staleRow('c-1', 'HEART_RATE_HIGH'), staleRow('c-2', 'OXYGEN_LOW', { workerId: 'worker-2' })]
    prisma.telemetryCondition.updateMany.mockRejectedValueOnce(new Error('deadlock')).mockResolvedValue({ count: 1 })

    const outcome = await service(prisma).sweepNoNewReading(NOW)

    expect(outcome).toEqual({ scanned: 2, recovered: 1 })
    expect(warn.mock.calls[0][0]).toMatch(/c-1/)
    warn.mockRestore()
  })

  it('bater o teto da rodada vira aviso; o resto entra na seguinte', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const prisma = prismaDouble()
    prisma.staleCandidates = Array.from({ length: MAX_NO_NEW_READING_PER_RUN }, (_, i) =>
      staleRow(`c-${i}`, 'HEART_RATE_HIGH'),
    )

    await service(prisma).sweepNoNewReading(NOW)

    expect(prisma.$queryRaw.mock.calls[0][0].values).toContain(MAX_NO_NEW_READING_PER_RUN)
    expect(warn.mock.calls[0][0]).toMatch(/teto/)
    warn.mockRestore()
  })
})

/**
 * Uma medição de pressão gravada no instante dado. O dublê filtra pela
 * fronteira de eventTime que o serviço pedir, como o banco filtraria, nas duas
 * portas que leem pressão: a avaliação (gte ou gt, e lte) e a reconferência do
 * vencimento (gt). Assim o caso afirma comportamento, e não a forma do `where`.
 */
const pressureMeasuredAt = (prisma: any, eventTime: Date, values = { systolicMmHg: 165, diastolicMmHg: 80 }) => {
  prisma.telemetrySample.findFirst = jest.fn().mockImplementation(async ({ where }: any) => {
    if (where.systolicMmHg === undefined) return null
    const at = eventTime.getTime()
    const { gte, gt, lte } = where.eventTime
    const inside =
      (gte === undefined || at >= gte.getTime()) &&
      (gt === undefined || at > gt.getTime()) &&
      (lte === undefined || at <= lte.getTime())
    return inside ? { ...values, eventTime } : null
  })
}

/** Batimento normal ao vivo: a outra métrica que mantém os lotes chegando. */
const normalSeries = () => Array.from({ length: 13 }, (_, i) => sampleRow(60 - i * 5, 80))

describe('TelemetryConditionService: medição vencida não reabre condição a cada lote', () => {
  // O ciclo que estes casos impedem: com a avaliação aceitando pressão de até
  // 72 h e a varredura fechando por vencimento a condição sem medição em 24 h,
  // uma pressão na faixa entre 24 h e 72 h reabriria a condição a cada lote do
  // relógio (o batimento chega a cada poucos segundos), a varredura a fecharia,
  // e cada abertura notificaria o funcionário e poria alerta novo na fila.
  it('pressão na faixa medida há 40 h: lotes do relógio e varredura não reabrem nem notificam', async () => {
    const prisma = prismaDouble()
    const state = withConditionState(prisma, [])
    // O vencimento fecha pelo updateMany, e o estado do dublê acompanha.
    prisma.telemetryCondition.updateMany.mockImplementation(async ({ where, data }: any) => {
      const row = state.find((r) => r.id === where.id && r.status === where.status)
      if (row === undefined) return { count: 0 }
      Object.assign(row, data)
      return { count: 1 }
    })
    prisma.telemetryCondition.groupBy = jest.fn().mockImplementation(async ({ where }: any) => {
      const closed = state.filter((r) => where.kind.in.includes(r.kind) && r.recoveryReason === where.recoveryReason)
      return closed.map((r) => ({ kind: r.kind, _max: { recoveredAt: r.recoveredAt } }))
    })
    pressureMeasuredAt(prisma, hoursAgo(40))
    prisma.telemetrySample.findMany.mockResolvedValue(normalSeries())
    const notifier = notifierDouble()
    const svc = service(prisma, realtimeDouble(), audienceDouble(), notifier)

    for (let lote = 0; lote < 3; lote++) {
      await svc.evaluateSession('session-1', NOW, NOW)
      // A varredura da rodada: a busca crua devolveria toda condição de saúde
      // aberta sem medição da métrica nas últimas 24 h.
      prisma.staleCandidates = state.filter((r) => r.status === 'ACTIVE').map((r) => staleRow(r.id, r.kind))
      await svc.sweepNoNewReading(NOW)
    }

    expect(insertCalls(prisma.$queryRaw)).toHaveLength(0)
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
    expect(notifier.notifyOpened).not.toHaveBeenCalled()
  })

  it('a pressão entra na conta só dentro das 24 h do vencimento, com a mesma fronteira aberta dele', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    const { where } = readingCall(prisma.telemetrySample.findFirst, 'systolicMmHg')
    expect(where.eventTime).toEqual({ gt: new Date(NOW.getTime() - NO_NEW_READING_MS), lte: NOW })
  })

  it('pressão medida há exatamente 24 h não abre; um milissegundo depois, abre', async () => {
    const vencida = prismaDouble()
    pressureMeasuredAt(vencida, new Date(NOW.getTime() - NO_NEW_READING_MS))
    expect((await service(vencida).evaluateSpotReading('session-1', NOW)).opened).toEqual([])

    const valendo = prismaDouble()
    pressureMeasuredAt(valendo, new Date(NOW.getTime() - NO_NEW_READING_MS + 1))
    expect((await service(valendo).evaluateSpotReading('session-1', NOW)).opened).toEqual(['BLOOD_PRESSURE_FATIGUE'])
  })

  // Corrida real: o gatilho do lote é o eventTime do relógio, até 2 min atrás
  // do servidor, e a varredura acabou de fechar olhando 24 h para trás do
  // instante DELA. A medição que ela julgou vencida ainda cabe na janela do
  // gatilho, e sem a segunda conferência reabriria uma vez.
  it('a medição que a varredura já julgou vencida não reabre, nem na corrida com o lote', async () => {
    const prisma = prismaDouble()
    pressureMeasuredAt(prisma, new Date(NOW.getTime() - NO_NEW_READING_MS - 30_000))
    prisma.telemetryCondition.groupBy = jest
      .fn()
      .mockResolvedValue([{ kind: 'BLOOD_PRESSURE_FATIGUE', _max: { recoveredAt: secondsAgo(10) } }])
    const notifier = notifierDouble()

    const outcome = await service(prisma, realtimeDouble(), audienceDouble(), notifier).evaluateSession(
      'session-1',
      secondsAgo(60),
      NOW,
    )

    expect(outcome.opened).toEqual([])
    expect(notifier.notifyOpened).not.toHaveBeenCalled()
    expect(prisma.telemetryCondition.groupBy).toHaveBeenCalledWith({
      by: ['kind'],
      where: {
        workerId: 'worker-1',
        origin: 'REAL',
        kind: { in: ['BLOOD_PRESSURE_FATIGUE'] },
        recoveryReason: 'NO_NEW_READING',
      },
      _max: { recoveredAt: true },
    })
  })

  it('medição nova depois do vencimento abre condição e alerta, como antes', async () => {
    const prisma = prismaDouble()
    pressureMeasuredAt(prisma, minutesAgo(5))
    prisma.telemetryCondition.groupBy = jest
      .fn()
      .mockResolvedValue([{ kind: 'BLOOD_PRESSURE_FATIGUE', _max: { recoveredAt: hoursAgo(1) } }])

    const outcome = await service(prisma).evaluateSpotReading('session-1', NOW)

    expect(outcome).toEqual({ opened: ['BLOOD_PRESSURE_FATIGUE'], recovered: [], alerts: 1 })
  })

  it('batimento ao vivo depois do vencimento de batimento abre como antes', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.telemetryCondition.groupBy = jest
      .fn()
      .mockResolvedValue([{ kind: 'HEART_RATE_HIGH', _max: { recoveredAt: minutesAgo(1) } }])

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toContain('HEART_RATE_HIGH')
  })

  it('condição de aparelho não consulta vencimento: bateria baixa abre sem a conferência', async () => {
    const prisma = demoDouble()
    prisma.telemetrySample.findFirst = latestReadings({ battery: { batteryPercent: 10 } })
    prisma.telemetryCondition.groupBy = jest.fn().mockResolvedValue([])

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['DEVICE_BATTERY_LOW'])
    expect(prisma.telemetryCondition.groupBy).not.toHaveBeenCalled()
  })
})
