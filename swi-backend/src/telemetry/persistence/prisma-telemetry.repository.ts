import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  assertOriginCompatible,
  classifyEventAge,
  isBacklog,
  isSpotReadingEvent,
  snapshotPolicyFor,
} from '../domain/metric-state'
import type { DeviceKind, MeasurementSource, TelemetryEvent, TelemetryOrigin } from '../domain/telemetry.types'
import {
  TelemetryIntegrityConflictError,
  TelemetrySessionNotFoundError,
  type OpenSessionInput,
  type SaveEventOptions,
  type SaveEventResult,
  type TelemetryRepository,
  type TelemetrySessionRef,
} from './telemetry.repository'

type CanonicalContent = Record<string, unknown>

/**
 * Conteúdo do evento que define a identidade dele. receivedAt fica de fora de
 * propósito: é carimbo do servidor e muda a cada reenvio, então incluí-lo
 * transformaria toda repetição legítima em conflito. eventTime é normalizado
 * pelo mesmo motivo: "…50Z" e "…50.000Z" são o mesmo instante, e o hash não
 * pode depender de como o cliente formatou a string.
 */
function canonicalContent(event: TelemetryEvent): CanonicalContent {
  return {
    eventId: event.eventId,
    deviceId: event.deviceId,
    monitoringSessionId: event.monitoringSessionId,
    sequence: event.sequence,
    eventTime: new Date(event.eventTime).toISOString(),
    origin: event.origin,
    measurements: event.measurements,
    journeyId: event.journeyId ?? null,
    taskId: event.taskId ?? null,
  }
}

/** Ordena chaves em profundidade: dois objetos iguais precisam gerar o mesmo texto. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        if (source[key] !== undefined) acc[key] = canonicalize(source[key])
        return acc
      }, {})
  }
  return value
}

function hashCanonical(content: CanonicalContent): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(content))).digest('hex')
}

interface NormalizedMeasurements {
  heartRateBpm: number | null
  heartRateSource: MeasurementSource | null
  stepDelta: number | null
  activeEnergyKcal: number | null
  motionCount: number | null
  batteryPercent: number | null
  systolicMmHg: number | null
  diastolicMmHg: number | null
  bloodPressureSource: MeasurementSource | null
  distanceDeltaM: number | null
  oxygenSaturationPct: number | null
  bodyTemperatureC: number | null
  bodyTemperatureSource: MeasurementSource | null
}

/** Achata as medições em colunas. Métrica ausente vira null, nunca zero. */
function normalize(event: TelemetryEvent): NormalizedMeasurements {
  const m = event.measurements
  return {
    heartRateBpm: m.heartRate?.value ?? null,
    heartRateSource: m.heartRate?.source ?? null,
    stepDelta: m.stepDelta?.value ?? null,
    activeEnergyKcal: m.activeEnergyKcal?.value ?? null,
    motionCount: m.motionCount?.value ?? null,
    batteryPercent: m.battery?.value ?? null,
    systolicMmHg: m.bloodPressure?.value.systolic ?? null,
    diastolicMmHg: m.bloodPressure?.value.diastolic ?? null,
    bloodPressureSource: m.bloodPressure?.source ?? null,
    distanceDeltaM: m.distanceDeltaM?.value ?? null,
    oxygenSaturationPct: m.oxygenSaturation?.value ?? null,
    bodyTemperatureC: m.bodyTemperature?.value ?? null,
    bodyTemperatureSource: m.bodyTemperature?.source ?? null,
  }
}

/**
 * Campos do snapshot que este evento tem autoridade para mudar. Só entram as
 * métricas que ele realmente carrega: um evento de bateria não pode apagar o
 * BPM que veio no evento anterior.
 *
 * Passos, distância, energia acumulada e MPM ficam de fora porque são acumulado
 * e derivada do dia monitorado, e quem os calcula é a projeção do read model.
 */
interface SnapshotPatch {
  sessionId: string
  origin: TelemetryOrigin
  lastEventId: string
  lastEventTime: Date
  /** Sempre no patch: é o que diz ao read model se o atual é de pulseira. */
  deviceKind: DeviceKind | null
  lastReceivedAt: Date
  /** Só na promoção ao vivo: é por ele que a varredura de silêncio mede. */
  lastLiveEventTime?: Date
  heartRateBpm?: number
  heartRateAt?: Date
  /** Vai sempre junto do batimento, nulo inclusive: fonte velha com valor novo mentiria. */
  heartRateSource?: MeasurementSource | null
  batteryPercent?: number
  batteryAt?: Date
  systolicMmHg?: number
  diastolicMmHg?: number
  bloodPressureSource?: MeasurementSource
  bloodPressureAt?: Date
  oxygenSaturationPct?: number
  oxygenSaturationAt?: Date
  bodyTemperatureC?: number
  bodyTemperatureSource?: MeasurementSource
  bodyTemperatureAt?: Date
}

function buildSnapshotPatch(
  event: TelemetryEvent,
  measured: NormalizedMeasurements,
  eventTime: Date,
  deviceKind: DeviceKind | null,
): SnapshotPatch {
  const patch: SnapshotPatch = {
    sessionId: event.monitoringSessionId,
    origin: event.origin,
    lastEventId: event.eventId,
    lastEventTime: eventTime,
    deviceKind,
    lastReceivedAt: new Date(event.receivedAt),
  }
  if (measured.heartRateBpm !== null) {
    patch.heartRateBpm = measured.heartRateBpm
    patch.heartRateSource = measured.heartRateSource
    patch.heartRateAt = eventTime
  }
  if (measured.batteryPercent !== null) {
    patch.batteryPercent = measured.batteryPercent
    patch.batteryAt = eventTime
  }
  if (measured.systolicMmHg !== null && measured.diastolicMmHg !== null) {
    patch.systolicMmHg = measured.systolicMmHg
    patch.diastolicMmHg = measured.diastolicMmHg
    patch.bloodPressureSource = measured.bloodPressureSource ?? undefined
    patch.bloodPressureAt = eventTime
  }
  if (measured.oxygenSaturationPct !== null) {
    patch.oxygenSaturationPct = measured.oxygenSaturationPct
    patch.oxygenSaturationAt = eventTime
  }
  if (measured.bodyTemperatureC !== null) {
    patch.bodyTemperatureC = measured.bodyTemperatureC
    patch.bodyTemperatureSource = measured.bodyTemperatureSource ?? undefined
    patch.bodyTemperatureAt = eventTime
  }
  return patch
}

/** Todas as métricas do snapshot em branco, para quando a origem muda. */
const CLEARED_METRICS: Prisma.TelemetrySnapshotUncheckedUpdateInput = {
  lastLiveEventTime: null,
  heartRateBpm: null,
  heartRateSource: null,
  heartRateAt: null,
  stepsTotal: null,
  stepsAt: null,
  activeEnergyKcal: null,
  activeEnergyAt: null,
  movementPerMinute: null,
  movementAt: null,
  batteryPercent: null,
  batteryAt: null,
  systolicMmHg: null,
  diastolicMmHg: null,
  bloodPressureSource: null,
  bloodPressureAt: null,
  oxygenSaturationPct: null,
  oxygenSaturationAt: null,
  bodyTemperatureC: null,
  bodyTemperatureSource: null,
  bodyTemperatureAt: null,
}

/** Só o que a ingestão precisa saber da sessão para decidir se aceita o evento. */
const SESSION_REF = { id: true, deviceId: true, workerId: true, origin: true } as const

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function resolveKnown(
  known: { id: string; payloadHash: string },
  event: TelemetryEvent,
  payloadHash: string,
): SaveEventResult {
  if (known.payloadHash !== payloadHash) {
    throw new TelemetryIntegrityConflictError(
      'eventId',
      event.eventId,
      'mesmo identificador com conteúdo diferente',
    )
  }
  return { outcome: 'DUPLICATE', sampleId: known.id, snapshotPromoted: false }
}

/**
 * Promove o snapshot só se este evento for mais recente do que o já promovido
 * da mesma origem. A fila do relógio entrega fora de ordem depois de uma
 * reconexão, e sem esta comparação o evento atrasado apagaria a leitura nova.
 *
 * Origem diferente descarta o snapshot anterior inteiro: manter o BPM da
 * demonstração ao lado da bateria real seria exatamente a mistura que a decisão
 * congelada proíbe, e a ordem da demonstração não vale contra o real.
 */
async function promote(
  tx: Prisma.TransactionClient,
  workerId: string,
  patch: SnapshotPatch,
): Promise<boolean> {
  const current = await tx.telemetrySnapshot.findUnique({ where: { workerId } })
  const sameOrigin = current !== null && current.origin === patch.origin
  if (sameOrigin && current.lastEventTime > patch.lastEventTime) return false

  await tx.telemetrySnapshot.upsert({
    where: { workerId },
    create: { workerId, ...patch },
    update: sameOrigin ? patch : { ...CLEARED_METRICS, ...patch },
  })
  return true
}

/** Cada métrica do snapshot com o horário que decide se ela é a mais nova. */
const METRIC_STAMPS = [
  { at: 'heartRateAt', fields: ['heartRateBpm', 'heartRateSource'] },
  { at: 'batteryAt', fields: ['batteryPercent'] },
  { at: 'bloodPressureAt', fields: ['systolicMmHg', 'diastolicMmHg', 'bloodPressureSource'] },
  { at: 'oxygenSaturationAt', fields: ['oxygenSaturationPct'] },
  { at: 'bodyTemperatureAt', fields: ['bodyTemperatureC', 'bodyTemperatureSource'] },
] as const satisfies readonly { at: keyof SnapshotPatch; fields: readonly (keyof SnapshotPatch)[] }[]

/**
 * Promoção da pulseira. Cada evento dela traz uma medição só, com horários
 * espalhados pelo lote, e comparar o snapshot inteiro descartaria a
 * oxigenação das 13:00 que chega depois do batimento das 14:10, para sempre.
 *
 * Então cada métrica decide sozinha, contra o próprio horário gravado, como na
 * medição avulsa; sessão, último evento e horário dele só andam para a frente.
 * Tipo do aparelho e carimbo de recebimento vão sempre. Origem diferente
 * descarta tudo, pelo mesmo motivo de `promote`.
 *
 * As comparações vão no WHERE da própria escrita, como em `promoteSpotReading`.
 */
async function promoteByMetric(
  tx: Prisma.TransactionClient,
  workerId: string,
  patch: SnapshotPatch,
): Promise<boolean> {
  const current = await tx.telemetrySnapshot.findUnique({ where: { workerId }, select: { origin: true } })
  if (current === null || current.origin !== patch.origin) {
    await tx.telemetrySnapshot.upsert({
      where: { workerId },
      create: { workerId, ...patch },
      update: { ...CLEARED_METRICS, ...patch },
    })
    return true
  }

  const { origin } = patch
  const eventTime = patch.lastEventTime
  await tx.telemetrySnapshot.update({
    where: { workerId },
    data: { deviceKind: patch.deviceKind, lastReceivedAt: patch.lastReceivedAt },
  })
  // Snapshot sem sessão foi aberto por medição avulsa: o primeiro evento da
  // pulseira assume a linha, como o primeiro do relógio.
  const head = await tx.telemetrySnapshot.updateMany({
    where: { workerId, origin, OR: [{ sessionId: null }, { lastEventTime: { lte: eventTime } }] },
    data: { sessionId: patch.sessionId, lastEventId: patch.lastEventId, lastEventTime: eventTime },
  })
  let promoted = head.count > 0

  for (const { at, fields } of METRIC_STAMPS) {
    if (patch[at] === undefined) continue
    const data: Prisma.TelemetrySnapshotUncheckedUpdateManyInput = { [at]: eventTime }
    for (const field of fields) Object.assign(data, { [field]: patch[field] })
    const { count } = await tx.telemetrySnapshot.updateMany({
      where: { workerId, origin, OR: [{ [at]: null }, { [at]: { lt: eventTime } }] },
      data,
    })
    if (count > 0) promoted = true
  }
  return promoted
}

/**
 * Promoção da medição avulsa: pressão e temperatura lidas do app Saúde, que
 * chegam pelo iPhone com o horário em que foram medidas.
 *
 * Cada medição decide sozinha, contra o próprio horário gravado: entra se o
 * snapshot não tem aquela medição ou tem uma mais antiga. A idade do evento não
 * conta, porque a régua dessas duas é de horas e o app só as lê quando abre.
 *
 * Sessão, último evento e horário do último evento ficam como estão. São eles
 * que dizem quando o relógio falou pela última vez, e a varredura de silêncio
 * mede por eles: uma pressão digitada no app Saúde não é o relógio falando.
 *
 * A comparação vai no WHERE da própria escrita, e não numa leitura anterior:
 * duas medições chegando juntas não podem deixar a mais antiga por cima.
 */
async function promoteSpotReading(
  tx: Prisma.TransactionClient,
  workerId: string,
  origin: TelemetryOrigin,
  measured: NormalizedMeasurements,
  eventTime: Date,
): Promise<boolean> {
  const current = await tx.telemetrySnapshot.findUnique({
    where: { workerId },
    select: { origin: true },
  })
  // Snapshot de outra origem não recebe a medição: misturar real e
  // demonstração é o que a decisão congelada proíbe, e uma medição avulsa não
  // tem autoridade para trocar a origem de quem falou por último.
  if (current !== null && current.origin !== origin) return false
  if (current === null) {
    // Sem sessão de propósito: quem nunca mandou sinal do relógio não tem sinal
    // a perder, e a varredura de silêncio só olha snapshot com sessão. O
    // primeiro evento ao vivo do relógio assume a linha pelo caminho normal.
    await tx.telemetrySnapshot.upsert({
      where: { workerId },
      create: { workerId, origin, lastEventTime: eventTime },
      update: {},
    })
  }

  let promoted = false
  if (measured.systolicMmHg !== null && measured.diastolicMmHg !== null) {
    const { count } = await tx.telemetrySnapshot.updateMany({
      where: {
        workerId,
        origin,
        OR: [{ bloodPressureAt: null }, { bloodPressureAt: { lt: eventTime } }],
      },
      data: {
        systolicMmHg: measured.systolicMmHg,
        diastolicMmHg: measured.diastolicMmHg,
        bloodPressureSource: measured.bloodPressureSource,
        bloodPressureAt: eventTime,
      },
    })
    if (count > 0) promoted = true
  }
  if (measured.bodyTemperatureC !== null) {
    const { count } = await tx.telemetrySnapshot.updateMany({
      where: {
        workerId,
        origin,
        OR: [{ bodyTemperatureAt: null }, { bodyTemperatureAt: { lt: eventTime } }],
      },
      data: {
        bodyTemperatureC: measured.bodyTemperatureC,
        bodyTemperatureSource: measured.bodyTemperatureSource,
        bodyTemperatureAt: eventTime,
      },
    })
    if (count > 0) promoted = true
  }
  return promoted
}

@Injectable()
export class PrismaTelemetryRepository implements TelemetryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSession(input: OpenSessionInput): Promise<TelemetrySessionRef> {
    const existing = await this.findSession(input.id)
    // Já aberta: devolve como está. Reabrir com os dados de quem chegou agora
    // deixaria um aparelho assumir a sessão de outro só por adivinhar o id.
    if (existing !== null) return existing

    try {
      return await this.prisma.telemetrySession.create({
        data: {
          id: input.id,
          deviceId: input.deviceId,
          workerId: input.workerId,
          origin: input.origin,
          startedAt: input.startedAt,
        },
        select: SESSION_REF,
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Dois eventos do mesmo lote chegando por conexões diferentes abrem a
      // corrida. Quem perde lê a linha que o outro acabou de gravar.
      const raced = await this.findSession(input.id)
      if (raced === null) throw error
      return raced
    }
  }

  private async findSession(id: string): Promise<TelemetrySessionRef | null> {
    return this.prisma.telemetrySession.findUnique({ where: { id }, select: SESSION_REF })
  }

  async saveEvent(event: TelemetryEvent, now: Date, options?: SaveEventOptions): Promise<SaveEventResult> {
    const session = await this.prisma.telemetrySession.findUnique({
      where: { id: event.monitoringSessionId },
    })
    if (session === null) throw new TelemetrySessionNotFoundError(event.monitoringSessionId)
    assertOriginCompatible(session.origin, event.origin)

    const content = canonicalContent(event)
    const payloadHash = hashCanonical(content)
    const known = await this.prisma.telemetrySample.findUnique({
      where: { eventId: event.eventId },
    })
    if (known !== null) return resolveKnown(known, event, payloadHash)

    const eventTime = new Date(event.eventTime)
    const measured = normalize(event)
    // Backlog e histórico do relógio entram na trilha sem tocar no estado
    // atual: um evento de duas horas atrás não é "o que está acontecendo agora".
    const live = !isBacklog(event.eventTime, now)
    // A pulseira lida pelo Health Connect só manda em lote: o mais recente dela
    // é o atual, em qualquer idade até o histórico, decidido métrica por métrica
    // em promoteByMetric. O relógio e o batimento da pulseira pelo Bluetooth são
    // só ao vivo, com o snapshot inteiro comparado em promote.
    const deviceKind = options?.deviceKind ?? null
    const latestWins = snapshotPolicyFor(deviceKind, event.measurements) === 'LATEST'
    const promotable = latestWins ? classifyEventAge(event.eventTime, now) !== 'HISTORICAL' : live
    // Medição avulsa do app Saúde tem promoção própria, em qualquer idade, e
    // nunca passa pela do relógio, nem quando acabou de ser medida.
    const spot = isSpotReadingEvent(event.measurements)

    try {
      // Amostra e promoção no mesmo commit: um snapshot promovido sem a amostra
      // que o justifica é um número sem trilha de auditoria.
      return await this.prisma.$transaction(async (tx) => {
        const sample = await tx.telemetrySample.create({
          data: {
            eventId: event.eventId,
            sessionId: session.id,
            // Do dispositivo da sessão, não do payload: o aparelho declara quem
            // ele é, mas quem responde por isso é a credencial do pareamento.
            deviceId: session.deviceId,
            workerId: session.workerId,
            origin: event.origin,
            sequence: event.sequence,
            eventTime,
            receivedAt: new Date(event.receivedAt),
            journeyId: event.journeyId ?? null,
            taskId: event.taskId ?? null,
            ...measured,
            payload: content as Prisma.InputJsonValue,
            payloadHash,
          },
        })

        let snapshotPromoted = false
        if (spot) {
          snapshotPromoted = await promoteSpotReading(
            tx,
            session.workerId,
            event.origin,
            measured,
            eventTime,
          )
        } else if (promotable) {
          const patch = buildSnapshotPatch(event, measured, eventTime, deviceKind)
          // Só a régua do ao vivo chega aqui sem ser lote, então só ela anda o
          // carimbo do sinal: relógio e batimento do Bluetooth.
          if (!latestWins) patch.lastLiveEventTime = eventTime
          const promoteSnapshot = latestWins ? promoteByMetric : promote
          snapshotPromoted = await promoteSnapshot(tx, session.workerId, patch)
        }

        return { outcome: 'STORED' as const, sampleId: sample.id, snapshotPromoted }
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Corrida com outro processo. Se o eventId já está gravado, o desempate é
      // o mesmo de sempre: conteúdo igual é repetição, diferente é conflito.
      const raced = await this.prisma.telemetrySample.findUnique({
        where: { eventId: event.eventId },
      })
      if (raced !== null) return resolveKnown(raced, event, payloadHash)
      throw new TelemetryIntegrityConflictError(
        'sequence',
        event.eventId,
        `sequência ${event.sequence} já usada nesta sessão por outro evento`,
      )
    }
  }
}
