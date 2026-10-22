import { Injectable, Logger } from '@nestjs/common'
import { Prisma, type TelemetryConditionKind, type TelemetryOrigin } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { RealtimeGateway } from '../../realtime/realtime.gateway'
import { TelemetryAudienceService } from '../realtime/telemetry-audience.service'
import { TelemetryHealthNotifier } from './health-notifier'
import { ageInYearsAt, maxHeartRateForAge, restingFromDailyMinima } from '../assessment/assessment-baseline'
import { CLOCK_SKEW_MS, EVENT_AGE, FRESHNESS, monitoredDayOf, monitoredDayWindow } from '../domain/metric-state'
import { loadThresholds } from '../calibration/calibration-thresholds'
import { CALIBRATED_ALERT_PROFILE, EXPERIMENTAL_ALERT_PROFILE, type AlertProfile } from './alert-profile'
import {
  calibratedBandEpisodes,
  calibratedOxygenDecisions,
  calibratedPressureDecisions,
  calibratedWatchDecisions,
  type BandBatch,
} from './calibrated-decisions'
import {
  decideBattery,
  decideBloodPressure,
  decideHeartRate,
  decideWear,
  heartRateLimits,
  type Decision,
  type EngineSample,
} from './condition-engine'
import { describeError } from '../../common/describe-error'

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

/**
 * Teto de candidatas por execução da varredura, no molde do teto de triplas do
 * ciclo de vida: a rodada tem tamanho previsível, e o que sobra entra na
 * seguinte, daqui a 30 s. Sem ele, backend fora do ar por dez minutos põe o
 * piloto inteiro na mesma rodada, justo quando o banco está voltando.
 */
export const MAX_SILENT_SESSIONS_PER_RUN = 200

/**
 * Piso da busca de candidatas: calado além disto, o funcionário deixa de ser
 * varrido. Não é teto de turno e não tem relação nenhuma com ele: o teto de
 * turno decide SE ABRE perda de sinal, e este piso decide se a pessoa ainda é
 * um funcionário monitorado.
 *
 * Sete dias cobre queda de fim de semana e feriado emendado, que é o que a
 * ausência de teto superior existia para proteger, e descarta quem saiu do
 * piloto. Sem ele, relógio devolvido ou funcionário desligado fica candidato
 * para sempre; como a ordem é pela mais calada primeiro, ele vem na frente de
 * todo mundo e come uma vaga do teto da rodada a cada 30 s. Com desligados o
 * bastante, os vivos param de ser varridos: o histórico vira uma negação de
 * serviço lenta.
 *
 * O conserto de verdade é ENCERRAR sessão de monitoramento, dívida que este
 * serviço já declara no comentário de sweepSilentSessions. Este piso é
 * paliativo até lá.
 */
export const MONITORED_SILENCE_FLOOR_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Tipos que viram item de fila. Bateria e sinal são estado, não item. Desgaste
 * alto vira item porque é o alerta que a narrativa do piloto promete: alguém
 * tem de decidir se o funcionário para. As duas camadas da calibração também:
 * a Atenção pede que alguém olhe, a trava pede que alguém aja.
 */
const ALERTING_KINDS: ReadonlySet<TelemetryConditionKind> = new Set<TelemetryConditionKind>([
  'HEART_RATE_HIGH',
  'HEART_RATE_LOW',
  'BLOOD_PRESSURE_REVIEW',
  'WEAR_HIGH',
  'HEART_RATE_FATIGUE',
  'OXYGEN_FATIGUE',
  'WEAR_FATIGUE',
  'BLOOD_PRESSURE_FATIGUE',
  'OXYGEN_LOW',
  'BLOOD_PRESSURE_HIGH',
])

/**
 * O que a medição avulsa decide, e por isso o único carimbo que ela renova:
 * as condições de pressão, de qualquer perfil, e as de oxigenação.
 */
const SPOT_READING_KINDS: ReadonlySet<TelemetryConditionKind> = new Set<TelemetryConditionKind>([
  'BLOOD_PRESSURE_REVIEW',
  'BLOOD_PRESSURE_FATIGUE',
  'BLOOD_PRESSURE_HIGH',
  'OXYGEN_FATIGUE',
  'OXYGEN_LOW',
])

/**
 * As condições de pressão abrem na hora em que a pressão foi medida. A pulseira
 * entrega horas depois, e a hora da chegada diria que a pessoa estava com
 * aquele valor agora.
 */
const PRESSURE_KINDS: ReadonlySet<TelemetryConditionKind> = new Set<TelemetryConditionKind>([
  'BLOOD_PRESSURE_REVIEW',
  'BLOOD_PRESSURE_FATIGUE',
  'BLOOD_PRESSURE_HIGH',
])

/**
 * Até onde a oxigenação é lida para decidir. Ela é pontual e chega poucas
 * vezes por turno, então a régua é de horas, como a da pressão, mas menor:
 * leitura de ontem não descreve a oxigenação de hoje.
 */
const OXYGEN_LOOKBACK_MS = 12 * 60 * 60 * 1000

/**
 * Condições contínuas que o SILÊNCIO derruba. Batimento e bateria descrevem um
 * valor que o relógio precisa estar mandando: parado o relógio, a evidência que
 * sustentava a condição deixou de existir, e mantê-la aberta seria afirmar um
 * agora que ninguém mediu. Desgaste entra pelo mesmo motivo: ele vem da
 * avaliação, e a avaliação só nasce de evento ao vivo.
 *
 * A Atenção de batimento e a de desgaste entram pelo mesmo motivo.
 *
 * Pressão fica de fora de propósito: é medida à mão, vale por 72 h pelo prazo
 * do domínio, e silêncio do relógio não diz nada sobre a pressão de ninguém.
 * Ela só recupera por medição nova.
 */
const SILENCE_RECOVERS: ReadonlySet<TelemetryConditionKind> = new Set<TelemetryConditionKind>([
  'HEART_RATE_HIGH',
  'HEART_RATE_LOW',
  'DEVICE_BATTERY_LOW',
  'WEAR_HIGH',
  'HEART_RATE_FATIGUE',
  'WEAR_FATIGUE',
])

/**
 * Prazo do encerramento por vencimento: 24 h sem medição nova da métrica. É o
 * "recente" que a régua da medição já usa, e não uma terceira régua de tempo.
 */
export const NO_NEW_READING_MS = FRESHNESS.BLOOD_PRESSURE.currentMs

/** Teto de candidatas por rodada do vencimento, pelo mesmo motivo do silêncio. */
export const MAX_NO_NEW_READING_PER_RUN = 200

type NoNewReadingColumn = 'heartRateBpm' | 'oxygenSaturationPct' | 'systolicMmHg'

/**
 * A coluna da amostra que sustenta cada condição de saúde. Desgaste deriva do
 * batimento: sem batimento novo, a condição de desgaste vence junto. Nulo é
 * condição de aparelho, que o vencimento nunca fecha: o silêncio e o evento ao
 * vivo já cuidam dela. Exaustiva por construção: tipo novo não compila sem
 * dizer de que métrica vive.
 */
export const NO_NEW_READING_METRIC: Readonly<Record<TelemetryConditionKind, NoNewReadingColumn | null>> = {
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
  // Nasce recuperada: não há o que vencer.
  REPEATED_EPISODES: null,
}

/**
 * Quantos episódios atrasados do mesmo tipo, no mesmo dia monitorado, viram o
 * alerta de episódios repetidos. Nenhum episódio sozinho pede ação, porque já
 * passou; três no mesmo dia são um padrão que alguém precisa olhar.
 */
export const REPEATED_EPISODES_THRESHOLD = 3

/** "A métrica foi medida nesta amostra", para a reconferência sob o lock. */
const MEASURED: Readonly<Record<NoNewReadingColumn, Prisma.TelemetrySampleWhereInput>> = {
  heartRateBpm: { heartRateBpm: { not: null } },
  oxygenSaturationPct: { oxygenSaturationPct: { not: null } },
  systolicMmHg: { systolicMmHg: { not: null } },
}

export interface EvaluateOutcome {
  opened: TelemetryConditionKind[]
  recovered: TelemetryConditionKind[]
  alerts: number
}

/** Um dia da pulseira, como a avaliação esparsa acabou de recalcular. */
export interface BandDayInput {
  workerId: string
  origin: TelemetryOrigin
  /** Sessão da última leitura do dia: é nela que a condição nova fica. */
  sessionId: string
  batch: BandBatch
}

/** Nome do evento de socket que anuncia condição aberta ou recuperada. */
export const CONDITION_CHANGED_EVENT = 'telemetry.condition.changed'

/**
 * Aviso de condição que mudou. Só identificadores, como o aviso do snapshot: o
 * valor e a régua vêm pelo read model, que confere o acesso a cada leitura.
 */
export interface ConditionChange {
  workerId: string
  conditionId: string
  kind: TelemetryConditionKind
  change: 'OPENED' | 'RECOVERED'
  /** ISO-8601 do relógio do servidor, o mesmo carimbo gravado na linha. */
  at: string
}

export interface SweepOutcome {
  /** Sessões silenciosas olhadas na rodada, tenham gerado escrita ou não. */
  scanned: number
  /** Perdas de sinal abertas por esta rodada. */
  signalLost: number
  /** Condições contínuas recuperadas por silêncio nesta rodada. */
  recovered: number
}

export interface NoNewReadingOutcome {
  /** Condições sem medição nova olhadas na rodada, tenham fechado ou não. */
  scanned: number
  /** Condições encerradas por vencimento nesta rodada. */
  recovered: number
}

/** Condição ativa de saúde sem amostra recente da métrica, como a busca crua a devolve. */
interface NoNewReadingCandidate {
  id: string
  workerId: string
  origin: TelemetryOrigin
  kind: TelemetryConditionKind
}

@Injectable()
export class TelemetryConditionService {
  private readonly logger = new Logger(TelemetryConditionService.name)
  private readonly profile: AlertProfile = EXPERIMENTAL_ALERT_PROFILE

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly audience: TelemetryAudienceService,
    private readonly healthNotifier: TelemetryHealthNotifier,
  ) {}

  /**
   * Avalia as condições de VALOR de uma sessão a partir de um evento ao vivo.
   * `triggerAt` é o eventTime mais recente do lote; `now` é o relógio do
   * servidor, e é contra ele que os carimbos são gravados.
   */
  async evaluateSession(sessionId: string, triggerAt: Date, now: Date): Promise<EvaluateOutcome> {
    // As mudanças são juntadas dentro da transação e anunciadas só depois do
    // commit: se ela falhar, nada foi gravado e nada é anunciado.
    const changes: ConditionChange[] = []
    const outcome = await this.prisma.$transaction((tx) => this.evaluateLocked(tx, sessionId, triggerAt, now, changes))
    await this.announce(changes)
    await this.notifyHealth(changes)
    return outcome
  }

  /**
   * Avalia as condições quando chega uma medição avulsa do app Saúde (pressão
   * ou temperatura), que o iPhone manda numa sessão sem batimento e com o
   * horário em que foi medida.
   *
   * O gatilho é `now`, e não o horário da medição: a pergunta é a mesma que o
   * próximo evento do relógio faria, "qual é a última pressão conhecida dentro
   * do prazo dela", só que feita na hora em que a medição chega, para a
   * revisão não depender de haver relógio falando.
   *
   * É também a porta da oxigenação que não chega ao vivo: a da pulseira, que
   * vem em lote, e a do relógio que chega como backlog.
   *
   * Esta porta decide a pressão e a oxigenação e MAIS NADA: a revisão de
   * pressão na DEMO; a Atenção e a trava de cada uma na REAL. O relógio não
   * falou, então nada do resto que ele mede é reavaliado: perda de sinal
   * ativa continua ativa, e batimento, bateria e desgaste ficam como o último
   * evento dele deixou. Reavaliar a bateria aqui reabriria "bateria baixa" a partir de uma
   * leitura velha de um relógio que já descarregou, a cada medição que chegasse.
   */
  async evaluateSpotReading(sessionId: string, now: Date): Promise<EvaluateOutcome> {
    const changes: ConditionChange[] = []
    const outcome = await this.prisma.$transaction((tx) =>
      this.evaluateLocked(tx, sessionId, now, now, changes, { spotReading: true }),
    )
    await this.announce(changes)
    await this.notifyHealth(changes)
    return outcome
  }

  /**
   * Avalia o dia da pulseira depois da avaliação esparsa. A pulseira chega em
   * lote, horas depois de medir, então nada aqui é "agora": o dia é percorrido
   * em ordem, episódio por episódio, e cada um é gravado com os instantes
   * medidos.
   *
   * - Abriu e fechou dentro do lote: condição que já nasce recuperada, sem
   *   alerta na fila e sem aviso. Ninguém pode agir sobre algo que já passou.
   *   Guarda a hora em que o lote chegou, e o terceiro do mesmo tipo no mesmo
   *   dia monitorado abre a condição de episódios repetidos, com alerta.
   * - Abriu e segue ativa na última leitura: abre como no relógio, com alerta e
   *   aviso depois do commit.
   * - Já estava aberta e fechou: recupera no instante medido.
   *
   * Só a origem REAL, pelo perfil calibrado. A DEMO não passa por aqui.
   */
  async evaluateBandDay(input: BandDayInput, now: Date): Promise<EvaluateOutcome> {
    if (input.origin !== 'REAL') return { opened: [], recovered: [], alerts: 0 }
    const changes: ConditionChange[] = []
    const outcome = await this.prisma.$transaction((tx) => this.evaluateBandLocked(tx, input, now, changes))
    await this.announce(changes)
    await this.notifyHealth(changes)
    return outcome
  }

  private async evaluateBandLocked(
    tx: Prisma.TransactionClient,
    input: BandDayInput,
    now: Date,
    changes: ConditionChange[],
  ): Promise<EvaluateOutcome> {
    const outcome: EvaluateOutcome = { opened: [], recovered: [], alerts: 0 }
    const session = { id: input.sessionId, workerId: input.workerId, origin: input.origin }
    // O mesmo lock do relógio e da varredura: as três portas mexem no mesmo
    // conjunto de condições do funcionário e da origem.
    await this.lockWorkerOrigin(tx, session)

    const [active, { maxBpm, restingBpm }] = await Promise.all([
      tx.telemetryCondition.findMany({
        where: { workerId: session.workerId, origin: session.origin, status: 'ACTIVE' },
        select: { id: true, kind: true },
      }),
      this.heartRateBaselineOf(tx, session, now),
    ])
    const thresholds = await loadThresholds(tx, session.workerId, maxBpm)
    const activeByKind = new Map(active.map((c) => [c.kind, c]))
    const episodes = calibratedBandEpisodes(
      input.batch,
      thresholds,
      { maxBpm, fallbackRestingBpm: restingBpm },
      new Set(activeByKind.keys()),
    )

    // Tipo e dia monitorado de cada episódio atrasado gravado neste lote: é
    // sobre eles que a conta dos repetidos roda, depois do laço.
    const lateEpisodes = new Map<string, { kind: TelemetryConditionKind; day: Date }>()
    for (const episode of episodes) {
      const { kind, threshold, observedValue } = episode
      if (episode.openedAtMs === null) {
        const row = activeByKind.get(kind)
        if (row === undefined || episode.recoveredAtMs === null) continue
        const recoveredAt = new Date(episode.recoveredAtMs)
        await tx.telemetryCondition.update({
          where: { id: row.id },
          data: { status: 'RECOVERED', recoveredAt, recoveryReason: 'NORMALIZED', lastSeenAt: recoveredAt },
        })
        outcome.recovered.push(kind)
        changes.push(changeOf(session.workerId, row.id, kind, 'RECOVERED', now))
        continue
      }

      const firstSeenAt = new Date(episode.openedAtMs)
      if (episode.recoveredAtMs !== null) {
        // Pelo cliente, e não pelo INSERT cru: o índice único é parcial em
        // ACTIVE, então uma condição recuperada não conflita com nada.
        const recoveredAt = new Date(episode.recoveredAtMs)
        await tx.telemetryCondition.create({
          data: {
            workerId: session.workerId,
            sessionId: session.id,
            origin: session.origin,
            kind,
            status: 'RECOVERED',
            firstSeenAt,
            lastSeenAt: recoveredAt,
            recoveredAt,
            recoveryReason: 'NORMALIZED',
            thresholdProfile: CALIBRATED_ALERT_PROFILE.version,
            thresholdRule: threshold.rule,
            thresholdValue: threshold.value,
            observedValue,
            calibrationDay: thresholds.calibrationDay,
            receivedAt: now,
          },
        })
        const day = monitoredDayOf(firstSeenAt)
        lateEpisodes.set(`${kind}:${day.getTime()}`, { kind, day })
        continue
      }

      const createdId = await this.insertCondition(tx, session, now, {
        kind,
        profileVersion: CALIBRATED_ALERT_PROFILE.version,
        rule: threshold.rule,
        value: threshold.value,
        observedValue,
        calibrationDay: thresholds.calibrationDay,
        firstSeenAt,
      })
      if (createdId === null) continue
      outcome.opened.push(kind)
      changes.push(changeOf(session.workerId, createdId, kind, 'OPENED', now))
      if (await this.openAlert(tx, createdId, session.workerId, session.origin, kind)) outcome.alerts += 1
    }

    for (const { kind, day } of lateEpisodes.values()) {
      const createdId = await this.openRepeatedEpisodes(tx, session, kind, day, thresholds.calibrationDay, now)
      if (createdId === null) continue
      outcome.opened.push('REPEATED_EPISODES')
      outcome.alerts += 1
      changes.push(changeOf(session.workerId, createdId, 'REPEATED_EPISODES', 'OPENED', now))
    }
    return outcome
  }

  /**
   * Episódios repetidos: com três ou mais episódios atrasados do mesmo tipo,
   * funcionário e origem no mesmo dia monitorado, grava a condição
   * REPEATED_EPISODES e o alerta dela. Devolve o id da condição criada, ou nulo
   * quando ainda não há episódios bastantes ou o dia já tem a sua.
   *
   * A condição nasce recuperada, como os episódios, no instante medido do
   * terceiro: ela descreve um padrão do que já passou, então nunca entra no
   * estado do funcionário. O alerta nasce assim mesmo, e sem a regra de "um
   * pendente por tipo" do openAlert: a unicidade aqui é por tipo repetido e
   * dia, e o alerta pendente de ontem não pode calar o padrão de hoje.
   *
   * Um por funcionário, origem, tipo repetido e dia, garantido pela consulta
   * antes de gravar: o índice único só olha condição ativa, e esta nasce
   * recuperada. O lock por funcionário e origem, já tomado, é o que impede dois
   * lotes de passarem pela consulta ao mesmo tempo.
   */
  private async openRepeatedEpisodes(
    tx: Prisma.TransactionClient,
    session: { id: string; workerId: string; origin: TelemetryOrigin },
    kind: TelemetryConditionKind,
    day: Date,
    calibrationDay: number | null,
    now: Date,
  ): Promise<string | null> {
    const { start, end } = monitoredDayWindow(day)
    const sameDay = { gte: start, lt: end }
    // Episódio atrasado é o que tem hora de recebimento: só ele a grava.
    const late = await tx.telemetryCondition.findMany({
      where: {
        workerId: session.workerId,
        origin: session.origin,
        kind,
        receivedAt: { not: null },
        firstSeenAt: sameDay,
      },
      select: { firstSeenAt: true },
      orderBy: { firstSeenAt: 'asc' },
    })
    if (late.length < REPEATED_EPISODES_THRESHOLD) return null
    const existing = await tx.telemetryCondition.findFirst({
      where: {
        workerId: session.workerId,
        origin: session.origin,
        kind: 'REPEATED_EPISODES',
        episodeKind: kind,
        firstSeenAt: sameDay,
      },
      select: { id: true },
    })
    if (existing !== null) return null

    // O terceiro pela hora medida, e não o último a chegar: um lote velho que
    // chega depois pode trazer episódios de antes dos já gravados.
    const at = late[REPEATED_EPISODES_THRESHOLD - 1].firstSeenAt
    const created = await tx.telemetryCondition.create({
      data: {
        workerId: session.workerId,
        sessionId: session.id,
        origin: session.origin,
        kind: 'REPEATED_EPISODES',
        episodeKind: kind,
        status: 'RECOVERED',
        firstSeenAt: at,
        lastSeenAt: at,
        recoveredAt: at,
        // Os episódios que ela conta fecharam todos pela banda.
        recoveryReason: 'NORMALIZED',
        thresholdProfile: CALIBRATED_ALERT_PROFILE.version,
        // Regra nula: a contagem é a mesma para todo mundo, como o silêncio.
        thresholdRule: null,
        thresholdValue: REPEATED_EPISODES_THRESHOLD,
        observedValue: late.length,
        calibrationDay,
        receivedAt: now,
      },
      select: { id: true },
    })
    await tx.operationalAlert.create({
      data: { conditionId: created.id, workerId: session.workerId, origin: session.origin, status: 'OPEN' },
    })
    return created.id
  }

  /**
   * A máxima por idade e o repouso observado nos dias fechados, que são a
   * régua das travas de batimento quando a calibração ainda não tem o dela.
   */
  private async heartRateBaselineOf(
    tx: Prisma.TransactionClient,
    session: { workerId: string; origin: TelemetryOrigin },
    now: Date,
  ): Promise<{ maxBpm: number | null; restingBpm: number | null }> {
    const sinceDay = new Date(monitoredDayOf(now).getTime() - this.profile.restingDays * DAY_MS)
    const [profile, summaries] = await Promise.all([
      tx.profile.findUnique({ where: { userId: session.workerId }, select: { birthDate: true } }),
      tx.telemetryDailySummary.findMany({
        // Só dias fechados: o limite de batimento baixo parte do repouso medido,
        // e um Resumo provisório de dia aberto traria o mínimo de poucas horas.
        where: {
          workerId: session.workerId,
          origin: session.origin,
          day: { gte: sinceDay },
          heartRateMin: { not: null },
          provisional: false,
        },
        select: { heartRateMin: true },
        orderBy: { day: 'desc' },
        take: this.profile.restingDays,
      }),
    ])
    const birthDate = profile?.birthDate ?? null
    return {
      maxBpm: birthDate === null ? null : maxHeartRateForAge(ageInYearsAt(birthDate, now)),
      restingBpm: restingFromDailyMinima(summaries.flatMap((s) => (s.heartRateMin === null ? [] : [s.heartRateMin]))),
    }
  }

  private async evaluateLocked(
    tx: Prisma.TransactionClient,
    sessionId: string,
    triggerAt: Date,
    now: Date,
    changes: ConditionChange[],
    { spotReading }: { spotReading: boolean } = { spotReading: false },
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

    // A sessão é lida ANTES do lock porque é dela que sai a chave do lock, e
    // ler antes é seguro: funcionário e origem nascem com a linha e ninguém os
    // reescreve. A conferência de existência é aqui, e não mais no lock: o lock
    // consultivo não olha linha nenhuma, então zero linhas deixou de significar
    // "sessão inexistente".
    const session = await tx.telemetrySession.findUnique({
      where: { id: sessionId },
      select: { id: true, workerId: true, origin: true },
    })
    if (session === null) throw new Error(`Sessão de monitoramento ${sessionId} não existe para avaliar condições`)

    await this.lockWorkerOrigin(tx, session)

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

    // A origem REAL segue o perfil calibrado, pela faixa da pessoa e pelas
    // travas; a DEMO segue o v2, intocado, que é o que o roteiro de aceite mostra.
    const real = session.origin === 'REAL'
    const alertProfile = profileFor(session.origin)
    // A janela de batimento cobre a maior persistência do perfil: na REAL, os
    // 10 min da Atenção. A trava recorta sozinha o último minuto dela.
    const attentionFrom = new Date(triggerAt.getTime() - CALIBRATED_ALERT_PROFILE.attention.windowMs)
    const windowStart = real ? attentionFrom : new Date(triggerAt.getTime() - this.profile.persistence.windowMs)
    // Cada métrica tem a sua própria noção de "vale agora", e uma janela só não
    // serve às três. BPM precisa de evidência CONTÍNUA dentro da janela de
    // persistência; bateria e pressão precisam do ÚLTIMO valor conhecido dentro
    // do prazo de validade DELAS. Presa à janela do BPM, uma medição de pressão
    // carimbada mais de 60 s antes da amostra mais nova do lote não seria
    // avaliada por chamada nenhuma, porque a janela seguinte já andou para a
    // frente; e pressão é medida à mão e raramente, então perder uma é perder o
    // evento inteiro.
    //
    // As duas leituras pontuais são recortadas por FUNCIONÁRIO e origem, e não
    // por sessão, porque prazo de 30 min e de 72 h não cabe dentro de uma
    // sessão: ela nasce de novo a cada reconexão do relógio. Recortada por
    // sessão, uma medição de pressão de ontem seria atual pelo domínio e
    // apareceria no painel, mas ficaria invisível para a avaliação. A condição
    // já é chaveada por (workerId, origin) pelo mesmo motivo: sobrevive à
    // sessão. A janela de 60 s do BPM continua por sessão, porque evidência
    // CONTÍNUA de esforço só faz sentido dentro de uma.
    const batteryFrom = new Date(triggerAt.getTime() - FRESHNESS.BATTERY.staleMs)
    const pressureFrom = new Date(triggerAt.getTime() - FRESHNESS.BLOOD_PRESSURE.staleMs)
    const wearFrom = new Date(triggerAt.getTime() - FRESHNESS.VITAL.staleMs)
    // No caminho do evento o teto é o próprio gatilho. Na medição avulsa o
    // gatilho é o relógio do servidor, e a ingestão aceita horário até a folga
    // de relógio adiantado: sem estender o teto, a medição que acabou de
    // chegar carimbada alguns segundos à frente ficaria fora da conta que a
    // chegada dela disparou, e a revisão não abriria.
    const pressureUntil = spotReading ? new Date(triggerAt.getTime() + CLOCK_SKEW_MS) : triggerAt
    const oxygenFrom = new Date(triggerAt.getTime() - OXYGEN_LOOKBACK_MS)
    const [rows, batteryRow, pressureRow, wearRow, { maxBpm, restingBpm }, wearRows, oxygenRows] = await Promise.all([
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
        where: {
          workerId: session.workerId,
          origin: session.origin,
          batteryPercent: { not: null },
          eventTime: { gte: batteryFrom, lte: triggerAt },
        },
        select: { batteryPercent: true },
        orderBy: { eventTime: 'desc' },
      }),
      // 72 h é FRESHNESS.BLOOD_PRESSURE.staleMs, pelo mesmo motivo: passado
      // esse prazo o domínio diz "sem medição recente" e o valor some da tela,
      // então é exatamente aí que ele deixa de poder abrir condição.
      tx.telemetrySample.findFirst({
        where: {
          workerId: session.workerId,
          origin: session.origin,
          systolicMmHg: { not: null },
          diastolicMmHg: { not: null },
          eventTime: { gte: pressureFrom, lte: pressureUntil },
        },
        select: { systolicMmHg: true, diastolicMmHg: true, eventTime: true },
        orderBy: { eventTime: 'desc' },
      }),
      // Desgaste é a última avaliação DA SESSÃO, e não do funcionário: a cadeia
      // da fórmula reinicia a cada sessão, e é o desgaste dessa cadeia que a
      // condição descreve. A ingestão avalia antes de chamar aqui, então no
      // caminho normal a avaliação lida é a que este mesmo lote acabou de
      // gravar. O prazo é FRESHNESS.VITAL.staleMs, o mesmo que torna esforço
      // e desgaste indisponíveis no painel: avaliação mais velha que isso não
      // descreve o agora e não pode abrir condição.
      tx.telemetryAssessment.findFirst({
        where: { sessionId, windowEnd: { gte: wearFrom, lte: triggerAt } },
        select: { wearPercent: true },
        orderBy: { windowEnd: 'desc' },
      }),
      this.heartRateBaselineOf(tx, session, now),
      // A Atenção de desgaste olha as avaliações da sessão dos últimos 10 min,
      // pelo fim da janela de cada uma, como a última avaliação acima. Só REAL.
      real
        ? tx.telemetryAssessment.findMany({
            where: { sessionId, wearPercent: { not: null }, windowEnd: { gte: attentionFrom, lte: triggerAt } },
            select: { windowEnd: true, wearPercent: true },
          })
        : Promise.resolve([]),
      // Oxigenação é pontual como a pressão: por funcionário e origem, com o
      // mesmo teto da folga de relógio adiantado. As duas últimas bastam: a
      // trava olha a última, a Atenção as duas. Só REAL.
      real
        ? tx.telemetrySample.findMany({
            where: {
              workerId: session.workerId,
              origin: session.origin,
              oxygenSaturationPct: { not: null },
              eventTime: { gte: oxygenFrom, lte: pressureUntil },
            },
            select: { eventTime: true, oxygenSaturationPct: true },
            orderBy: { eventTime: 'desc' },
            take: 2,
          })
        : Promise.resolve([]),
    ])

    const thresholds = real ? await loadThresholds(tx, session.workerId, maxBpm) : null

    // batteryPercent fica nulo aqui de propósito: o motor recebe a bateria como
    // escalar, pela leitura própria, e nenhuma decisão de BPM olha esta coluna.
    const samples: EngineSample[] = rows.map((r) => ({
      atMs: r.eventTime.getTime(),
      heartRateBpm: r.heartRateBpm,
      batteryPercent: null,
    }))
    const latestBattery = batteryRow?.batteryPercent ?? null
    const latestWear = wearRow?.wearPercent ?? null
    // O filtro `not: null` não estreita o tipo devolvido pelo Prisma, então as
    // duas colunas são conferidas aqui em vez de assertadas.
    const pressure =
      pressureRow === null || pressureRow.systolicMmHg === null || pressureRow.diastolicMmHg === null
        ? null
        : { systolic: pressureRow.systolicMmHg, diastolic: pressureRow.diastolicMmHg }
    // Carimbo no futuro (a folga do relógio adiantado) abre com agora.
    const pressureAt =
      pressureRow === null ? now : new Date(Math.min(pressureRow.eventTime.getTime(), now.getTime()))

    const oxygen = oxygenRows.flatMap((r) =>
      r.oxygenSaturationPct === null ? [] : [{ atMs: r.eventTime.getTime(), value: r.oxygenSaturationPct }],
    )

    const nowMs = triggerAt.getTime()
    // A medição avulsa decide só a pressão e a oxigenação. As outras leituras
    // do relógio lidas acima ficam sem uso nesse caso, de propósito: o que
    // elas dizem já foi decidido no último evento dele, e decidi-las de novo
    // sem dado novo é o que reabriria bateria baixa de um relógio que parou de
    // falar. No evento do relógio, pressão e oxigenação entram junto.
    let decisions: Decision[]
    if (thresholds !== null) {
      const activeKinds = new Set(activeByKind.keys())
      const spotDecisions = [
        ...calibratedPressureDecisions(pressure, thresholds, activeKinds),
        ...calibratedOxygenDecisions(oxygen, thresholds, activeKinds),
      ]
      const wear = wearRows.flatMap((r) =>
        r.wearPercent === null ? [] : [{ atMs: r.windowEnd.getTime(), value: r.wearPercent }],
      )
      decisions = spotReading
        ? spotDecisions
        : [
            ...calibratedWatchDecisions(
              { samples, wear, latestWear, battery: latestBattery, maxBpm, fallbackRestingBpm: restingBpm, nowMs },
              thresholds,
              activeKinds,
            ),
            ...spotDecisions,
          ]
    } else {
      const limits = heartRateLimits(this.profile, { maxBpm, restingBpm })
      const pressureDecision = decideBloodPressure(pressure, activeByKind.has('BLOOD_PRESSURE_REVIEW'), this.profile)
      decisions = (
        spotReading
          ? [pressureDecision]
          : [
              decideHeartRate('HEART_RATE_HIGH', samples, limits.high, activeByKind.has('HEART_RATE_HIGH'), this.profile, nowMs),
              decideHeartRate('HEART_RATE_LOW', samples, limits.low, activeByKind.has('HEART_RATE_LOW'), this.profile, nowMs),
              decideBattery(latestBattery, activeByKind.has('DEVICE_BATTERY_LOW'), this.profile),
              pressureDecision,
              decideWear(latestWear, activeByKind.has('WEAR_HIGH'), this.profile),
            ]
      ).flatMap((d) => (d === null ? [] : [d]))
    }

    // Evento ao vivo é sinal de volta: perda de sinal ativa recupera aqui, e
    // não na varredura, que só enxerga o silêncio. Medição avulsa do app Saúde
    // não é o relógio falando, e por isso não recupera.
    if (!spotReading && activeByKind.has('DEVICE_SIGNAL_LOST')) {
      decisions.push({ kind: 'DEVICE_SIGNAL_LOST', action: 'RECOVER', observedValue: null, threshold: null })
    }

    // Recuperar antes de abrir. Já foi a garantia de que uma violação de
    // unicidade não levava as recuperações junto; hoje quem garante isso é o ON
    // CONFLICT DO NOTHING da abertura, que não aborta a transação. A ordem fica
    // como boa prática: fechar o que já não vale antes de abrir o que passou a
    // valer deixa a leitura da linha do tempo na ordem dos fatos.
    const recoveredIds = new Set<string>()
    for (const decision of decisions) {
      if (decision.action !== 'RECOVER') continue
      const row = activeByKind.get(decision.kind)
      if (row === undefined) continue
      // observedValue não é reescrito: ele guarda o valor que ABRIU a
      // condição, que é o que a auditoria quer saber. O valor da recuperação
      // já está no histórico de amostras.
      //
      // Perda de sinal fecha com motivo próprio: NORMALIZED afirma que o valor
      // voltou pela banda, e esta condição não tem valor nem banda. Sem a
      // distinção, quem audita não separa batimento que normalizou de relógio
      // que voltou a falar, e é esta que mais vai oscilar no piloto.
      const reason = decision.kind === 'DEVICE_SIGNAL_LOST' ? 'SIGNAL_RESTORED' : 'NORMALIZED'
      await tx.telemetryCondition.update({
        where: { id: row.id },
        data: { status: 'RECOVERED', recoveredAt: now, recoveryReason: reason, lastSeenAt: now },
      })
      outcome.recovered.push(decision.kind)
      recoveredIds.add(row.id)
      changes.push(changeOf(session.workerId, row.id, decision.kind, 'RECOVERED', now))
    }

    // lastSeenAt é a última vez que uma AVALIAÇÃO COBRIU este funcionário com a
    // condição ainda aberta, e não quando ela abriu. Leia ao pé da letra: a
    // renovação é movida por "uma avaliação rodou para esta sessão", e não por
    // "a evidência ainda sustenta esta condição". Ela NÃO prova persistência,
    // porque o motor devolve nulo tanto para "sem amostra na janela" quanto
    // para "continua acima", e um HEART_RATE_HIGH segue ativo, e carimbado,
    // sem nenhuma amostra de BPM chegando. Quem precisar da prova tem de olhar
    // as amostras.
    //
    // Assim mesmo é o significado útil: sem renovar, uma condição ativa há três
    // horas, com o funcionário mandando dado o tempo todo, exibiria carimbo
    // idêntico ao firstSeenAt, e o índice [status, lastSeenAt] deixaria de
    // servir a uma varredura que procure condição esquecida. Quem recuperou
    // fica de fora: já levou o carimbo do fechamento e não segue aberta.
    //
    // Antes das aberturas pelo mesmo motivo que as recuperações: mantém junto
    // tudo o que mexe em condição já existente, antes do que cria linha nova.
    const refreshBefore = new Date(now.getTime() - LAST_SEEN_REFRESH_MS)
    for (const row of active) {
      if (recoveredIds.has(row.id)) continue
      // A medição avulsa só cobriu a pressão: o carimbo das condições do
      // relógio não pode andar por causa de uma avaliação que não as olhou.
      if (spotReading && !SPOT_READING_KINDS.has(row.kind)) continue
      if (row.lastSeenAt > refreshBefore) continue
      await tx.telemetryCondition.update({ where: { id: row.id }, data: { lastSeenAt: now } })
    }

    for (const decision of decisions) {
      if (decision.action !== 'OPEN') continue
      // A escrita é crua, e a mesma da varredura de silêncio: o motivo de ela
      // ser crua está em insertCondition, junto do SQL.
      const createdId = await this.insertCondition(tx, session, now, {
        kind: decision.kind,
        profileVersion: alertProfile.version,
        rule: decision.threshold?.rule ?? null,
        value: decision.threshold?.value ?? null,
        observedValue: decision.observedValue,
        // O dia da calibração vai para a condição como selo, até o 30º.
        calibrationDay: thresholds?.calibrationDay ?? null,
        firstSeenAt: PRESSURE_KINDS.has(decision.kind) ? pressureAt : undefined,
      })
      if (createdId === null) continue

      outcome.opened.push(decision.kind)
      changes.push(changeOf(session.workerId, createdId, decision.kind, 'OPENED', now))
      if (await this.openAlert(tx, createdId, session.workerId, session.origin, decision.kind)) outcome.alerts += 1
    }

    if (outcome.opened.length > 0 || outcome.recovered.length > 0) {
      this.logger.debug(
        // Quantas, e não quais: o tipo da condição é dado de saúde de quem
        // está na sessão, e fica só no banco.
        `Condições da sessão ${session.id}: ${outcome.opened.length} aberta(s), ${outcome.recovered.length} recuperada(s), ${outcome.alerts} alerta(s)`,
      )
    }
    return outcome
  }

  /**
   * Varre as sessões silenciosas e trata a AUSÊNCIA de evento. É a outra porta
   * do motor: perda de sinal não nasce de um valor que chegou, nasce de nada
   * ter chegado, e o caminho do evento é cego para ela por definição, porque
   * relógio calado não dispara chamada nenhuma.
   *
   * A candidata é lida do SNAPSHOT, e não da sessão, por dois motivos. O
   * primeiro: o snapshot tem uma linha por funcionário e só é promovido por
   * evento AO VIVO, então backlog que chega depois de uma reconexão nunca conta
   * como sinal. O segundo é dívida assumida: sessão de monitoramento nunca
   * encerra neste sistema, e `status`, `interruptedAt` e `endedAt` não são
   * escritos por ninguém, então a varredura não pode confiar neles e "sessão
   * viva" acaba definida por silêncio aqui. No dia em que o ciclo de vida
   * passar a encerrar sessão, esta definição deve ceder à dele.
   */
  async sweepSilentSessions(now: Date): Promise<SweepOutcome> {
    const { silenceMs } = this.profile.signalLost
    // Só a fronteira do silêncio, e ABERTA em cima: o prazo é o mesmo que o
    // caminho do evento usa para dizer "ao vivo", e um carimbo exatamente em
    // cima dele é ao vivo lá, então não pode ser silêncio aqui.
    //
    // O teto de turno NÃO entra: filtrando por ele aqui, ele governaria as duas
    // coisas, e recuperar passaria a depender de a gente estar rodando. Uma
    // queda de fim de semana, ou um deploy longo, e o batimento alto aberto na
    // sexta nunca recuperaria, porque na segunda a sessão já não seria
    // candidata. O teto governa só a ABERTURA, e por candidata.
    //
    // Origem REAL, e só ela. O snapshot tem uma linha por funcionário e a
    // origem é substituída por inteiro, então sem o filtro a varredura opera na
    // origem de QUEM FALOU POR ÚLTIMO: uma demonstração rodada por cima de
    // alguém com condição real aberta faria a rodada seguinte ler as condições
    // de (funcionário, DEMO), não recuperar nada e abrir perda de sinal em
    // DEMO, com a condição REAL aberta para sempre e perda de sinal real
    // nenhuma registrada. Demonstração é ensaio, não observação: ninguém está
    // esperando dado de um ensaio que acabou. CONSEQUÊNCIA ACEITA: rodar uma
    // demonstração num funcionário que tem condição real aberta deixa essa
    // condição aberta até ele voltar a mandar telemetria real, e isso é aceito
    // porque demonstração é rara e deliberada. De brinde, o índice
    // [origin, lastLiveEventTime] do snapshot passa a ser usável: origem é a
    // coluna líder dele.
    //
    // A mais calada primeiro, para o teto da rodada cortar as menos urgentes.
    const candidates = await this.prisma.telemetrySnapshot.findMany({
      where: {
        origin: 'REAL',
        sessionId: { not: null },
        // Mede pelo último evento AO VIVO, e não pelo último evento: o lote da
        // pulseira pelo Health Connect anda o último evento sem ser sinal ao
        // vivo, e horas sem lote é o normal dela, então perda de sinal ali
        // seria alarme falso permanente. Quem só manda lote tem a coluna nula
        // e nunca é candidato; a pulseira pelo Bluetooth fala ao vivo e entra
        // na conta como o relógio, sem filtro pelo tipo do aparelho.
        //
        // O piso (MONITORED_SILENCE_FLOOR_MS) corta quem sumiu do piloto; ele
        // não é teto de turno, e o motivo está na declaração da constante.
        lastLiveEventTime: {
          lt: new Date(now.getTime() - silenceMs),
          gte: new Date(now.getTime() - MONITORED_SILENCE_FLOOR_MS),
        },
      },
      select: { sessionId: true },
      orderBy: { lastLiveEventTime: 'asc' },
      take: MAX_SILENT_SESSIONS_PER_RUN,
    })
    if (candidates.length === MAX_SILENT_SESSIONS_PER_RUN) {
      this.logger.warn(
        `Varredura de silêncio bateu o teto de ${MAX_SILENT_SESSIONS_PER_RUN} candidatas na rodada; o resto entra na seguinte`,
      )
    }

    const outcome: SweepOutcome = { scanned: candidates.length, signalLost: 0, recovered: 0 }
    for (const candidate of candidates) {
      // O `where` já exclui sessão nula; a conferência aqui é o que estreita o
      // tipo, porque a coluna é opcional no schema.
      const sessionId = candidate.sessionId
      if (sessionId === null) continue
      try {
        // Uma transação por candidata, e não uma pela rodada: a rodada varre
        // todo mundo a cada 30 s, e uma sessão que estoure não pode deixar o
        // resto do turno sem perda de sinal registrada. É o mesmo desenho da
        // varredura do ciclo de vida, pelo mesmo motivo.
        const changes: ConditionChange[] = []
        const one = await this.prisma.$transaction((tx) => this.sweepLocked(tx, sessionId, now, changes))
        outcome.signalLost += one.signalLost
        outcome.recovered += one.recovered
        // Depois do commit desta candidata, e não ao fim da rodada: quem
        // recuperou ou perdeu sinal aparece no painel sem esperar o resto.
        await this.announce(changes)
        await this.notifyHealth(changes)
      } catch (error) {
        // Sem valor de saúde na mensagem, como no ciclo de vida: log é lugar
        // onde dado sensível vaza sem ninguém notar. Só a sessão, que é o que
        // permite repetir a mão.
        this.logger.warn(`Varredura de silêncio falhou para a sessão ${sessionId}: ${describeError(error)}`)
      }
    }
    return outcome
  }

  private async sweepLocked(
    tx: Prisma.TransactionClient,
    sessionId: string,
    now: Date,
    changes: ConditionChange[],
  ): Promise<{ signalLost: number; recovered: number }> {
    const result = { signalLost: 0, recovered: 0 }

    // Sessão antes do lock, como no caminho do evento e pelo mesmo motivo: é
    // dela que sai a chave, e a existência precisa continuar sendo conferida
    // agora que o lock não olha linha nenhuma.
    const session = await tx.telemetrySession.findUnique({
      where: { id: sessionId },
      select: { id: true, workerId: true, origin: true },
    })
    if (session === null) throw new Error(`Sessão de monitoramento ${sessionId} não existe para varrer silêncio`)

    // Mesmo lock do caminho do evento, e é ele que resolve a corrida com um
    // lote que chega neste instante: quem chegar segundo lê o estado que o
    // primeiro já gravou, em vez de os dois decidirem sobre a mesma leitura.
    await this.lockWorkerOrigin(tx, session)

    // O silêncio é RELIDO aqui dentro, e não trazido da busca de candidatas: o
    // laço leva tempo, e o carimbo da busca envelhece nesse intervalo, então
    // gravá-lo subestimaria o silêncio pelo tempo da rodada, justo na coluna
    // que a auditoria vai ler.
    //
    // Relê pela sessão, e não pelo funcionário: se o snapshot já não aponta
    // para esta sessão e origem, quem manda é quem escreveu depois. E se a
    // sessão voltou a falar entre a busca e o lock, esta candidata não é mais
    // assunto da varredura: quem chegou depois tem a informação mais nova.
    const { silenceMs, shiftCeilingMs } = this.profile.signalLost
    const snapshot = await tx.telemetrySnapshot.findFirst({
      where: { sessionId, origin: session.origin },
      select: { lastLiveEventTime: true },
    })
    if (snapshot?.lastLiveEventTime == null) return result
    const observedSilenceMs = now.getTime() - snapshot.lastLiveEventTime.getTime()
    if (observedSilenceMs <= silenceMs) return result

    // Por funcionário e origem, como no caminho do evento: a condição sobrevive
    // à sessão, e demonstração nunca cega o real.
    //
    // lastSeenAt fica FORA da projeção de propósito, porque a varredura não
    // renova carimbo nenhum. Renovar faria a segunda rodada sobre o mesmo
    // silêncio escrever, e o carimbo passaria a andar por causa de ausência de
    // dado, que é o oposto do que ele significa.
    const active = await tx.telemetryCondition.findMany({
      where: { workerId: session.workerId, origin: session.origin, status: 'ACTIVE' },
      select: { id: true, kind: true },
    })

    // Recuperar antes de abrir, pela mesma razão de ordem do caminho do evento:
    // fechar o que já não vale antes de abrir o que passou a valer deixa a
    // leitura da linha do tempo na ordem dos fatos.
    //
    // E recuperar SEM olhar teto de turno, de propósito: valor que ninguém mede
    // não vale, tenha o silêncio dois minutos ou dois dias. É a abertura que
    // olha o teto, logo abaixo, e os dois tetos são diferentes porque as duas
    // perguntas são diferentes: "esta condição ainda se sustenta?" não depende
    // do turno de ninguém, "vale a pena avisar a operação?" depende.
    for (const row of active) {
      if (!SILENCE_RECOVERS.has(row.kind)) continue
      await tx.telemetryCondition.update({
        where: { id: row.id },
        data: { status: 'RECOVERED', recoveredAt: now, recoveryReason: 'SIGNAL_LOST', lastSeenAt: now },
      })
      result.recovered += 1
      changes.push(changeOf(session.workerId, row.id, row.kind, 'RECOVERED', now))
    }

    // Passado o teto do turno, ninguém está esperando dado: relógio guardado no
    // armário há dois dias não é notícia, e abrir perda de sinal ali encheria o
    // painel de item que não é para ninguém.
    if (observedSilenceMs > shiftCeilingMs) return result

    // Idempotência: com perda de sinal já ativa não há o que abrir, e a rodada
    // seguinte sobre o mesmo silêncio não grava nada. Importa porque a
    // varredura roda a cada 30 s e o silêncio dura minutos.
    if (active.some((row) => row.kind === 'DEVICE_SIGNAL_LOST')) return result

    // Sem alerta de propósito: aparelho fora do alcance é estado do
    // funcionário, não item de fila. DEVICE_SIGNAL_LOST não está em
    // ALERTING_KINDS, e openAlert nem chega a ser chamado aqui.
    const created = await this.insertCondition(tx, session, now, {
      kind: 'DEVICE_SIGNAL_LOST',
      // O prazo de silêncio é o mesmo nos dois perfis; a versão gravada é a da
      // origem, para a linha dizer com que perfil a pessoa estava sendo vista.
      profileVersion: profileFor(session.origin).version,
      // Regra nula porque não se personaliza silêncio: o limite é o prazo do
      // perfil, igual para todo mundo. O valor observado é o silêncio medido em
      // milissegundos, que é o que a auditoria quer saber depois.
      rule: null,
      value: this.profile.signalLost.silenceMs,
      observedValue: observedSilenceMs,
      calibrationDay: null,
    })
    if (created !== null) {
      result.signalLost += 1
      changes.push(changeOf(session.workerId, created, 'DEVICE_SIGNAL_LOST', 'OPENED', now))
    }
    return result
  }

  /**
   * Encerramento por vencimento: fecha a condição de saúde cuja métrica não tem
   * medição nova do mesmo funcionário e origem há 24 h. Cobre o que a varredura
   * de silêncio não cobre (pressão, oxigenação, lote do Health Connect), que
   * sem isto ficaria aberto para sempre e engoliria a próxima condição do mesmo
   * tipo, já que só existe uma ativa por tipo.
   *
   * Motivo próprio, NO_NEW_READING, e nunca NORMALIZED: ninguém viu o valor
   * voltar. O alerta não muda, porque só um humano fecha alerta, e ninguém é
   * notificado, porque "sua condição foi encerrada" seria lido como melhora. O
   * evento de tempo real sai como em qualquer fechamento, para o painel tirar a
   * condição da lista.
   *
   * Roda no agendamento do silêncio, com o mesmo instante da rodada. Origem
   * nenhuma é filtrada: a conta é por condição, contra amostras da mesma origem,
   * e o atalho do snapshot que obriga o silêncio a ficar no REAL não existe aqui.
   */
  async sweepNoNewReading(now: Date): Promise<NoNewReadingOutcome> {
    const cutoff = new Date(now.getTime() - NO_NEW_READING_MS)
    const candidates = await this.prisma.$queryRaw<NoNewReadingCandidate[]>(noNewReadingCandidates(cutoff))
    if (candidates.length === MAX_NO_NEW_READING_PER_RUN) {
      this.logger.warn(
        `Varredura de vencimento bateu o teto de ${MAX_NO_NEW_READING_PER_RUN} candidatas na rodada; o resto entra na seguinte`,
      )
    }

    const outcome: NoNewReadingOutcome = { scanned: candidates.length, recovered: 0 }
    for (const candidate of candidates) {
      try {
        // Uma transação por candidata, como no silêncio: uma que estoure não
        // segura as outras.
        const changes: ConditionChange[] = []
        await this.prisma.$transaction((tx) => this.closeWithoutNewReading(tx, candidate, cutoff, now, changes))
        outcome.recovered += changes.length
        // Só o anúncio, e nunca notifyHealth: ver o comentário do método.
        await this.announce(changes)
      } catch (error) {
        this.logger.warn(`Varredura de vencimento falhou para a condição ${candidate.id}: ${describeError(error)}`)
      }
    }
    return outcome
  }

  private async closeWithoutNewReading(
    tx: Prisma.TransactionClient,
    candidate: NoNewReadingCandidate,
    cutoff: Date,
    now: Date,
    changes: ConditionChange[],
  ): Promise<void> {
    // Mesmo lock das outras duas portas, e é ele que faz a condição fechar por
    // um motivo só: se o silêncio ou uma medição nova chegou antes, quem chega
    // depois lê o que o primeiro gravou.
    await this.lockWorkerOrigin(tx, candidate)

    // A busca de candidatas rodou fora do lock: a amostra é RELIDA aqui, para
    // um lote que chegou no meio da rodada segurar a condição aberta.
    const column = NO_NEW_READING_METRIC[candidate.kind]
    if (column === null) return
    const renewed = await tx.telemetrySample.findFirst({
      where: {
        workerId: candidate.workerId,
        origin: candidate.origin,
        eventTime: { gt: cutoff },
        ...MEASURED[column],
      },
      select: { eventTime: true },
    })
    if (renewed !== null) return

    // ACTIVE no `where`: condição que o silêncio, a normalização ou outra
    // rodada já fechou guarda o motivo de quem chegou primeiro.
    const { count } = await tx.telemetryCondition.updateMany({
      where: { id: candidate.id, status: 'ACTIVE' },
      data: { status: 'RECOVERED', recoveredAt: now, recoveryReason: 'NO_NEW_READING', lastSeenAt: now },
    })
    if (count === 0) return
    changes.push(changeOf(candidate.workerId, candidate.id, candidate.kind, 'RECOVERED', now))
  }

  /**
   * Anuncia ao funcionário e aos administradores da empresa dele. Nunca
   * levanta: a condição já está gravada, e o painel reconcilia pelo REST quando
   * o socket falha.
   */
  /**
   * Condição aberta vira notificação do feed. O notificador já não levanta;
   * a guarda aqui mantém a regra local: nada depois do commit derruba a
   * avaliação.
   */
  private async notifyHealth(changes: ConditionChange[]): Promise<void> {
    if (changes.length === 0) return
    try {
      await this.healthNotifier.notifyOpened(changes)
    } catch (error) {
      this.logger.warn(`Falha ao notificar condições: ${describeError(error)}`)
    }
  }

  private async announce(changes: ConditionChange[]): Promise<void> {
    if (changes.length === 0) return
    const recipientsByWorker = new Map<string, string[]>()
    for (const change of changes) {
      try {
        let recipients = recipientsByWorker.get(change.workerId)
        if (recipients === undefined) {
          recipients = await this.audience.recipientsFor(change.workerId)
          recipientsByWorker.set(change.workerId, recipients)
        }
        this.realtime.emitToUsers(recipients, CONDITION_CHANGED_EVENT, change)
      } catch (error) {
        this.logger.warn(`Falha ao anunciar condição ${change.conditionId}: ${describeError(error)}`)
      }
    }
  }

  /**
   * Serializa as duas portas do motor, a do valor e a da ausência, pelo par
   * FUNCIONÁRIO e ORIGEM, que é exatamente o escopo do invariante do índice
   * único parcial (workerId, kind, origin).
   *
   * Lock consultivo, e não a linha da sessão. Travar a sessão tem escopo menor
   * que o invariante: reconexão do relógio cria sessão nova, duas sessões do
   * mesmo funcionário travam linhas distintas, não se enfileiram, e as duas
   * mexem no mesmo conjunto de condições. A varredura torna isso COMUM em vez
   * de raro, porque ela trava a sessão velha que veio do snapshot enquanto o
   * lote novo trava a nova: por desenho, elas nunca se enfileiravam.
   *
   * `pg_advisory_xact_lock` é solto no fim da transação, sem unlock, então não
   * há caminho de saída que vaze o lock. A chave sai do TEXTO "funcionário e
   * origem" por `hashtext`: colisão de hash só faz dois pares distintos
   * esperarem um pelo outro, que custa latência e não corrompe nada.
   */
  private async lockWorkerOrigin(
    tx: Prisma.TransactionClient,
    session: { workerId: string; origin: TelemetryOrigin },
  ): Promise<void> {
    // $executeRaw, NUNCA $queryRaw: pg_advisory_xact_lock devolve void, e o
    // desserializador do Prisma não tem tipo para void, então o $queryRaw
    // levanta ANTES de o lock ser tomado. Não padronize isto de volta.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${session.workerId}:${session.origin}`}))`
  }

  /**
   * Abre uma condição. Escrita crua, e só ESTA: é a única do serviço que pode
   * violar índice, e o preço da violação é a transação inteira. O lock por
   * funcionário e origem já enfileira as duas portas do motor, então o conflito
   * ficou raro; ele não ficou impossível, porque nada obriga um escritor futuro
   * a passar por aqui, e é contra isso que a cláusula abaixo protege. O Prisma
   * não envolve consulta individual em savepoint, então engolir o P2002
   * impediria o LANÇAMENTO, não o ABORTO: o Postgres põe a transação em estado
   * abortado e o comando seguinte morre com 25P02, que não é P2002, sobe, e
   * leva junto as recuperações já gravadas.
   *
   * ON CONFLICT DO NOTHING resolve no banco: nunca levanta e nunca aborta. Zero
   * linhas em RETURNING é exatamente o sinal de "outro escritor já abriu esta
   * condição", que é o estado desejado, e devolve nulo: não conta como aberta
   * por este chamador, não vira alerta e não entra no resultado.
   *
   * Uma função só para as duas portas, a do valor e a da ausência, porque o
   * motivo de a escrita ser crua é o mesmo nas duas, e duas cópias deste SQL
   * divergiriam na primeira coluna que alguém acrescentasse.
   *
   * Template marcado, nunca concatenação: é o que parametriza os valores. Os
   * enums levam CAST explícito porque o parâmetro chega como texto, no mesmo
   * padrão que o read model usa para origem. id e updatedAt vão à mão porque os
   * padrões deles são do cliente Prisma, e não do banco: a inserção crua passa
   * por fora do cliente e a coluna não tem DEFAULT.
   */
  private async insertCondition(
    tx: Prisma.TransactionClient,
    session: { id: string; workerId: string; origin: TelemetryOrigin },
    now: Date,
    opening: {
      kind: TelemetryConditionKind
      profileVersion: string
      rule: string | null
      value: number | null
      observedValue: number | null
      calibrationDay: number | null
      /** Instante medido em que abriu, quando não é agora: o da pulseira. */
      firstSeenAt?: Date
    },
  ): Promise<string | null> {
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "TelemetryCondition" (
        "id", "workerId", "sessionId", "origin", "kind", "status", "firstSeenAt", "lastSeenAt",
        "thresholdProfile", "thresholdRule", "thresholdValue", "observedValue", "calibrationDay", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text,
        ${session.workerId},
        ${session.id},
        CAST(${session.origin} AS "TelemetryOrigin"),
        CAST(${opening.kind} AS "TelemetryConditionKind"),
        CAST(${'ACTIVE'} AS "TelemetryConditionStatus"),
        ${opening.firstSeenAt ?? now},
        ${now},
        ${opening.profileVersion},
        ${opening.rule},
        ${opening.value},
        ${opening.observedValue},
        ${opening.calibrationDay},
        ${now}
      )
      ON CONFLICT ("workerId", "kind", "origin") WHERE "status" = 'ACTIVE' DO NOTHING
      RETURNING id
    `
    const createdId = inserted[0]?.id ?? null
    if (createdId === null) {
      this.logger.debug(
        `Condição da sessão ${session.id} (${session.origin}) já estava aberta por outro escritor`,
      )
    }
    return createdId
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
   *
   * Alerta pendente de condição encerrada por vencimento NÃO segura o novo. A
   * condição vencida diz que ninguém mediu nada em 24 h, e a medição fora da
   * faixa que chega depois é fato novo: calá-la atrás do alerta antigo seria o
   * mesmo alerta engolido que o vencimento existe para impedir.
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
      where: {
        workerId,
        origin,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        // O nulo à parte: `not` sozinho, no SQL, também descartaria a condição
        // ainda aberta, que é justamente a que tem de segurar.
        condition: { kind, OR: [{ recoveryReason: null }, { recoveryReason: { not: 'NO_NEW_READING' } }] },
      },
      select: { id: true },
    })
    if (unresolved !== null) return false
    await tx.operationalAlert.create({ data: { conditionId, workerId, origin, status: 'OPEN' } })
    return true
  }
}

/**
 * Candidatas do vencimento numa consulta só: condição ativa de saúde para a
 * qual NÃO EXISTE amostra do mesmo funcionário e origem, com a métrica dela,
 * mais nova que o corte. O NOT EXISTS anda pelo índice [workerId, eventTime] da
 * amostra, e só volta quem venceu, então as condições sustentadas não ocupam
 * vaga no teto da rodada. A mais esquecida primeiro.
 *
 * O nome da coluna entra cru porque identificador não se parametriza; ele vem
 * só de NO_NEW_READING_METRIC, nunca de fora.
 */
function noNewReadingCandidates(cutoff: Date): Prisma.Sql {
  const kindsByColumn = new Map<NoNewReadingColumn, TelemetryConditionKind[]>()
  for (const [kind, column] of Object.entries(NO_NEW_READING_METRIC) as Array<
    [TelemetryConditionKind, NoNewReadingColumn | null]
  >) {
    if (column === null) continue
    kindsByColumn.set(column, [...(kindsByColumn.get(column) ?? []), kind])
  }
  const perMetric = [...kindsByColumn].map(
    ([column, kinds]) => Prisma.sql`(
      c."kind"::text IN (${Prisma.join(kinds)})
      AND NOT EXISTS (
        SELECT 1 FROM "TelemetrySample" s
        WHERE s."workerId" = c."workerId"
          AND s."origin" = c."origin"
          AND s."eventTime" > ${cutoff}
          AND s.${Prisma.raw(`"${column}"`)} IS NOT NULL
      )
    )`,
  )
  return Prisma.sql`
    SELECT c."id", c."workerId", c."origin"::text AS "origin", c."kind"::text AS "kind"
    FROM "TelemetryCondition" c
    WHERE c."status" = 'ACTIVE' AND (${Prisma.join(perMetric, ' OR ')})
    ORDER BY c."lastSeenAt" ASC
    LIMIT ${MAX_NO_NEW_READING_PER_RUN}
  `
}

/** REAL pelo perfil calibrado; DEMO pelo v2, que o roteiro de aceite mostra. */
function profileFor(origin: TelemetryOrigin): AlertProfile {
  return origin === 'REAL' ? CALIBRATED_ALERT_PROFILE : EXPERIMENTAL_ALERT_PROFILE
}

function changeOf(
  workerId: string,
  conditionId: string,
  kind: TelemetryConditionKind,
  change: ConditionChange['change'],
  now: Date,
): ConditionChange {
  return { workerId, conditionId, kind, change, at: now.toISOString() }
}
