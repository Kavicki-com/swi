import { randomUUID } from 'node:crypto'
import type { OperationalAlertStatus, TelemetryConditionKind, TelemetryOrigin } from '@prisma/client'
import { PrismaService } from '../src/prisma/prisma.service'
import {
  RETIRED_PRESSURE_REVIEW_NOTE,
  retireBloodPressureReview,
} from '../src/telemetry/calibration/retire-blood-pressure-review'

// E2E porque o que se prova é o motivo novo do enum gravado de verdade (a
// migration o cria, e só fora da transação dela ele pode ser usado) e o
// recorte: só a revisão de pressão REAL ativa fecha, e o alerta dela junto.
// As afirmações são sobre as linhas deste spec, nunca sobre o total do banco.
describe('Telemetry retire blood pressure review e2e', () => {
  let prisma: PrismaService

  const tag = randomUUID()
  const emailPrefix = `retire-pressure-${tag}-`
  const SEEN = new Date('2026-10-20T15:00:00.000Z')
  const NOW = new Date('2026-10-23T12:00:00.000Z')
  const ids: Record<string, string> = {}

  // Um funcionário por caso: o índice único parcial só deixa uma condição
  // ativa por funcionário, tipo e origem.
  const condition = async (
    name: string,
    kind: TelemetryConditionKind,
    origin: TelemetryOrigin,
    status: 'ACTIVE' | 'RECOVERED',
    alertStatus: OperationalAlertStatus | null,
  ) => {
    const workerId = (
      await prisma.user.create({
        data: {
          email: `${emailPrefix}${name}@ex.com`,
          name: 'Retire Pressure',
          passwordHash: 'nao-usado-neste-spec',
          role: 'WORKER',
          emailVerified: true,
          approvalStatus: 'APPROVED',
        },
      })
    ).id
    const row = await prisma.telemetryCondition.create({
      data: {
        workerId,
        origin,
        kind,
        status,
        firstSeenAt: SEEN,
        lastSeenAt: SEEN,
        thresholdProfile: 'swi-alert-experimental-2',
        ...(status === 'RECOVERED' ? { recoveredAt: SEEN, recoveryReason: 'NORMALIZED' as const } : {}),
      },
    })
    if (alertStatus !== null) {
      await prisma.operationalAlert.create({ data: { conditionId: row.id, workerId, origin, status: alertStatus } })
    }
    return row.id
  }

  const stateOf = async (id: string) => {
    const row = await prisma.telemetryCondition.findUniqueOrThrow({ where: { id }, include: { alert: true } })
    return {
      status: row.status,
      recoveryReason: row.recoveryReason,
      recoveredAt: row.recoveredAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt.toISOString(),
      alertStatus: row.alert?.status ?? null,
      alertNote: row.alert?.resolutionNote ?? null,
    }
  }

  const retired = {
    status: 'RECOVERED',
    recoveryReason: 'PROFILE_RETIRED',
    recoveredAt: NOW.toISOString(),
    lastSeenAt: SEEN.toISOString(),
    alertStatus: 'RESOLVED',
    alertNote: RETIRED_PRESSURE_REVIEW_NOTE,
  }

  beforeAll(async () => {
    prisma = new PrismaService()
    await prisma.$connect()
    ids.open = await condition('open', 'BLOOD_PRESSURE_REVIEW', 'REAL', 'ACTIVE', 'OPEN')
    ids.acknowledged = await condition('ack', 'BLOOD_PRESSURE_REVIEW', 'REAL', 'ACTIVE', 'ACKNOWLEDGED')
    ids.noAlert = await condition('no-alert', 'BLOOD_PRESSURE_REVIEW', 'REAL', 'ACTIVE', null)
    ids.demo = await condition('demo', 'BLOOD_PRESSURE_REVIEW', 'DEMO', 'ACTIVE', 'OPEN')
    ids.recovered = await condition('recovered', 'BLOOD_PRESSURE_REVIEW', 'REAL', 'RECOVERED', 'RESOLVED')
    ids.heart = await condition('heart', 'HEART_RATE_HIGH', 'REAL', 'ACTIVE', 'OPEN')
  })

  afterAll(async () => {
    // Condição e alerta saem em cascata com o funcionário.
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await prisma.$disconnect()
  })

  it('fecha a revisão REAL ativa com o motivo novo e resolve o alerta aberto ou reconhecido', async () => {
    const result = await retireBloodPressureReview(prisma, NOW)

    expect(result.conditions).toBeGreaterThanOrEqual(3)
    expect(result.alerts).toBeGreaterThanOrEqual(2)
    expect(await stateOf(ids.open)).toEqual(retired)
    expect(await stateOf(ids.acknowledged)).toEqual(retired)
    expect(await stateOf(ids.noAlert)).toEqual({ ...retired, alertStatus: null, alertNote: null })
    // DEMO segue o perfil v2; a já recuperada e a de batimento não são da regra.
    expect(await stateOf(ids.demo)).toMatchObject({ status: 'ACTIVE', alertStatus: 'OPEN' })
    expect(await stateOf(ids.recovered)).toMatchObject({ recoveryReason: 'NORMALIZED', recoveredAt: SEEN.toISOString(), alertNote: null })
    expect(await stateOf(ids.heart)).toMatchObject({ status: 'ACTIVE', alertStatus: 'OPEN' })
  })

  it('rodar de novo não mexe no que já fechou', async () => {
    await retireBloodPressureReview(prisma, new Date(NOW.getTime() + 60 * 60 * 1000))
    expect(await stateOf(ids.open)).toEqual(retired)
    expect(await stateOf(ids.acknowledged)).toEqual(retired)
  })
})
