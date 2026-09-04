import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { assertOriginCompatible, isBacklog } from '../domain/metric-state'
import type { MeasurementSource, TelemetryEvent, TelemetryOrigin } from '../domain/telemetry.types'
import {
  TelemetryIntegrityConflictError,
  TelemetrySessionNotFoundError,
  type OpenSessionInput,
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

export function canonicalPayloadHash(event: TelemetryEvent): string {
  return hashCanonical(canonicalContent(event))
}

interface NormalizedMeasurements {
  heartRateBpm: number | null
  stepDelta: number | null
  activeEnergyKcal: number | null
  motionCount: number | null
  batteryPercent: number | null
  systolicMmHg: number | null
  diastolicMmHg: number | null
  bloodPressureSource: MeasurementSource | null
}

/** Achata as medições em colunas. Métrica ausente vira null, nunca zero. */
function normalize(event: TelemetryEvent): NormalizedMeasurements {
  const m = event.measurements
  return {
    heartRateBpm: m.heartRate?.value ?? null,
    stepDelta: m.stepDelta?.value ?? null,
    activeEnergyKcal: m.activeEnergyKcal?.value ?? null,
    motionCount: m.motionCount?.value ?? null,
    batteryPercent: m.battery?.value ?? null,
    systolicMmHg: m.bloodPressure?.value.systolic ?? null,
    diastolicMmHg: m.bloodPressure?.value.diastolic ?? null,
    bloodPressureSource: m.bloodPressure?.source ?? null,
  }
}

/**
 * Campos do snapshot que este evento tem autoridade para mudar. Só entram as
 * métricas que ele realmente carrega: um evento de bateria não pode apagar o
 * BPM que veio no evento anterior.
 *
 * Passos, energia acumulada e MPM ficam de fora porque são acumulado e derivada
 * do dia monitorado, e quem os calcula é a projeção do read model.
 */
interface SnapshotPatch {
  sessionId: string
  origin: TelemetryOrigin
  lastEventId: string
  lastEventTime: Date
  heartRateBpm?: number
  heartRateAt?: Date
  batteryPercent?: number
  batteryAt?: Date
  systolicMmHg?: number
  diastolicMmHg?: number
  bloodPressureSource?: MeasurementSource
  bloodPressureAt?: Date
}

function buildSnapshotPatch(
  event: TelemetryEvent,
  measured: NormalizedMeasurements,
  eventTime: Date,
): SnapshotPatch {
  const patch: SnapshotPatch = {
    sessionId: event.monitoringSessionId,
    origin: event.origin,
    lastEventId: event.eventId,
    lastEventTime: eventTime,
  }
  if (measured.heartRateBpm !== null) {
    patch.heartRateBpm = measured.heartRateBpm
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
  return patch
}

/** Todas as métricas do snapshot em branco, para quando a origem muda. */
const CLEARED_METRICS: Prisma.TelemetrySnapshotUncheckedUpdateInput = {
  heartRateBpm: null,
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

  async saveEvent(event: TelemetryEvent, now: Date): Promise<SaveEventResult> {
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
    // Backlog e histórico entram na trilha sem tocar no estado atual: um evento
    // de duas horas atrás não é "o que está acontecendo agora".
    const live = !isBacklog(event.eventTime, now)

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

        const snapshotPromoted = live
          ? await promote(tx, session.workerId, buildSnapshotPatch(event, measured, eventTime))
          : false

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
