// Leitura da telemetria do piloto pelo painel (telemetry/v1). Os tipos espelham
// o contrato do backend (domain/telemetry.types.ts, read-model e a fila de
// alertas): cada métrica chega com valor, qualidade, instante e origem, e
// ausência é null, nunca zero.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'
import { notifyAlertTriaged } from '@/services/alerts/alertTriage'

export type TelemetryOrigin = 'REAL' | 'DEMO'

export type MetricQuality = 'CURRENT' | 'STALE' | 'UNAVAILABLE'

export type MeasurementSource =
  | 'APPLE_WATCH'
  /** Pulseira lida pelo app Android via Health Connect. */
  | 'HEALTH_CONNECT'
  /** Batimento lido direto da pulseira pelo Bluetooth do celular Android, ao vivo. */
  | 'BLUETOOTH_HR'
  | 'EXTERNAL_CUFF'
  | 'MANUAL_HEALTHKIT'
  | 'MANUAL_SWI'
  | 'DERIVED'

export type MetricState<T> = {
  value: T | null
  quality: MetricQuality
  /** ISO-8601 da medição; null quando não há valor. */
  measuredAt: string | null
  source: MeasurementSource | null
  unit: string
}

/**
 * Por que a métrica está sem valor, decidido pelo backend: o caminho está
 * ativo e ela ainda não chegou (AWAITING), ou 24 h depois da primeira
 * sincronização ela nunca chegou (NOT_SENT).
 */
export type MetricAbsence = 'AWAITING' | 'NOT_SENT'

/**
 * Métrica que leva ausência. `ausencia` é nula com valor, sem caminho ativo e
 * no iPhone; opcional porque um backend anterior responde sem o campo, e aí
 * vale como nula.
 */
export type AbsentMetricState<T> = MetricState<T> & { ausencia?: MetricAbsence | null }

export type BloodPressure = { systolic: number; diastolic: number }

export type WorkerMetrics = {
  heartRate: AbsentMetricState<number>
  steps: AbsentMetricState<number>
  movementPerMinute: MetricState<number>
  activeEnergy: AbsentMetricState<number>
  energyRatePerHour: AbsentMetricState<number> & { calculating: boolean }
  battery: MetricState<number>
  bloodPressure: AbsentMetricState<BloodPressure>
  /** 0-100. */
  effort: MetricState<number>
  /** 0-100. */
  wear: MetricState<number>
  /** Acumulado do dia, em metros. */
  distance: MetricState<number>
  /** Medição pontual: "última medição às", nunca "atual". */
  oxygenSaturation: AbsentMetricState<number>
  /** Medição pontual vinda do app Saúde, em °C. */
  bodyTemperature: MetricState<number>
  /** Minutos até o alerta de desgaste no ritmo recente. */
  fatigueEtaMin: MetricState<number>
}

export type ConditionKind =
  | 'HEART_RATE_HIGH'
  | 'HEART_RATE_LOW'
  | 'BLOOD_PRESSURE_REVIEW'
  | 'DEVICE_BATTERY_LOW'
  | 'DEVICE_SIGNAL_LOST'
  /** Trava do desgaste (desgaste extremo). Urgente desde a calibração individual. */
  | 'WEAR_HIGH'
  /** Camada de Atenção da calibração individual: valor na faixa de fadiga da pessoa. */
  | 'HEART_RATE_FATIGUE'
  | 'OXYGEN_FATIGUE'
  | 'WEAR_FATIGUE'
  | 'BLOOD_PRESSURE_FATIGUE'
  /** Travas da calibração individual: o piso de proteção que não aprende. Urgentes. */
  | 'OXYGEN_LOW'
  | 'BLOOD_PRESSURE_HIGH'
  /**
   * Três ou mais episódios atrasados do mesmo tipo no mesmo dia monitorado.
   * Atenção, nasce encerrada e gera alerta; o tipo repetido vem em `episodeKind`.
   */
  | 'REPEATED_EPISODES'
  /**
   * Pedido de ajuda do botão "Ajuda urgente" do app. Urgente, nasce encerrada
   * (não é medição e nunca pinta o estado); o estado do pedido mora no alerta.
   */
  | 'HELP_REQUESTED'

/**
 * URGENT é batimento fora da faixa e as travas (oxigenação, pressão, desgaste
 * extremo); HEALTH pede atenção sem urgência (faixa de fadiga da pessoa,
 * revisar pressão); DEVICE é problema do aparelho, não risco da pessoa.
 */
export type ConditionCategory = 'URGENT' | 'HEALTH' | 'DEVICE'

/**
 * Por que uma condição fechou. NORMALIZED, o valor voltou; SIGNAL_LOST, o
 * aparelho ao vivo silenciou; SIGNAL_RESTORED, o aparelho voltou a falar e
 * fechou a perda de sinal; NO_NEW_READING, 24 h sem medição nova da métrica;
 * PROFILE_RETIRED, a regra que abriu saiu de cena com a calibração individual.
 */
export type ConditionRecoveryReason =
  | 'NORMALIZED'
  | 'SIGNAL_LOST'
  | 'SIGNAL_RESTORED'
  | 'NO_NEW_READING'
  | 'PROFILE_RETIRED'

export type ActiveCondition = {
  kind: ConditionKind
  category: ConditionCategory
  /** ISO-8601 de quando a condição abriu. */
  openedAt: string
  /**
   * ISO-8601 da medição mais recente da métrica que sustenta a condição: é
   * dele que se conta se a condição ainda pinta o estado. Nulo sem medição
   * legível dessa métrica; opcional porque um backend anterior responde sem.
   */
  measuredAt?: string | null
  /** O valor que abriu a condição, na unidade dela. */
  observedValue: number | null
  /** O limite em vigor quando abriu. */
  thresholdValue: number | null
}

export type WindowCoverage = {
  samples: number
  coveredMs: number
  windowStart: string | null
  windowEnd: string | null
}

export type WorkerTelemetry = {
  workerId: string
  /** Null enquanto o funcionário nunca reportou. */
  origin: TelemetryOrigin | null
  monitoringSessionId: string | null
  metrics: WorkerMetrics
  bloodPressureRecency: 'CURRENT' | 'HISTORICAL' | 'NONE'
  formulaVersion: string | null
  energyWindow: WindowCoverage
  movementWindow: WindowCoverage
  /** ISO-8601 do instante contra o qual a qualidade foi decidida. */
  observedAt: string
  /** Condições abertas da mesma origem da leitura, mais antiga primeiro. */
  conditions: ActiveCondition[]
  /**
   * De onde veio o repouso que deu esforço e desgaste: medido nos dias
   * fechados, ou provisório enquanto não há dia fechado. Opcional porque um
   * backend anterior responde sem o campo, e aí a tela não marca nada.
   */
  baseline?: BaselineSource | null
  /**
   * Repouso e máxima que a fórmula usou, da última avaliação. Opcional porque
   * um backend anterior responde sem o campo; nulo quando não há referência.
   */
  heartRateReference?: HeartRateReference | null
  /**
   * Só para celular Android: até quando o Health Connect tinha leituras
   * (measuredUntil) e quando o backend recebeu esse lote (syncedAt). Nulo para
   * iPhone e relógio, que mandam ao vivo, e para o Android antes do primeiro
   * lote. Opcional porque um backend anterior responde sem o campo.
   */
  sync?: TelemetrySync | null
  /**
   * Calibração individual: fase, dia e, por medição, a faixa em vigor com a
   * zona em que o valor atual cai. Só a leitura individual a carrega; ausente
   * nas listas. Sem linha gravada (e na demonstração) vem a partida padrão;
   * um backend anterior manda nula nesses casos.
   */
  calibration?: WorkerCalibration | null
}

/** Espelha o enum CalibrationMetric do backend. */
export type CalibrationMetric =
  | 'HEART_RATE'
  | 'OXYGEN_SATURATION'
  | 'BODY_TEMPERATURE'
  | 'SYSTOLIC'
  | 'DIASTOLIC'
  | 'EFFORT'
  | 'WEAR'
  | 'STEPS'
  | 'DISTANCE'
  | 'ACTIVE_ENERGY'
  | 'MOVEMENT'

/**
 * Cortes de uma faixa, por chave: excellence/fatigue nas medições de estado,
 * p10/p25/p75/p90 na temperatura, below/above nas de atividade. Corte nulo
 * desliga só a borda dele.
 */
export type Cuts = Readonly<Record<string, number | null>>

/** Zona de uma medição de estado: batimento, oxigenação, temperatura, pressão, esforço, desgaste. */
export type StateZone = 'EXCELLENCE' | 'NORMAL' | 'FATIGUE'
/** Zona de uma medição de atividade: passos, distância, calorias, movimento. */
export type ActivityZone = 'BELOW' | 'USUAL' | 'ABOVE'
export type CalibrationZone = StateZone | ActivityZone

/** Uma medição como a leitura individual a entrega: a zona de agora e a faixa em vigor. */
export type CalibrationMetricView = {
  /** Nula sem valor atual, sem faixa, ou no total do dia (passos, distância, calorias). */
  zone: CalibrationZone | null
  cuts: Cuts
  /** Partida padrão (ainda sem faixa aprendida), aprendido pelo recálculo ou corrigido pelo gestor. */
  source: 'START' | 'LEARNED' | 'OVERRIDE'
}

export type WorkerCalibration = {
  version: string
  /** CALIBRATED quando a fase fechou os 30 dias válidos. */
  phase: 'CALIBRATING' | 'CALIBRATED'
  /** Fase reaberta por troca de aparelho: a faixa de antes é a partida. */
  recalibrating: boolean
  /** Dia N de 30 enquanto calibra; nulo depois. */
  day: number | null
  /** Só as faixas gravadas e legíveis; a medição sem faixa fica ausente. */
  metrics: Partial<Record<CalibrationMetric, CalibrationMetricView>>
}

/** Os dois instantes estão em relógios diferentes: o do celular e o do servidor. */
export type TelemetrySync = {
  /** ISO-8601 do último evento lido do Health Connect, pelo relógio do celular. */
  measuredUntil: string
  /** ISO-8601 de quando o backend recebeu esse lote, pelo relógio do servidor. */
  syncedAt: string
}

export type HeartRateReference = {
  restingBpm: number
  restingSource: BaselineSource
  provisionalFrom: 'OPEN_DAY' | 'SESSION' | 'DEFAULT' | null
  measuredDays: number
  /** Topo da régua: a máxima pela idade ou, com calibração, o pico habitual. */
  maxBpm: number | null
  /**
   * De onde veio o topo da régua: idade, mistura de idade e pessoal, ou só o
   * pessoal. Ausente em avaliação de antes da calibração e em backend anterior.
   */
  peakSource?: PeakSource
  computedAt: string
}

export type PeakSource = 'AGE' | 'BLEND' | 'PERSONAL'

export type BaselineSource = 'MEASURED' | 'PROVISIONAL'

export type Coverage = { evaluated: number; total: number }

export type AggregateMetric<T> = {
  value: T | null
  unit: string
  coverage: Coverage
  /** Leitura mais recente que entrou na conta; null sem cobertura. */
  measuredAt: string | null
  /** Legenda pronta do backend; o painel não inventa a própria. */
  caption: string
}

export type AlertCount = {
  /** Funcionários, e não quantidade de registros. */
  workers: number
  /** De quantos funcionários a contagem fala. */
  total: number
  caption: string
}

export type AdminTelemetrySummary = {
  observedAt: string
  vitalSigns: AggregateMetric<number>
  wearRate: AggregateMetric<number>
  heartRateAverage: AggregateMetric<number>
  bloodPressureAverage: AggregateMetric<BloodPressure>
  bodyTemperatureAverage: AggregateMetric<number>
  movements: AggregateMetric<number>
  urgentAlerts: AlertCount
}

/**
 * Pedido de ajuda aberto (OPEN) ou atendido (ATTENDED: alguém reconheceu ou
 * despachou um socorrista). Fechado não vem. `id` é o do alerta da fila.
 */
export type AdminHelpRequest = {
  id: string
  status: 'OPEN' | 'ATTENDED'
  createdAt: string
  /** O resgate em andamento para este pedido; null enquanto ninguém foi despachado. */
  rescueId: string | null
}

export type AdminWorkerEntry = {
  worker: { id: string; name: string; sector: string | null }
  device: { state: 'NONE' | 'PAIRED'; lastSeenAt: string | null }
  /** A mesma leitura de workers/:id/current, condições incluídas. */
  telemetry: WorkerTelemetry
  /** Opcional porque um backend anterior responde sem. */
  helpRequest?: AdminHelpRequest | null
}

export type AdminWorkersTelemetry = {
  observedAt: string
  /** Pedidos de ajuda primeiro, depois urgentes, saúde e o resto, por nome. */
  workers: AdminWorkerEntry[]
}

export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED'

export type AlertQueueItem = {
  id: string
  /** DEMO só aparece com a configuração de homologação ligada no servidor. */
  origin: TelemetryOrigin
  status: AlertStatus
  createdAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  resolutionNote: string | null
  /** Quem reconheceu ou resolveu por último; null enquanto ninguém triou. */
  triagedBy: { id: string; name: string } | null
  worker: { id: string; name: string; sector: string | null }
  condition: {
    kind: ConditionKind
    category: ConditionCategory
    observedValue: number | null
    thresholdValue: number | null
    openedAt: string
    /** Preenchido quando a condição já fechou; o alerta segue até ser triado. */
    recoveredAt: string | null
    /** Por que fechou. Opcional porque um backend anterior responde sem. */
    recoveryReason?: ConditionRecoveryReason | null
    /** Só em REPEATED_EPISODES: o tipo que se repetiu. */
    episodeKind?: ConditionKind | null
  }
}

/** Uma linha de GET /telemetry/v1/workers/:id/conditions: toda condição, aberta ou fechada. */
export type ConditionHistoryItem = {
  id: string
  origin: TelemetryOrigin
  kind: ConditionKind
  category: ConditionCategory
  status: 'ACTIVE' | 'RECOVERED'
  /** ISO-8601 de quando abriu: o instante medido, quando a medição chega depois. */
  openedAt: string
  recoveredAt: string | null
  /** Nulo enquanto aberta. */
  recoveryReason: ConditionRecoveryReason | null
  observedValue: number | null
  thresholdValue: number | null
  /**
   * ISO-8601 de quando chegou o lote do episódio atrasado (abriu e fechou
   * dentro do lote da pulseira) e da condição de episódios repetidos. Nulo no
   * resto, que chega ao vivo.
   */
  receivedAt: string | null
  /** Só em REPEATED_EPISODES: o tipo que se repetiu. */
  episodeKind: ConditionKind | null
}

export type ConditionHistoryPage = {
  /** Mais nova primeiro, 50 por página. */
  items: ConditionHistoryItem[]
  /** null quando não há próxima página. */
  nextCursor: string | null
}

export type AlertQueuePage = {
  items: AlertQueueItem[]
  /** null quando não há próxima página. */
  nextCursor: string | null
}

export type AlertQueueQuery = {
  status?: AlertStatus[]
  limit?: number
  cursor?: string
}

export type SeriesPeriod = 'day' | 'week' | 'month'

export type SeriesPoint = {
  /** ISO-8601 do início do balde. */
  start: string
  /** ISO-8601 do fim do balde, exclusivo. */
  end: string
  activeEnergyKcal: number | null
  steps: number | null
  distanceM: number | null
  heartRate: { avg: number | null; min: number | null; max: number | null }
  /** 0..1 do balde com amostras. */
  coverage: number
}

/** Estado da pausa dos alertas de um funcionário, como o backend gravou. */
export type MonitoringPauseState = {
  workerId: string
  /** Desde quando os alertas estão pausados; null quando o funcionário segue monitorado. */
  monitoringPausedAt: string | null
}

export type WorkerSeries = {
  workerId: string
  period: SeriesPeriod
  origin: TelemetryOrigin | null
  bucket: 'hour' | 'day'
  from: string
  to: string
  points: SeriesPoint[]
}

// Envelope comum: falha vira erro com mensagem, nunca leitura vazia, para a
// tela poder dizer "indisponível" em vez de afirmar ausência de dado.
async function call<T>(work: () => Promise<T>, fallback: string): Promise<ServiceResponse<T>> {
  try {
    return { data: await work(), error: null }
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : fallback } }
  }
}

const id = (value: string) => encodeURIComponent(value)

// Triagem que deu certo avisa o aviso de alerta urgente, que relê a fila.
async function triaged<T>(work: Promise<ServiceResponse<T>>): Promise<ServiceResponse<T>> {
  const res = await work
  if (!res.error) notifyAlertTriaged()
  return res
}

export const telemetryApi = {
  // Quem nunca reportou volta como leitura vazia, não como erro: erro aqui é
  // funcionário fora da empresa, sessão caída ou backend fora do ar.
  workerCurrent: (workerId: string): Promise<ServiceResponse<WorkerTelemetry>> =>
    call(
      () => apiFetch<WorkerTelemetry>(`/telemetry/v1/workers/${id(workerId)}/current`),
      'Falha ao carregar a telemetria',
    ),

  adminSummary: (): Promise<ServiceResponse<AdminTelemetrySummary>> =>
    call(
      () => apiFetch<AdminTelemetrySummary>('/telemetry/v1/admin/summary'),
      'Falha ao carregar o resumo',
    ),

  adminWorkers: (): Promise<ServiceResponse<AdminWorkersTelemetry>> =>
    call(
      () => apiFetch<AdminWorkersTelemetry>('/telemetry/v1/admin/workers'),
      'Falha ao carregar os funcionários',
    ),

  workerSeries: (workerId: string, period: SeriesPeriod): Promise<ServiceResponse<WorkerSeries>> =>
    call(
      () => apiFetch<WorkerSeries>(`/telemetry/v1/workers/${id(workerId)}/series?period=${period}`),
      'Falha ao carregar a série',
    ),

  // Aqui entram também perda de sinal, bateria e o episódio que não virou alerta.
  workerConditions: (
    workerId: string,
    cursor?: string,
  ): Promise<ServiceResponse<ConditionHistoryPage>> =>
    call(
      () =>
        apiFetch<ConditionHistoryPage>(
          `/telemetry/v1/workers/${id(workerId)}/conditions${cursor ? `?cursor=${id(cursor)}` : ''}`,
        ),
      'Falha ao carregar o histórico de condições',
    ),

  alerts: (query: AlertQueueQuery = {}): Promise<ServiceResponse<AlertQueuePage>> => {
    const params = new URLSearchParams()
    if (query.status?.length) params.set('status', query.status.join(','))
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    if (query.cursor) params.set('cursor', query.cursor)
    const qs = params.toString()
    return call(
      () => apiFetch<AlertQueuePage>(`/telemetry/v1/admin/alerts${qs ? `?${qs}` : ''}`),
      'Falha ao carregar os alertas',
    )
  },

  acknowledgeAlert: (alertId: string): Promise<ServiceResponse<AlertQueueItem>> =>
    triaged(
      call(
        () =>
          apiFetch<AlertQueueItem>(`/telemetry/v1/admin/alerts/${id(alertId)}/acknowledge`, {
            method: 'POST',
          }),
        'Falha ao reconhecer o alerta',
      ),
    ),

  resolveAlert: (alertId: string, note?: string): Promise<ServiceResponse<AlertQueueItem>> =>
    triaged(
      call(
        () =>
          apiFetch<AlertQueueItem>(`/telemetry/v1/admin/alerts/${id(alertId)}/resolve`, {
            method: 'POST',
            body: JSON.stringify(note ? { note } : {}),
          }),
        'Falha ao resolver o alerta',
      ),
    ),

  // Pausa (PUT) e retomada (DELETE) dos alertas do funcionário. As duas são
  // idempotentes e devolvem o estado gravado, que a tela adota como verdade.
  pauseMonitoring: (workerId: string): Promise<ServiceResponse<MonitoringPauseState>> =>
    call(
      () =>
        apiFetch<MonitoringPauseState>(`/telemetry/v1/workers/${id(workerId)}/monitoring-pause`, {
          method: 'PUT',
        }),
      'Falha ao pausar os alertas',
    ),

  resumeMonitoring: (workerId: string): Promise<ServiceResponse<MonitoringPauseState>> =>
    call(
      () =>
        apiFetch<MonitoringPauseState>(`/telemetry/v1/workers/${id(workerId)}/monitoring-pause`, {
          method: 'DELETE',
        }),
      'Falha ao retomar os alertas',
    ),
}
