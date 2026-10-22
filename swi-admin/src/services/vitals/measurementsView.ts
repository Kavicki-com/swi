// O que a faixa "Medições do aparelho" do detalhe mostra, decidido a partir da
// leitura do backend. Função pura, no molde do vitalsView: ausência continua
// ausência (null), para a tela escrever NO_VALUE em vez de inventar um zero, e
// zero medido continua zero.
import type { IconName } from '@kavicki/swi-design-system'
import type { HeartRateReference, MetricState, WorkerTelemetry } from '@/services/api/telemetry'
import { pluralize } from '@/lib/pluralize'
import { whenLabel } from '@/lib/whenLabel'
import { absenceLabelOf } from './absenceLabel'
import {
  CHECKING_DEVICE_LABEL,
  DEMO_DATA_LABEL,
  NO_DEVICE_LABEL,
  NO_READING_LABEL,
  PROVISIONAL_BASELINE_LABEL,
  READING_UNAVAILABLE_LABEL,
  type ReadingOptions,
} from './vitalsView'
import {
  calibrationLineOf,
  EMPTY_LINE,
  type CalibrationLine,
  type ZoneTag,
} from './calibrationView'

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
  /** Título acima da rosca. */
  label: string
  /** Rótulo dentro da rosca, abaixo do valor. */
  centerLabel: string
  icon: IconName
  /** Valor já formatado com unidade, ou null sem leitura (a tela escreve NO_VALUE). */
  value: string | null
  /** Linha abaixo da rosca, ou null. */
  caption: string | null
  /** Arco da rosca, de 0 a 100. */
  progress: number
  /** Zona de agora na faixa da pessoa, ou null (sem calibração, total do dia). */
  zone: ZoneTag | null
  /** Faixa da pessoa em frase, ou null sem calibração. */
  limits: string | null
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

const FULL_RING = 100

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

// Sem valor, a ausência decidida pelo backend ("Aguardando medição", "Esta
// pulseira não envia oxigenação") vira a legenda; a rosca continua na tela.
const orAbsence = (reading: Reading, absence: string | null): Reading =>
  reading.value === null && absence !== null ? { ...reading, caption: absence } : reading

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
  // As mesmas frases e a mesma ordem de decisão do vitalsViewFrom: sem aparelho
  // pareado a leitura guardada não vale, e sem saber se há aparelho ela espera.
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
  const cal = telemetry.calibration

  // Só a oxigenação tem escala própria (já é porcentagem). As outras não têm
  // meta que valha para todos, então o anel não inventa uma: cheio quando há
  // leitura, vazio sem ela.
  const entry = (
    key: MeasurementKey,
    label: string,
    centerLabel: string,
    icon: IconName,
    reading: Reading,
    line: CalibrationLine,
    progress = reading.value === null ? 0 : FULL_RING,
  ): MeasurementEntry => ({ key, label, centerLabel, icon, ...reading, progress, ...line })

  return {
    kind: 'entries',
    entries: [
      entry(
        'oxygen',
        'Oxigenação',
        'Saturação',
        'water_drop',
        orAbsence(
          spot(oxygenSaturation, (n) => `${integer(n)}%`, now),
          absenceLabelOf('oxygen', oxygenSaturation),
        ),
        calibrationLineOf(cal, 'OXYGEN_SATURATION'),
        oxygenSaturation.value === null
          ? 0
          : Math.min(FULL_RING, Math.max(0, oxygenSaturation.value)),
      ),
      entry(
        'temperature',
        'Temperatura',
        'Corporal',
        'device_thermostat',
        spot(bodyTemperature, (n) => `${formatOneDecimal(n)} °C`, now),
        calibrationLineOf(cal, 'BODY_TEMPERATURE'),
      ),
      // Totais do dia: o dia ainda corre, então só a faixa habitual, sem zona.
      entry(
        'steps',
        'Passos',
        'Passos dados',
        'footprint',
        orAbsence(daily(steps, integer), absenceLabelOf('steps', steps)),
        calibrationLineOf(cal, 'STEPS', { withZone: false }),
      ),
      // Metros do dia em km com uma casa, também abaixo de 1 km ("0,4 km").
      entry(
        'distance',
        'Distância',
        'Percorrida',
        'directions_walk',
        daily(distance, (m) => `${formatOneDecimal(m / 1000)} km`),
        calibrationLineOf(cal, 'DISTANCE', { withZone: false }),
      ),
      entry(
        'movement',
        'Movimento',
        'Ritmo atual',
        'health_activity',
        movement(movementPerMinute, now),
        // Ritmo de agora: leva a zona ao vivo.
        calibrationLineOf(cal, 'MOVEMENT'),
      ),
      entry('resting', 'Repouso', 'Batimento', 'favorite', restingHeartRate(ref), EMPTY_LINE),
      entry('max', 'Máxima', 'Batimento', 'heartbeat', maxHeartRate(ref), EMPTY_LINE),
    ],
    // Só a demonstração ganha selo. O sourceBadgeOf também marca o atraso da
    // pulseira e o repouso provisório. O atraso fica de fora de propósito: o
    // card de sinais vitais logo acima já o mostra. O provisório é do esforço e
    // do desgaste; aqui a legenda do repouso já diz "Estimativa provisória".
    sourceBadge: telemetry.origin === 'DEMO' ? DEMO_DATA_LABEL : null,
  }
}
