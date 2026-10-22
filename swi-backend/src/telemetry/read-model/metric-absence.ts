import type { Prisma } from '@prisma/client'
import { activePathsOf, READINESS_SELECT, readinessReportOf, type ActivePath } from '../devices/readiness'
import { HOUR } from '../domain/metric-state'
import type { DeviceKind, MetricState } from '../domain/telemetry.types'

// Ausência por métrica: quando uma métrica não tem valor, qual ausência é. O
// backend decide para app e painel dizerem a mesma coisa (glossário,
// Aguardando e Não envia). "Falhou" não mora aqui: só o app sabe da última
// tentativa, e ele sobrepõe esta resposta enquanto durar.
//
// Funções puras, sem banco: a consulta lê o celular, e a projeção aplica.

/** As métricas que dizem a ausência. Energia vale para o acumulado e para a taxa. */
export const ABSENCE_METRICS = ['heartRate', 'steps', 'activeEnergy', 'oxygenSaturation', 'bloodPressure'] as const

export type AbsenceMetric = (typeof ABSENCE_METRICS)[number]

/**
 * `AWAITING`: há caminho ativo e é normal ainda não ter chegado.
 * `NOT_SENT`: a pulseira comprovadamente não entrega esta métrica.
 */
export type MetricAbsence = 'AWAITING' | 'NOT_SENT'

/** A métrica com a ausência dela: nula quando há valor, sem caminho ativo ou fora do Android. */
export type WithAbsence<S extends MetricState<unknown>> = S & { ausencia: MetricAbsence | null }

/** Prazo da primeira sincronização com métrica até uma métrica que nunca chegou virar "não envia". */
export const NOT_SENT_AFTER_MS = 24 * HOUR

/** Os fatos do celular que a regra lê. */
export interface AbsenceFacts {
  deviceKind: DeviceKind
  activePaths: readonly ActivePath[]
  /** ISO-8601 de quando o backend recebeu a primeira amostra de cada métrica; nulo se nunca. */
  firstReceivedAt: Readonly<Record<AbsenceMetric, string | null>>
}

/** As colunas do celular que a regra lê, para o select de quem consulta. */
export const ABSENCE_DEVICE_SELECT = {
  kind: true,
  ...READINESS_SELECT,
  heartRateFirstReceivedAt: true,
  stepsFirstReceivedAt: true,
  activeEnergyFirstReceivedAt: true,
  oxygenSaturationFirstReceivedAt: true,
  bloodPressureFirstReceivedAt: true,
} as const satisfies Prisma.TelemetryDeviceSelect

export type AbsenceDeviceRow = Prisma.TelemetryDeviceGetPayload<{ select: typeof ABSENCE_DEVICE_SELECT }>

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())

/**
 * Os fatos do celular ativo do funcionário, ou nulo sem celular. O caminho
 * ativo sai do relato de prontidão, que só o Android manda.
 */
export function absenceFactsOf(device: AbsenceDeviceRow | null): AbsenceFacts | null {
  if (device === null) return null
  const android = device.kind === 'ANDROID_PHONE'
  return {
    deviceKind: device.kind,
    activePaths: android ? activePathsOf(readinessReportOf(device)) : [],
    firstReceivedAt: {
      heartRate: iso(device.heartRateFirstReceivedAt),
      steps: iso(device.stepsFirstReceivedAt),
      activeEnergy: iso(device.activeEnergyFirstReceivedAt),
      oxygenSaturation: iso(device.oxygenSaturationFirstReceivedAt),
      bloodPressure: iso(device.bloodPressureFirstReceivedAt),
    },
  }
}

/**
 * A ausência de uma métrica sem valor. Nula fora do Android (no iPhone vale
 * "Indisponível", que o app decide) e sem caminho ativo, mesmo que a regra do
 * "não envia" fosse valer: sem caminho, nada está sendo coletado.
 *
 * "Não envia" quando a primeira sincronização que trouxe alguma métrica foi há
 * 24 h ou mais e nenhuma amostra desta chegou desde então. Métrica que chegou
 * uma vez nunca mais é "não envia": se ela some, é "aguardando".
 */
export function absenceOf(facts: AbsenceFacts | null, metric: AbsenceMetric, now: Date): MetricAbsence | null {
  if (facts === null || facts.deviceKind !== 'ANDROID_PHONE' || facts.activePaths.length === 0) return null
  if (facts.firstReceivedAt[metric] !== null) return 'AWAITING'
  const firstSync = Math.min(
    ...Object.values(facts.firstReceivedAt)
      .filter((at): at is string => at !== null)
      .map((at) => new Date(at).getTime()),
  )
  // Sem nenhuma, o mínimo é infinito e a conta nunca fecha 24 h.
  return now.getTime() - firstSync >= NOT_SENT_AFTER_MS ? 'NOT_SENT' : 'AWAITING'
}

/** O estado da métrica com a ausência: só a métrica sem valor tem uma. */
export function withAbsence<S extends MetricState<unknown>>(
  state: S,
  facts: AbsenceFacts | null,
  metric: AbsenceMetric,
  now: Date,
): WithAbsence<S> {
  return { ...state, ausencia: state.value === null ? absenceOf(facts, metric, now) : null }
}
