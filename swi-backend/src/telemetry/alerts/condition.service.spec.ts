import { Prisma } from '@prisma/client'
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
    telemetrySample: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
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
/** A chamada de leitura pontual que filtra a coluna dada. */
const readingCall = (fn: jest.Mock, column: string) =>
  fn.mock.calls.map((c) => c[0]).find((arg) => arg.where[column] !== undefined)

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
    expect(prisma.telemetryCondition.create).not.toHaveBeenCalled()
    expect(prisma.telemetryCondition.update).not.toHaveBeenCalled()
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
    expect(prisma.telemetryCondition.create.mock.calls[0][0].data).toMatchObject({
      thresholdRule: 'FLOOR',
      thresholdValue: 140,
    })
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

  it('condição já aberta por outro escritor não derruba a avaliação nem conta como aberta', async () => {
    // O lock é na linha da sessão, mas o índice único é por funcionário e
    // origem: duas sessões do mesmo funcionário travam linhas distintas e podem
    // tentar abrir a mesma condição ao mesmo tempo. O P2002 subindo desfaria a
    // transação inteira, inclusive a recuperação legítima de outro tipo.
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-sig', 'DEVICE_SIGNAL_LOST')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.telemetryCondition.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique constraint', { code: 'P2002', clientVersion: 'test' }),
    )

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: [], recovered: ['DEVICE_SIGNAL_LOST'], alerts: 0 })
    expect(prisma.operationalAlert.create).not.toHaveBeenCalled()
  })

  it('recuperação do lote é gravada ANTES de qualquer abertura', async () => {
    // Engolir o P2002 impede o lançamento, não o aborto: o Prisma não envolve
    // consulta individual em savepoint, então a violação de unicidade põe a
    // transação em estado abortado e todo comando seguinte morre com 25P02. A
    // promessa de que recuperações legítimas sobrevivem só vale se nenhuma
    // escrita vier depois da violação, e a ordem é o que garante isso.
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-sig', 'DEVICE_SIGNAL_LOST')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.telemetryCondition.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique constraint', { code: 'P2002', clientVersion: 'test' }),
    )

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: [], recovered: ['DEVICE_SIGNAL_LOST'], alerts: 0 })
    expect(prisma.telemetryCondition.update.mock.calls[0][0]).toMatchObject({ where: { id: 'c-sig' } })
    expect(firstCall(prisma.telemetryCondition.update)).toBeLessThan(firstCall(prisma.telemetryCondition.create))
  })

  it('erro de escrita que não é violação do índice único continua subindo', async () => {
    const prisma = prismaDouble()
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())
    prisma.telemetryCondition.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('deadlock', { code: 'P2034', clientVersion: 'test' }),
    )

    await expect(service(prisma).evaluateSession('session-1', NOW, NOW)).rejects.toThrow(/deadlock/)
  })

  it('condição já ativa e ainda acima do limite: nada é gravado', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([activeRow('c-1', 'HEART_RATE_HIGH')])
    prisma.telemetrySample.findMany.mockResolvedValue(highSeries())

    const outcome = await service(prisma).evaluateSession('session-1', NOW, NOW)

    expect(outcome).toEqual({ opened: [], recovered: [], alerts: 0 })
    expect(prisma.telemetryCondition.create).not.toHaveBeenCalled()
    expect(prisma.telemetryCondition.update).not.toHaveBeenCalled()
  })
})

describe('TelemetryConditionService.evaluateSession: lastSeenAt', () => {
  it('condição ativa que segue valendo tem o carimbo renovado', async () => {
    // lastSeenAt é "última vez que uma avaliação viu esta condição valendo", e
    // não "quando ela abriu". Sem renovar, uma condição ativa há três horas com
    // o funcionário mandando dado o tempo todo mostra carimbo de três horas
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

  it('condição recuperada não leva renovação por cima: quem fechou não segue valendo', async () => {
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
