import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { TelemetryConditionKind, TelemetryOrigin } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ageInYearsAt, maxHeartRateForAge, restingFromDailyMinima } from '../assessment/assessment-baseline'
import { EVENT_AGE, FRESHNESS, monitoredDayOf } from '../domain/metric-state'
import { EXPERIMENTAL_ALERT_PROFILE, type AlertProfile } from './alert-profile'
import {
  decideBattery,
  decideBloodPressure,
  decideHeartRate,
  heartRateLimits,
  type Decision,
  type EngineSample,
} from './condition-engine'

// Serviço de condições: decide QUAIS LINHAS entram na conta e grava o
// resultado; a conta é do motor, que é puro. Condição e alerta são máquinas
// separadas: a condição diz o que o corpo ou o aparelho está fazendo agora, e
// recupera sozinha; o alerta diz que um humano precisa olhar, e só fecha na mão.

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Idade mínima do carimbo para valer uma escrita de renovação. Esta é a rota
 * mais quente do backend: com cadência de 5 s, renovar sem amortizar daria uma
 * escrita por condição ativa a cada evento, e um minuto de defasagem no carimbo
 * não muda decisão nenhuma da varredura.
 */
const LAST_SEEN_REFRESH_MS = 60_000

/** Tipos que viram item de fila. Bateria e sinal são estado, não item. */
const ALERTING_KINDS: ReadonlySet<TelemetryConditionKind> = new Set<TelemetryConditionKind>([
  'HEART_RATE_HIGH',
  'HEART_RATE_LOW',
  'BLOOD_PRESSURE_REVIEW',
])

export interface EvaluateOutcome {
  opened: TelemetryConditionKind[]
  recovered: TelemetryConditionKind[]
  alerts: number
}

@Injectable()
export class TelemetryConditionService {
  private readonly logger = new Logger(TelemetryConditionService.name)
  private readonly profile: AlertProfile = EXPERIMENTAL_ALERT_PROFILE

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Avalia as condições de VALOR de uma sessão a partir de um evento ao vivo.
   * `triggerAt` é o eventTime mais recente do lote; `now` é o relógio do
   * servidor, e é contra ele que os carimbos são gravados.
   */
  async evaluateSession(sessionId: string, triggerAt: Date, now: Date): Promise<EvaluateOutcome> {
    return this.prisma.$transaction((tx) => this.evaluateLocked(tx, sessionId, triggerAt, now))
  }

  private async evaluateLocked(
    tx: Prisma.TransactionClient,
    sessionId: string,
    triggerAt: Date,
    now: Date,
  ): Promise<EvaluateOutcome> {
    const outcome: EvaluateOutcome = { opened: [], recovered: [], alerts: 0 }

    // Condição descreve o AGORA, e evento que não é ao vivo não descreve agora
    // nada. A ingestão só deveria chamar com evento ao vivo, mas essa garantia
    // mora no chamador, e um gatilho de horas atrás faria estrago em silêncio
    // aqui: o motor veria a série densa e sustentada que aconteceu de manhã e
    // gravaria uma condição com firstSeenAt de agora, jurando 185 bpm neste
    // instante; e a perda de sinal recuperaria incondicionalmente, com o
    // backlog "provando" que o sinal voltou. O prazo é o do domínio, o mesmo
    // que classifica evento como ao vivo, e não um número novo desta fatia.
    if (now.getTime() - triggerAt.getTime() > EVENT_AGE.liveMs) {
      this.logger.debug(
        `Sessão ${sessionId}: gatilho de ${triggerAt.toISOString()} não é ao vivo em ${now.toISOString()}, nada avaliado`,
      )
      return outcome
    }

    // Mesmo lock da avaliação de esforço, pelo mesmo motivo: dois lotes da
    // mesma sessão em voo ao mesmo tempo abririam a mesma condição duas vezes.
    // NO KEY para não segurar a inserção de amostra, que pega FOR KEY SHARE.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "TelemetrySession" WHERE id = ${sessionId} FOR NO KEY UPDATE
    `
    if (locked.length === 0) throw new Error(`Sessão de monitoramento ${sessionId} não existe para avaliar condições`)

    const session = await tx.telemetrySession.findUnique({
      where: { id: sessionId },
      select: { id: true, workerId: true, origin: true },
    })
    if (session === null) throw new Error(`Sessão de monitoramento ${sessionId} não existe para avaliar condições`)

    // Por funcionário e origem, e não por sessão: uma condição aberta numa
    // sessão continua sendo dele na seguinte, mas real e demonstração nunca se
    // misturam, e sem o filtro uma condição de demonstração ativa faria o
    // motor concluir que a real já está aberta e nunca abri-la.
    //
    // lastSeenAt entra na projeção porque é ele que decide, no fim, se o
    // carimbo da condição ainda ativa precisa ser renovado. Sem cast: assim o
    // compilador reprova qualquer mexida no select que tire uma coluna que o
    // corpo abaixo consome, em vez de deixar o erro para o runtime.
    const active = await tx.telemetryCondition.findMany({
      where: { workerId: session.workerId, origin: session.origin, status: 'ACTIVE' },
      select: { id: true, kind: true, lastSeenAt: true },
    })
    const activeByKind = new Map(active.map((c) => [c.kind, c]))

    const windowStart = new Date(triggerAt.getTime() - this.profile.persistence.windowMs)
    const sinceDay = new Date(monitoredDayOf(now).getTime() - this.profile.restingDays * DAY_MS)
    // Cada métrica tem a sua própria noção de "vale agora", e uma janela só não
    // serve às três. BPM precisa de evidência CONTÍNUA dentro da janela de
    // persistência; bateria e pressão precisam do ÚLTIMO valor conhecido dentro
    // do prazo de validade DELAS. Presa à janela do BPM, uma medição de pressão
    // carimbada mais de 60 s antes da amostra mais nova do lote não seria
    // avaliada por chamada nenhuma, porque a janela seguinte já andou para a
    // frente; e pressão é medida à mão e raramente, então perder uma é perder o
    // evento inteiro.
    const batteryFrom = new Date(triggerAt.getTime() - FRESHNESS.BATTERY.staleMs)
    const pressureFrom = new Date(triggerAt.getTime() - FRESHNESS.BLOOD_PRESSURE.staleMs)
    const [rows, batteryRow, pressureRow, profile, summaries] = await Promise.all([
      // Fronteira de baixo fechada, como a do motor: aberta, a amostra que cai
      // exatamente no início da janela ficaria de fora e o trecho medido seria
      // menor que o que o perfil declara. Só BPM: as colunas de bateria e de
      // pressão saíram daqui porque quem as lê agora são as buscas abaixo.
      tx.telemetrySample.findMany({
        where: { sessionId, eventTime: { gte: windowStart, lte: triggerAt } },
        select: { eventTime: true, heartRateBpm: true },
        orderBy: { eventTime: 'asc' },
      }),
      // 30 min é FRESHNESS.BATTERY.staleMs, o prazo do domínio para bateria, e
      // não número novo desta fatia: a leitura chega a cada cinco minutos, o
      // painel a trata como válida até meia hora, e a condição tem de decidir
      // sobre a mesma leitura que o painel mostra.
      tx.telemetrySample.findFirst({
        where: { sessionId, batteryPercent: { not: null }, eventTime: { gte: batteryFrom, lte: triggerAt } },
        select: { batteryPercent: true },
        orderBy: { eventTime: 'desc' },
      }),
      // 72 h é FRESHNESS.BLOOD_PRESSURE.staleMs, pelo mesmo motivo: passado
      // esse prazo o domínio diz "sem medição recente" e o valor some da tela,
      // então é exatamente aí que ele deixa de poder abrir condição.
      tx.telemetrySample.findFirst({
        where: {
          sessionId,
          systolicMmHg: { not: null },
          diastolicMmHg: { not: null },
          eventTime: { gte: pressureFrom, lte: triggerAt },
        },
        select: { systolicMmHg: true, diastolicMmHg: true },
        orderBy: { eventTime: 'desc' },
      }),
      tx.profile.findUnique({ where: { userId: session.workerId }, select: { birthDate: true } }),
      tx.telemetryDailySummary.findMany({
        where: {
          workerId: session.workerId,
          origin: session.origin,
          day: { gte: sinceDay },
          heartRateMin: { not: null },
        },
        select: { heartRateMin: true },
        orderBy: { day: 'desc' },
        take: this.profile.restingDays,
      }),
    ])

    const restingBpm = restingFromDailyMinima(
      summaries.flatMap((s) => (s.heartRateMin === null ? [] : [s.heartRateMin])),
    )
    const birthDate = profile?.birthDate ?? null
    const maxBpm = birthDate === null ? null : maxHeartRateForAge(ageInYearsAt(birthDate, now))
    const limits = heartRateLimits(this.profile, { maxBpm, restingBpm })

    // batteryPercent fica nulo aqui de propósito: o motor recebe a bateria como
    // escalar, pela leitura própria, e nenhuma decisão de BPM olha esta coluna.
    const samples: EngineSample[] = rows.map((r) => ({
      atMs: r.eventTime.getTime(),
      heartRateBpm: r.heartRateBpm,
      batteryPercent: null,
    }))
    const latestBattery = batteryRow?.batteryPercent ?? null
    // O filtro `not: null` não estreita o tipo devolvido pelo Prisma, então as
    // duas colunas são conferidas aqui em vez de assertadas.
    const pressure =
      pressureRow === null || pressureRow.systolicMmHg === null || pressureRow.diastolicMmHg === null
        ? null
        : { systolic: pressureRow.systolicMmHg, diastolic: pressureRow.diastolicMmHg }

    const nowMs = triggerAt.getTime()
    const decisions: Decision[] = [
      decideHeartRate('HEART_RATE_HIGH', samples, limits.high, activeByKind.has('HEART_RATE_HIGH'), this.profile, nowMs),
      decideHeartRate('HEART_RATE_LOW', samples, limits.low, activeByKind.has('HEART_RATE_LOW'), this.profile, nowMs),
      decideBattery(latestBattery, activeByKind.has('DEVICE_BATTERY_LOW'), this.profile),
      decideBloodPressure(pressure, activeByKind.has('BLOOD_PRESSURE_REVIEW'), this.profile),
    ].flatMap((d) => (d === null ? [] : [d]))

    // Evento ao vivo é sinal de volta: perda de sinal ativa recupera aqui, e
    // não na varredura, que só enxerga o silêncio.
    if (activeByKind.has('DEVICE_SIGNAL_LOST')) {
      decisions.push({ kind: 'DEVICE_SIGNAL_LOST', action: 'RECOVER', observedValue: null, threshold: null })
    }

    const recoveredIds = new Set<string>()
    for (const decision of decisions) {
      if (decision.action === 'RECOVER') {
        const row = activeByKind.get(decision.kind)
        if (row === undefined) continue
        // observedValue não é reescrito: ele guarda o valor que ABRIU a
        // condição, que é o que a auditoria quer saber. O valor da
        // recuperação já está no histórico de amostras.
        await tx.telemetryCondition.update({
          where: { id: row.id },
          data: { status: 'RECOVERED', recoveredAt: now, recoveryReason: 'NORMALIZED', lastSeenAt: now },
        })
        outcome.recovered.push(decision.kind)
        recoveredIds.add(row.id)
        continue
      }

      // O lock é na linha da SESSÃO, mas o invariante do índice único é por
      // FUNCIONÁRIO e ORIGEM: duas sessões distintas do mesmo funcionário
      // travam linhas diferentes, não se enfileiram, e podem tentar abrir a
      // mesma condição ao mesmo tempo. Deixar o P2002 subir derrubaria a
      // transação inteira e desfaria até recuperações legítimas de outros tipos
      // já gravadas neste laço. Engolir aqui é certo porque a violação diz
      // exatamente que a condição já está aberta, que é o estado desejado: o
      // outro escritor chegou primeiro e o resultado é o mesmo. Não conta como
      // aberta por este chamador, então não vira alerta nem entra no resultado.
      let createdId: string | null = null
      try {
        const created = await tx.telemetryCondition.create({
          data: {
            workerId: session.workerId,
            sessionId: session.id,
            origin: session.origin,
            kind: decision.kind,
            status: 'ACTIVE',
            firstSeenAt: now,
            lastSeenAt: now,
            thresholdProfile: this.profile.version,
            thresholdRule: decision.threshold?.rule ?? null,
            thresholdValue: decision.threshold?.value ?? null,
            observedValue: decision.observedValue,
          },
          select: { id: true },
        })
        createdId = created.id
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
        this.logger.debug(
          `Condição ${decision.kind} de ${session.workerId} (${session.origin}) já estava aberta por outro escritor`,
        )
      }
      if (createdId === null) continue

      outcome.opened.push(decision.kind)
      if (await this.openAlert(tx, createdId, session.workerId, session.origin, decision.kind)) outcome.alerts += 1
    }

    // lastSeenAt quer dizer "última vez que uma avaliação viu esta condição
    // ainda valendo", e não "quando ela abriu". Sem renovar, uma condição ativa
    // há três horas, com o funcionário mandando dado o tempo todo, exibiria
    // carimbo de três horas atrás, idêntico ao firstSeenAt, e o índice
    // [status, lastSeenAt] deixaria de servir para achar condição ativa
    // esquecida. Quem recuperou fica de fora: já levou o carimbo do fechamento
    // e não segue valendo.
    const refreshBefore = new Date(now.getTime() - LAST_SEEN_REFRESH_MS)
    for (const row of active) {
      if (recoveredIds.has(row.id)) continue
      if (row.lastSeenAt > refreshBefore) continue
      await tx.telemetryCondition.update({ where: { id: row.id }, data: { lastSeenAt: now } })
    }

    if (outcome.opened.length > 0 || outcome.recovered.length > 0) {
      this.logger.debug(
        `Condições da sessão ${session.id}: abriu ${outcome.opened.join(',') || 'nada'}, recuperou ${outcome.recovered.join(',') || 'nada'}, ${outcome.alerts} alerta(s)`,
      )
    }
    return outcome
  }

  /**
   * Alerta nasce na mesma transação da condição, e só para os tipos que
   * exigem gente. Não nasce enquanto houver um não resolvido do mesmo
   * funcionário, tipo E ORIGEM: a fila não empilha o mesmo problema, e o
   * alerta antigo já diz "olhe este funcionário".
   *
   * A origem é parte da chave, e não detalhe de leitura: demonstração nunca é
   * triada, então um alerta de demonstração fica OPEN para sempre, e sem o
   * filtro ele suprimiria o alerta REAL do mesmo funcionário e tipo pelo resto
   * do piloto. A condição real abriria, a fila não receberia nada, e o painel
   * voltaria a mostrar zero urgente. É a mesma falha que a chave única
   * (workerId, kind, origin) já corrige um nível acima, na condição.
   */
  private async openAlert(
    tx: Prisma.TransactionClient,
    conditionId: string,
    workerId: string,
    origin: TelemetryOrigin,
    kind: TelemetryConditionKind,
  ): Promise<boolean> {
    if (!ALERTING_KINDS.has(kind)) return false
    const unresolved = await tx.operationalAlert.findFirst({
      where: { workerId, origin, status: { in: ['OPEN', 'ACKNOWLEDGED'] }, condition: { kind } },
      select: { id: true },
    })
    if (unresolved !== null) return false
    await tx.operationalAlert.create({ data: { conditionId, workerId, origin, status: 'OPEN' } })
    return true
  }
}
