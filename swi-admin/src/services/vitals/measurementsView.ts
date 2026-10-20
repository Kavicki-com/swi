// O que a faixa "Medições do relógio" do detalhe mostra, decidido a partir da
// leitura do backend. Função pura, no molde do vitalsView: ausência continua
// ausência (null), para a tela escrever NO_VALUE em vez de inventar um zero, e
// zero medido continua zero.
import type { IconName } from '@kavicki/swi-design-system'
import type { HeartRateReference, MetricState, WorkerTelemetry } from '@/services/api/telemetry'
import { pluralize } from '@/lib/pluralize'
import { whenLabel } from '@/lib/whenLabel'
import {
  CHECKING_DEVICE_LABEL,
  DEMO_DATA_LABEL,
  NO_DEVICE_LABEL,
  NO_READING_LABEL,
  PROVISIONAL_BASELINE_LABEL,
  READING_UNAVAILABLE_LABEL,
  type ReadingOptions,
} from './vitalsView'

export type MeasurementKey =
  | 'oxygen'
  | 'temperature'
  | 'steps'
  | 'distance'
  | 'movement'
  | 'resting'
  | 'max'

export type MeasurementEntry = {
  key: MeasurementKey
  label: string
  icon: IconName
  /** Valor já formatado com unidade, ou null sem leitura (a tela escreve NO_VALUE). */
  value: string | null
  /** Linha abaixo do card, ou null. */
  caption: string | null
}

export type WorkerMeasurementsView =
  | { kind: 'empty'; message: string }
  | {
      kind: 'entries'
      entries: MeasurementEntry[]
      /** Selo de origem: só a leitura de demonstração é declarada, ou null. */
      sourceBadge: string | null
    }

const TODAY = 'Hoje'

// Milhar em pt-BR, como no resto do painel ("4.230").
const integer = (n: number) => Math.round(n).toLocaleString('pt-BR')

const formatOneDecimal = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// "Última medição às 14:32", ou "em 03/10 às 14:32" fora do dia: uma medição
// pontual de ontem não pode parecer de agora.
function lastAt(prefix: string, measuredAt: string | null, now: number): string | null {
  if (measuredAt === null) return null
  const when = whenLabel(measuredAt, now)
  return when === null ? null : `${prefix} ${when}`
}

type Reading = Pick<MeasurementEntry, 'value' | 'caption'>

const NOTHING: Reading = { value: null, caption: null }

/** Medição pontual (oxigenação, temperatura): valor e quando foi medida. */
function spot(state: MetricState<number>, format: (n: number) => string, now: number): Reading {
  if (state.value === null) return NOTHING
  return { value: format(state.value), caption: lastAt('Última medição', state.measuredAt, now) }
}

/** Acumulado do dia monitorado (passos, distância). */
function daily(state: MetricState<number>, format: (n: number) => string): Reading {
  return state.value === null ? NOTHING : { value: format(state.value), caption: TODAY }
}

// Sem taxa na janela recente, o horário da última amostra ainda diz quando o
// relógio mandou movimento pela última vez.
function movement(state: MetricState<number>, now: number): Reading {
  if (state.value !== null) return { value: `${integer(state.value)}/min`, caption: null }
  return { value: null, caption: lastAt('Última amostra', state.measuredAt, now) }
}

function restingHeartRate(ref: HeartRateReference | null): Reading {
  if (ref === null) return NOTHING
  const caption =
    ref.restingSource === 'PROVISIONAL'
      ? PROVISIONAL_BASELINE_LABEL
      : `Medido em ${ref.measuredDays} ${pluralize(ref.measuredDays, 'dia', 'dias')}`
  return { value: `${integer(ref.restingBpm)} bpm`, caption }
}

// A máxima sai da idade; sem data de nascimento não há máxima, e a legenda
// diz o porquê em vez de deixar o card mudo.
function maxHeartRate(ref: HeartRateReference | null): Reading {
  if (ref === null) return NOTHING
  if (ref.maxBpm === null) return { value: null, caption: 'Sem data de nascimento' }
  return { value: `${integer(ref.maxBpm)} bpm`, caption: 'Estimada pela idade' }
}

export function measurementsViewFrom(
  telemetry: WorkerTelemetry | null,
  options: ReadingOptions = {},
): WorkerMeasurementsView {
  // As mesmas frases e a mesma ordem de decisão do vitalsViewFrom: sem relógio
  // pareado a leitura guardada não vale, e sem saber se há relógio ela espera.
  if (options.noDevice) return { kind: 'empty', message: NO_DEVICE_LABEL }
  if (options.deviceUnknown) {
    return {
      kind: 'empty',
      message: options.failed ? READING_UNAVAILABLE_LABEL : CHECKING_DEVICE_LABEL,
    }
  }
  if (telemetry === null || telemetry.origin === null) {
    return {
      kind: 'empty',
      message: options.failed ? READING_UNAVAILABLE_LABEL : NO_READING_LABEL,
    }
  }

  const now = options.now ?? Date.now()
  const { oxygenSaturation, bodyTemperature, steps, distance, movementPerMinute } =
    telemetry.metrics
  const ref = telemetry.heartRateReference ?? null

  const entry = (
    key: MeasurementKey,
    label: string,
    icon: IconName,
    reading: Reading,
  ): MeasurementEntry => ({ key, label, icon, ...reading })

  return {
    kind: 'entries',
    entries: [
      entry(
        'oxygen',
        'Oxigenação',
        'water_drop',
        spot(oxygenSaturation, (n) => `${integer(n)}%`, now),
      ),
      entry(
        'temperature',
        'Temperatura',
        'device_thermostat',
        spot(bodyTemperature, (n) => `${formatOneDecimal(n)} °C`, now),
      ),
      entry('steps', 'Passos', 'footprint', daily(steps, integer)),
      // Metros do dia em km com uma casa, também abaixo de 1 km ("0,4 km").
      entry(
        'distance',
        'Distância',
        'directions_walk',
        daily(distance, (m) => `${formatOneDecimal(m / 1000)} km`),
      ),
      entry('movement', 'Movimento', 'health_activity', movement(movementPerMinute, now)),
      entry('resting', 'Repouso', 'favorite', restingHeartRate(ref)),
      entry('max', 'Máxima', 'heartbeat', maxHeartRate(ref)),
    ],
    // Só a demonstração ganha selo. O sourceBadgeOf também marca o repouso
    // provisório, mas isso é do esforço e do desgaste; aqui a legenda do
    // repouso já diz "Estimativa provisória".
    sourceBadge: telemetry.origin === 'DEMO' ? DEMO_DATA_LABEL : null,
  }
}
