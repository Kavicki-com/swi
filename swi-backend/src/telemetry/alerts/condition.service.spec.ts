import { Logger } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { ALERT_PROFILE_VERSION } from './alert-profile'
import { MAX_SILENT_SESSIONS_PER_RUN, TelemetryConditionService } from './condition.service'

// O serviço decide QUAIS LINHAS entram na conta e grava o resultado; a conta
// é do motor, que é puro. O Prisma é dublê; o índice único e a migration são
// assunto do e2e. O que estes casos protegem: a ordem das instruções (lock
// antes de qualquer leitura), o que é gravado, e a regra de não empilhar
// alerta.

const NOW = new Date('2026-09-07T12:00:00.000Z')
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000)
const minutesAgo = (m: number) => secondsAgo(m * 60)
const hoursAgo = (h: number) => minutesAgo(h * 60)
const SESSION = { id: 'session-1', workerId: 'worker-1', origin: 'REAL' }

const sampleRow = (secAgo: number, heartRateBpm: number | null, over: Record<string, unknown> = {}) => ({
  eventTime: secondsAgo(secAgo),
  heartRateBpm,
  ...over,
})

/** 13 amostras a cada 5 s cobrindo os últimos 60 s: densidade que o motor aceita. */
const highSeries = (bpm = 185) => Array.from({ length: 13 }, (_, i) => sampleRow(60 - i * 5, bpm))

/** Condição ativa vista agora há pouco: o carimbo não precisa de renovação. */
const activeRow = (id: string, kind: string, lastSeenAt: Date = secondsAgo(10)) => ({ id, kind, lastSeenAt })

/**
 * Bateria e pressão são lidas por chamadas próprias, cada uma com o prazo da
 * sua métrica. O dublê separa as duas pela coluna que cada `where` filtra.
 */
const latestReadings = (readings: { battery?: unknown; pressure?: unknown }) =>
  jest.fn().mockImplementation(async ({ where }: any) =>
    where.batteryPercent === undefined ? (readings.pressure ?? null) : (readings.battery ?? null),
  )

/**
 * Leituras gravadas em OUTRA sessão do mesmo funcionário. O dublê filtra como o
 * banco filtraria: recorte por sessão não as acha, recorte por funcionário e
 * origem acha.
 */
const readingsOfAnotherSession = (readings: { battery?: unknown; pressure?: unknown }) =>
  jest.fn().mockImplementation(async ({ where }: any) => {
    const row = (where.batteryPercent === undefined ? readings.pressure : readings.battery) ?? null
    const visivel =
      where.sessionId === undefined && where.workerId === SESSION.workerId && where.origin === SESSION.origin
    return visivel ? row : null
  })

/**
 * Separa o INSERT cru da condição das outras consultas cruas do serviço: o lock
 * da sessão e a inserção passam pelo mesmo `$queryRaw`.
 */
const isInsert = (call: unknown[]) =>
  (call[0] as TemplateStringsArray).join('?').includes('INSERT INTO "TelemetryCondition"')
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
    },
    operationalAlert: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'alert-new', ...data })),
    },
    telemetrySample: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    telemetrySnapshot: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
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
  // A inserção da condição é crua, então o dublê responde pelo TEXTO da consulta:
  // o lock devolve a linha da sessão, o INSERT devolve o id criado. `conflicting`
  // faz o papel do índice único parcial: para o tipo que outro escritor já abriu,
  // o ON CONFLICT DO NOTHING devolve zero linhas em vez de levantar.
  db.conflicting = new Set<string>()
  db.$queryRaw = jest.fn().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!isInsert([strings])) return [{ id: SESSION.id }]
    return values.some((v) => db.conflicting.has(v)) ? [] : [{ id: 'condition-new' }]
  })
  return db
}

const firstCall = (fn: jest.Mock) => fn.mock.invocationCallOrder[0]
const service = (prisma: any) => new TelemetryConditionService(prisma as PrismaService)
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

    const [sql, ...values] = prisma.$queryRaw.mock.calls[0]
    expect(sql.join('?')).toMatch(/pg_advisory_xact_lock\(hashtext\(/)
    expect(values[0]).toContain('worker-1')
    expect(values[0]).toContain('REAL')
    expect(firstCall(prisma.$queryRaw)).toBeLessThan(firstCall(prisma.telemetryCondition.findMany))
    expect(firstCall(prisma.$queryRaw)).toBeLessThan(firstCall(prisma.telemetrySample.findMany))
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

  it('a janela de 60 s serve só ao BPM: ela não carrega mais bateria nem pressão', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', secondsAgo(5), NOW)

    const { where, select } = prisma.telemetrySample.findMany.mock.calls[0][0]
    expect(where).toEqual({ sessionId: 'session-1', eventTime: { gte: secondsAgo(65), lte: secondsAgo(5) } })
    expect(select).toEqual({ eventTime: true, heartRateBpm: true })
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

  it('pressão é lida pelo prazo da pressão, 72 h, e não pela janela do BPM', async () => {
    const prisma = prismaDouble()

    await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(readingCall(prisma.telemetrySample.findFirst, 'systolicMmHg')).toEqual({
      where: {
        workerId: 'worker-1',
        origin: 'REAL',
        systolicMmHg: { not: null },
        diastolicMmHg: { not: null },
        eventTime: { gte: hoursAgo(72), lte: NOW },
      },
      select: { systolicMmHg: true, diastolicMmHg: true },
      orderBy: { eventTime: 'desc' },
    })
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
  it('BPM alto sustentado grava condição com perfil, regra, limite e valor, e abre alerta', async () => {
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
      ALERT_PROFILE_VERSION,
      'PERSONALIZED',
      expect.any(Number),
      185,
      NOW,
    ])
    // Quem nasceu em 1991-05-10 tem 35 anos completos no dia monitorado de
    // 2026-09-07, então a máxima por idade (Tanaka) é 208 - 0,7 x 35 = 183,5, e
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
    const prisma = prismaDouble()
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
    // O prazo da pressão é de 72 h: uma medição de ontem é atual pelo domínio,
    // e nesse intervalo o relógio reconectou várias vezes. Recorte por sessão
    // esconderia dela a medição que o painel mostra na tela.
    const prisma = prismaDouble()
    prisma.telemetrySample.findFirst = readingsOfAnotherSession({
      pressure: { systolicMmHg: 150, diastolicMmHg: 80 },
    })

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome.opened).toEqual(['BLOOD_PRESSURE_REVIEW'])
  })

  it('pressão fora da faixa abre condição e alerta, com a régua que cruzou', async () => {
    const prisma = prismaDouble()
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

    expect(outcome.opened).toEqual(['BLOOD_PRESSURE_REVIEW'])
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
      condition: { kind: 'HEART_RATE_HIGH' },
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
    const prisma = prismaDouble()
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
      'REAL',
      'HEART_RATE_HIGH',
      'ACTIVE',
      NOW,
      NOW,
      ALERT_PROFILE_VERSION,
      'PERSONALIZED',
      165,
      185,
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

    expect(outcome).toEqual({ opened: ['BLOOD_PRESSURE_REVIEW'], recovered: ['DEVICE_SIGNAL_LOST'], alerts: 1 })
    expect(insertCalls(prisma.$queryRaw)).toHaveLength(2)
    expect(insertValues(prisma.$queryRaw, 1)).toContain('BLOOD_PRESSURE_REVIEW')
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
  prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastEventTime: secondsAgo(secAgo) })
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
    expect(where).toEqual({ origin: 'REAL', sessionId: { not: null }, lastEventTime: { lt: secondsAgo(120) } })
    // lastEventTime sai da projeção: o silêncio que vale é o relido dentro da
    // transação, e não este, que envelhece durante o laço.
    expect(select).toEqual({ sessionId: true })
  })

  it('a rodada tem teto de candidatas, e a mais calada vem primeiro', async () => {
    // Precedente do ciclo de vida: rodada de tamanho previsível. Sem o teto,
    // backend fora do ar por dez minutos põe todo mundo na mesma rodada. A
    // ordem faz o teto cortar as menos urgentes.
    const prisma = prismaDouble()

    await service(prisma).sweepSilentSessions(NOW)

    const { orderBy, take } = prisma.telemetrySnapshot.findMany.mock.calls[0][0]
    expect(orderBy).toEqual({ lastEventTime: 'asc' })
    expect(take).toBe(MAX_SILENT_SESSIONS_PER_RUN)
  })

  it('rodada que bate o teto vira aviso: o resto ficou para a seguinte', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const prisma = prismaDouble()
    prisma.telemetrySnapshot.findMany.mockResolvedValue(
      Array.from({ length: MAX_SILENT_SESSIONS_PER_RUN }, (_, i) => candidateRow(`session-${i}`)),
    )
    prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastEventTime: secondsAgo(300) })

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

    const [sql, ...values] = prisma.$queryRaw.mock.calls[0]
    expect(sql.join('?')).toMatch(/pg_advisory_xact_lock\(hashtext\(/)
    expect(values[0]).toContain('worker-1')
    expect(values[0]).toContain('REAL')
    expect(firstCall(prisma.$queryRaw)).toBeLessThan(firstCall(prisma.telemetryCondition.findMany))
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
      ALERT_PROFILE_VERSION,
      null,
      120_000,
      300_000,
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

  it('silêncio recupera batimento e bateria com motivo SIGNAL_LOST, e deixa a pressão em paz', async () => {
    // Batimento e bateria são contínuos: sem relógio falando, o valor que
    // sustentava a condição deixou de existir, e mantê-la aberta seria afirmar
    // um agora que ninguém mediu. Pressão é medida à mão e vale por 72 h:
    // silêncio do relógio não diz nada sobre a pressão de ninguém, e ela só
    // recupera por medição nova.
    const prisma = prismaDouble()
    silentFor(prisma, 300)
    prisma.telemetryCondition.findMany.mockResolvedValue([
      activeRow('c-alto', 'HEART_RATE_HIGH'),
      activeRow('c-baixo', 'HEART_RATE_LOW'),
      activeRow('c-bat', 'DEVICE_BATTERY_LOW'),
      activeRow('c-pressao', 'BLOOD_PRESSURE_REVIEW'),
    ])

    const outcome = await service(prisma).sweepSilentSessions(NOW)

    expect(outcome).toEqual({ scanned: 1, signalLost: 1, recovered: 3 })
    const fechada = { status: 'RECOVERED', recoveredAt: NOW, recoveryReason: 'SIGNAL_LOST', lastSeenAt: NOW }
    expect(prisma.telemetryCondition.update.mock.calls.map((c: any[]) => c[0])).toEqual([
      { where: { id: 'c-alto' }, data: fechada },
      { where: { id: 'c-baixo' }, data: fechada },
      { where: { id: 'c-bat' }, data: fechada },
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
    prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastEventTime: secondsAgo(600) })

    await service(prisma).sweepSilentSessions(NOW)

    // O silêncio observado é o penúltimo valor do INSERT, pela ordem das colunas.
    expect(insertValues(prisma.$queryRaw)[10]).toBe(600_000)
  })

  it('candidata que voltou a falar entre a busca e o lock não é tocada', async () => {
    // Quem chegou depois tem a informação mais nova: se um lote entrou entre a
    // busca e o lock, quem manda é ele, e a varredura não tem o que dizer.
    const prisma = prismaDouble()
    prisma.telemetrySnapshot.findMany.mockResolvedValue([candidateRow('session-1')])
    prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastEventTime: secondsAgo(3) })
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
    prisma.telemetrySnapshot.findFirst.mockResolvedValue({ lastEventTime: secondsAgo(300) })
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
