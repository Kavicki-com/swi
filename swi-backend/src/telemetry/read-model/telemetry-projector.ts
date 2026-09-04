import { METRICS, bloodPressureRecency, metricState, qualityAt } from '../domain/metric-state'
import {
  URGENT_CONDITION_KINDS,
  type BloodPressure,
  type BloodPressureRecency,
  type ConditionKind,
  type MeasurementSource,
  type MetricKind,
  type MetricState,
  type Sample,
  type TelemetryOrigin,
} from '../domain/telemetry.types'

// Projeção do read model do piloto: o único lugar que transforma amostra bruta
// em número exibido. Puro de propósito, com "now" por parâmetro, como o resto
// do domínio: quem lê banco é o serviço de consulta, e é isso que deixa cada
// regra congelada do piloto ser provada sem Postgres.
//
// Três decisões moram aqui e em nenhum outro lugar:
//
// 1. Ausência é estado de leitura. Nada aqui devolve zero para dizer "não sei".
// 2. Taxa é energia (ou movimento) sobre a duração EFETIVAMENTE coberta, não
//    sobre a janela inteira. Uma hora com dez minutos de dado é uma taxa de dez
//    minutos, e dividir pelos sessenta faria um turno pesado parecer leve.
// 3. Todo agregado do painel viaja com a cobertura que o produziu. Uma média
//    sem denominador é a mesma coisa que uma média inventada.

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Janela móvel de kcal/h. Acima disso a energia já não descreve o agora. */
export const ENERGY_RATE_WINDOW_MS = 60 * MINUTE

/** Cobertura mínima antes de kcal/h valer um número. Antes disso: Calculando. */
export const ENERGY_RATE_MIN_COVERAGE_MS = 5 * MINUTE

/**
 * Janela curta de movimento. Ela só recalcula MPM, esforço e desgaste: não é
 * relógio de publicação e não segura a exibição de valor bruto.
 */
export const MOVEMENT_WINDOW_MS = 15_000

// O dia monitorado (dia civil em BRT) não é definido aqui: a regra mora no
// domínio, em metric-state.ts, e é o serviço de consulta que a aplica ao
// recortar o dia. A projeção só herda uma consequência dela: `earliestAt` é
// do dia, então uma lacuna nos primeiros minutos do dia lê como começo.

// ---------------------------------------------------------------------------
// Entrada da projeção
// ---------------------------------------------------------------------------

/** Amostra reduzida ao que a projeção precisa. Deltas, como o aparelho mediu. */
export interface ProjectionSample {
  eventTime: string
  stepDelta: number | null
  activeEnergyKcal: number | null
  motionCount: number | null
}

/** Estado atual do funcionário, como a ingestão o promoveu. */
export interface ProjectionSnapshot {
  origin: TelemetryOrigin
  sessionId: string | null
  heartRateBpm: number | null
  heartRateAt: string | null
  batteryPercent: number | null
  batteryAt: string | null
  systolicMmHg: number | null
  diastolicMmHg: number | null
  bloodPressureSource: MeasurementSource | null
  bloodPressureAt: string | null
}

/** Avaliação já calculada. Quem a escreve é a Task 7; aqui só se lê. */
export interface ProjectionAssessment {
  computedAt: string
  effortPercent: number | null
  wearPercent: number | null
  formulaVersion: string
}

/**
 * Totais do dia monitorado, já somados pelo banco.
 *
 * A projeção nunca recebe a série do dia. Na oitava hora de um turno ela teria
 * milhares de linhas, e a leitura acontece a cada evento; somar aqui seria
 * varrer o dia inteiro a cada aviso do socket. O banco soma em uma linha, e a
 * projeção só decide atualidade e apresentação, que é o trabalho dela.
 */
export interface DayTotals {
  steps: Sample<number> | null
  /**
   * `earliestAt` é a primeira amostra de energia do dia. A janela de kcal/h
   * não enxerga o que veio antes dela, e é isso que separa cobertura curta por
   * começo ("Calculando") de cobertura curta por lacuna (indisponível).
   */
  activeEnergy: (Sample<number> & { earliestAt: string }) | null
}

export interface WorkerProjectionInput {
  workerId: string
  snapshot: ProjectionSnapshot | null
  /** Só a janela das taxas, na mesma origem do snapshot, em qualquer ordem. */
  windowSamples: readonly ProjectionSample[]
  dayTotals: DayTotals
  /** A avaliação mais recente do dia monitorado, quando houver. */
  assessment: ProjectionAssessment | null
}

// ---------------------------------------------------------------------------
// Saída da projeção
// ---------------------------------------------------------------------------

/** Como uma janela móvel foi preenchida. É o que permite auditar a taxa. */
export interface WindowCoverage {
  samples: number
  /** Intervalo entre a primeira e a última amostra da janela. */
  coveredMs: number
  windowStart: string | null
  windowEnd: string | null
}

export interface WorkerMetrics {
  heartRate: MetricState<number>
  steps: MetricState<number>
  movementPerMinute: MetricState<number>
  activeEnergy: MetricState<number>
  energyRatePerHour: MetricState<number>
  battery: MetricState<number>
  bloodPressure: MetricState<BloodPressure>
  effort: MetricState<number>
  wear: MetricState<number>
}

export interface WorkerTelemetry {
  workerId: string
  /** Nulo enquanto o funcionário nunca reportou. Nunca se mistura com a outra. */
  origin: TelemetryOrigin | null
  monitoringSessionId: string | null
  metrics: WorkerMetrics
  bloodPressureRecency: BloodPressureRecency
  /** Versão da fórmula que produziu esforço e desgaste, quando houver. */
  formulaVersion: string | null
  energyWindow: WindowCoverage
  movementWindow: WindowCoverage
  /** ISO-8601 do instante contra o qual toda qualidade acima foi decidida. */
  observedAt: string
}

const EMPTY_WINDOW: WindowCoverage = {
  samples: 0,
  coveredMs: 0,
  windowStart: null,
  windowEnd: null,
}

// ---------------------------------------------------------------------------
// Funções de apoio
// ---------------------------------------------------------------------------

const toMs = (iso: string): number => Date.parse(iso)

/** Uma casa decimal. Sem isto, 50/(1/6) devolve 300.00000000000006. */
const round1 = (n: number): number => Math.round(n * 10) / 10

function sampleOf<T>(
  value: T | null,
  measuredAt: string | null,
  source: MeasurementSource | null,
): Sample<T> | null {
  if (value === null || measuredAt === null || source === null) return null
  return { value, measuredAt, source }
}

function unavailable<T>(kind: MetricKind): MetricState<T> {
  return {
    value: null,
    quality: 'UNAVAILABLE',
    measuredAt: null,
    source: null,
    unit: METRICS[kind].unit,
  }
}

/** Soma vinda do banco pode carregar ruído de ponto flutuante; a tela não. */
function rounded(sample: Sample<number> | null): Sample<number> | null {
  return sample === null ? null : { ...sample, value: round1(sample.value) }
}

interface RateResult {
  value: number | null
  latestAt: string | null
  coverage: WindowCoverage
  /** Há amostra, mas ainda não há cobertura suficiente para uma taxa honesta. */
  calculating: boolean
}

interface RateOptions {
  windowMs: number
  /** Denominador da taxa: uma hora para kcal/h, um minuto para MPM. */
  perMs: number
  minCoverageMs: number
  /**
   * Se esta métrica promete "Calculando" ao cliente enquanto junta cobertura.
   * Só kcal/h promete; MPM sem cobertura é indisponível e ponto. Um campo
   * próprio, e não `minCoverageMs > 0`: a promessa é decisão de produto, e
   * lê-la de um limiar esconderia isso atrás de uma aritmética.
   */
  reportsCalculating: boolean
  /**
   * Primeira amostra do dia para esta medição, como o banco a conhece. A janela
   * não enxerga nada antes de si, então é este horário que diz se cobertura
   * curta é começo ou lacuna. Nulo quando o dia não tem amostra alguma.
   */
  earliestKnownAt: string | null
}

/**
 * Taxa sobre uma janela móvel.
 *
 * Cada delta descreve o intervalo desde a amostra anterior. Por isso a primeira
 * amostra da janela apenas ancora o início da cobertura e o delta dela fica de
 * fora: ele pertence ao intervalo anterior à janela, e somá-lo atribuiria a
 * quinze segundos a energia de vários minutos. Com uma amostra só não há
 * intervalo nenhum, e uma taxa não existe.
 */
function rateOverWindow(
  samples: readonly ProjectionSample[],
  field: 'activeEnergyKcal' | 'motionCount',
  options: RateOptions,
  now: Date,
): RateResult {
  const windowStartMs = now.getTime() - options.windowMs
  // flatMap e não filter: ele estreita o tipo para número no mesmo passo, e
  // assim a soma adiante não precisa de um `?? 0` que nunca acontece e que
  // esconderia uma medição ausente como se fosse consumo zero.
  const inWindow = samples
    .flatMap((s) => {
      const value = s[field]
      if (value === null || toMs(s.eventTime) < windowStartMs) return []
      return [{ eventTime: s.eventTime, value }]
    })
    .sort((a, b) => toMs(a.eventTime) - toMs(b.eventTime))

  if (inWindow.length === 0) {
    return { value: null, latestAt: null, coverage: EMPTY_WINDOW, calculating: false }
  }

  const first = inWindow[0]
  const last = inWindow[inWindow.length - 1]
  const coveredMs = toMs(last.eventTime) - toMs(first.eventTime)
  const coverage: WindowCoverage = {
    samples: inWindow.length,
    coveredMs,
    windowStart: first.eventTime,
    windowEnd: last.eventTime,
  }

  if (coveredMs <= 0 || coveredMs < options.minCoverageMs) {
    // "Calculando" é o estado dos primeiros minutos de cobertura, e só isso.
    // Se já houve medição antes desta janela, a cobertura curta é lacuna de
    // sinal, não começo: chamá-la de "Calculando" no meio de um turno contaria
    // uma história falsa sobre por que o número sumiu, e a ADR-0004 manda a
    // indisponibilidade derivar da ausência do dado, nunca de um rótulo.
    const startingUp =
      options.earliestKnownAt === null || toMs(options.earliestKnownAt) >= windowStartMs
    return {
      value: null,
      latestAt: last.eventTime,
      coverage,
      calculating: options.reportsCalculating && startingUp,
    }
  }

  const total = inWindow.slice(1).reduce((sum, s) => sum + s.value, 0)
  return {
    value: round1(total / (coveredMs / options.perMs)),
    latestAt: last.eventTime,
    coverage,
    calculating: false,
  }
}

function rateState(kind: MetricKind, rate: RateResult, now: Date): MetricState<number> {
  if (rate.value !== null) {
    return metricState(kind, sampleOf(rate.value, rate.latestAt, 'DERIVED'), now)
  }
  // Sem taxa, mas o horário da última amostra permanece quando houve alguma:
  // "não dá para calcular, e o dado é desta hora" é informação; um horário nulo
  // faria a tela não distinguir silêncio de cobertura insuficiente.
  //
  // "Calculando" promete um número que está chegando, então ele vale enquanto a
  // última amostra ainda descreve o agora. Um relógio que envia duas medições e
  // morre não está calculando nada: sem esta porta, ele anunciaria "Calculando"
  // por quase uma hora, que é a mesma história falsa que a ADR-0004 proíbe na
  // lacuna. O prazo é o do domínio, o mesmo que decide a qualidade quando há
  // valor; a taxa não ganha limiar próprio.
  const stillReading = qualityAt(kind, rate.latestAt, now) !== 'UNAVAILABLE'
  return {
    value: null,
    quality: rate.calculating && stillReading ? 'CALCULATING' : 'UNAVAILABLE',
    measuredAt: rate.latestAt,
    source: rate.latestAt === null ? null : 'DERIVED',
    unit: METRICS[kind].unit,
  }
}

// ---------------------------------------------------------------------------
// Estados compartilhados
// ---------------------------------------------------------------------------

// O mobile lê um funcionário e o painel agrega dezenas, mas os dois decidem
// atualidade pelas mesmas funções. Duas listas de regras divergiriam em
// silêncio, e a divergência apareceria como o painel chamando de atual o que a
// tela do funcionário já mostra como desatualizado.

interface SnapshotStates {
  heartRate: MetricState<number>
  battery: MetricState<number>
  bloodPressure: MetricState<BloodPressure>
  /** A amostra crua da pressão, para decidir a recência sem reabrir o snapshot. */
  pressureSample: Sample<BloodPressure> | null
}

function snapshotStates(snapshot: ProjectionSnapshot | null, now: Date): SnapshotStates {
  if (snapshot === null) {
    return {
      heartRate: unavailable('heartRate'),
      battery: unavailable('battery'),
      bloodPressure: unavailable('bloodPressure'),
      pressureSample: null,
    }
  }

  // Pressão exige o par completo E a origem declarada. O painel promete
  // "aparelho externo ou entrada manual real": uma leitura cuja procedência não
  // se sabe não sustenta a promessa, e meia medição não é medição.
  const pressureSample =
    snapshot.systolicMmHg === null || snapshot.diastolicMmHg === null
      ? null
      : sampleOf<BloodPressure>(
          { systolic: snapshot.systolicMmHg, diastolic: snapshot.diastolicMmHg },
          snapshot.bloodPressureAt,
          snapshot.bloodPressureSource,
        )

  return {
    heartRate: metricState(
      'heartRate',
      sampleOf(snapshot.heartRateBpm, snapshot.heartRateAt, 'APPLE_WATCH'),
      now,
    ),
    battery: metricState(
      'battery',
      sampleOf(snapshot.batteryPercent, snapshot.batteryAt, 'APPLE_WATCH'),
      now,
    ),
    bloodPressure: metricState('bloodPressure', pressureSample, now),
    pressureSample,
  }
}

/**
 * Esforço e desgaste são leitura da avaliação, nunca cálculo daqui: a fórmula é
 * módulo versionado e auditável à parte. Uma avaliação que falhou devolve
 * percentual nulo e não apaga BPM, passos nem energia.
 */
function assessmentStates(
  assessment: ProjectionAssessment | null,
  now: Date,
): { effort: MetricState<number>; wear: MetricState<number> } {
  const at = assessment?.computedAt ?? null
  return {
    effort: metricState('effort', sampleOf(assessment?.effortPercent ?? null, at, 'DERIVED'), now),
    wear: metricState('wear', sampleOf(assessment?.wearPercent ?? null, at, 'DERIVED'), now),
  }
}

// ---------------------------------------------------------------------------
// Projeção por funcionário
// ---------------------------------------------------------------------------

export function projectWorker(input: WorkerProjectionInput, now: Date): WorkerTelemetry {
  const { snapshot, windowSamples, dayTotals, assessment } = input

  const energy = rateOverWindow(
    windowSamples,
    'activeEnergyKcal',
    {
      windowMs: ENERGY_RATE_WINDOW_MS,
      perMs: HOUR,
      minCoverageMs: ENERGY_RATE_MIN_COVERAGE_MS,
      reportsCalculating: true,
      earliestKnownAt: dayTotals.activeEnergy?.earliestAt ?? null,
    },
    now,
  )
  // MPM não promete "Calculando" a ninguém: sem intervalo coberto ele é
  // indisponível, e é isso que a tela de diagnóstico precisa ver.
  const movement = rateOverWindow(
    windowSamples,
    'motionCount',
    {
      windowMs: MOVEMENT_WINDOW_MS,
      perMs: MINUTE,
      minCoverageMs: 0,
      reportsCalculating: false,
      earliestKnownAt: null,
    },
    now,
  )

  const fromSnapshot = snapshotStates(snapshot, now)
  const derived = assessmentStates(assessment, now)

  const metrics: WorkerMetrics = {
    heartRate: fromSnapshot.heartRate,
    steps: metricState('steps', dayTotals.steps, now),
    movementPerMinute: rateState('movementPerMinute', movement, now),
    activeEnergy: metricState('activeEnergy', rounded(dayTotals.activeEnergy), now),
    energyRatePerHour: rateState('energyRatePerHour', energy, now),
    battery: fromSnapshot.battery,
    bloodPressure: fromSnapshot.bloodPressure,
    effort: derived.effort,
    wear: derived.wear,
  }

  return {
    workerId: input.workerId,
    origin: snapshot?.origin ?? null,
    monitoringSessionId: snapshot?.sessionId ?? null,
    metrics,
    bloodPressureRecency: bloodPressureRecency(fromSnapshot.pressureSample?.measuredAt ?? null, now),
    formulaVersion: assessment?.formulaVersion ?? null,
    energyWindow: energy.coverage,
    movementWindow: movement.coverage,
    observedAt: now.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Agregados do painel
// ---------------------------------------------------------------------------

/** De quantos funcionários o número fala, e de quantos ele poderia falar. */
export interface Coverage {
  evaluated: number
  total: number
}

export interface AggregateMetric<T> {
  value: T | null
  unit: string
  coverage: Coverage
  /**
   * Horário da leitura mais recente que entrou na conta. Nulo sem cobertura.
   *
   * Um agregado precisa dizer de quando ele fala, e não só de quantos. Não há
   * campo `quality` ao lado: as médias só admitem contribuinte CURRENT, então a
   * qualidade seria sempre CURRENT quando há cobertura e UNAVAILABLE quando não
   * há, isto é, uma repetição de `coverage.evaluated > 0` capaz de discordar
   * dela um dia.
   */
  measuredAt: string | null
  /** Legenda congelada. Vem daqui para o painel não inventar a própria. */
  caption: string
}

export interface AlertCount {
  /** Funcionários, e não quantidade de registros. */
  workers: number
  caption: string
}

export interface AdminTelemetrySummary {
  observedAt: string
  /** Quantos estão dentro dos limites do piloto, entre os avaliáveis. */
  vitalSigns: AggregateMetric<number>
  wearRate: AggregateMetric<number>
  heartRateAverage: AggregateMetric<number>
  bloodPressureAverage: AggregateMetric<BloodPressure>
  movements: AggregateMetric<number>
  /**
   * O único contador de alerta que a Task 6 expõe. Revisão de pressão e alerta
   * de aparelho existem na classificação, mas quem os apresenta é a Task 8,
   * dona das condições e da triagem: a tabela congelada do painel não os lista
   * como card, e antecipá-los aqui seria decidir tela no lugar dela.
   */
  urgentAlerts: AlertCount
}

/**
 * O que o painel realmente agrega, e nada além disso.
 *
 * Não é `WorkerTelemetry` de propósito. O painel traz dezenas de funcionários e
 * usa quatro estados; puxar a série de amostras do dia de cada um só para somar
 * passos e depois descartar o resto seria varrer o dia inteiro uma vez por
 * card. Aqui a soma vem pronta do banco, e o tipo diz exatamente isso.
 */
export interface AggregateWorkerInput {
  workerId: string
  heartRate: MetricState<number>
  wear: MetricState<number>
  bloodPressure: MetricState<BloodPressure>
  /** Acumulado do dia monitorado. */
  steps: MetricState<number>
  activeConditions: readonly ConditionKind[]
}

/**
 * Monta a entrada do painel decidindo atualidade pelas mesmas funções que a
 * projeção do funcionário usa. `steps` chega já somado pelo banco, carimbado
 * pela amostra de passos mais recente do dia: é o mesmo número que a série
 * produziria, sem trazer a série.
 */
export function projectAggregateWorker(
  input: {
    workerId: string
    snapshot: ProjectionSnapshot | null
    steps: Sample<number> | null
    assessment: ProjectionAssessment | null
    activeConditions: readonly ConditionKind[]
  },
  now: Date,
): AggregateWorkerInput {
  const fromSnapshot = snapshotStates(input.snapshot, now)
  return {
    workerId: input.workerId,
    heartRate: fromSnapshot.heartRate,
    wear: assessmentStates(input.assessment, now).wear,
    bloodPressure: fromSnapshot.bloodPressure,
    steps: metricState('steps', input.steps, now),
    activeConditions: input.activeConditions,
  }
}

/**
 * Legendas dos cards, congeladas aqui.
 *
 * Ficam no read model, e não na tela, porque a regra que elas expressam é do
 * dado: `noCoverage` é o que substitui a legenda quando ninguém foi avaliado, e
 * é o que impede o painel de escrever "0 bpm" onde o certo é "sem dados".
 */
export const PANEL_CAPTIONS = {
  vitalSigns: 'Dentro dos limites do piloto',
  wearRate: 'Estimativa experimental',
  heartRate: 'Média atual e cobertura',
  bloodPressure: 'Média recente em mmHg e cobertura',
  // "Passos da jornada" seria falso: monitoramento e Jornada SWI são
  // independentes, e o acumulado é do dia monitorado inteiro.
  movements: 'Passos acumulados no dia monitorado',
  urgentAlerts: 'Funcionários com condição urgente ativa',
  noCoverage: 'Sem dados atuais',
} as const

interface Contributors {
  evaluated: number
  /** O mais recente entre os que entraram na conta. */
  measuredAt: string | null
}

function aggregate<T>(
  value: T | null,
  unit: string,
  contributors: Contributors,
  total: number,
  caption: string,
): AggregateMetric<T> {
  // Sem cobertura não há número, e a legenda diz por quê. É a regra que impede
  // o painel de apresentar ausência como zero.
  const covered = contributors.evaluated > 0
  return {
    value: covered ? value : null,
    unit,
    coverage: { evaluated: contributors.evaluated, total },
    measuredAt: covered ? contributors.measuredAt : null,
    caption: covered ? caption : PANEL_CAPTIONS.noCoverage,
  }
}

const isCurrent = (state: MetricState<unknown>): boolean => state.quality === 'CURRENT'

/** O horário mais recente de um conjunto de leituras. */
function latestOf(states: readonly MetricState<unknown>[]): string | null {
  let latest: string | null = null
  for (const { measuredAt } of states) {
    if (measuredAt === null) continue
    if (latest === null || toMs(measuredAt) > toMs(latest)) latest = measuredAt
  }
  return latest
}

/**
 * As leituras que entram numa média: só as atuais.
 *
 * flatMap e não filter, pelo mesmo motivo do cálculo de taxa: ele estreita o
 * tipo do valor no mesmo passo, sem um cast que calaria uma leitura vazia.
 */
function currentValuesOf<T>(
  workers: readonly AggregateWorkerInput[],
  pick: (w: AggregateWorkerInput) => MetricState<T>,
): { values: T[]; contributors: Contributors } {
  const states = workers.map(pick).filter(isCurrent)
  const values = states.flatMap((state) => (state.value === null ? [] : [state.value]))
  return { values, contributors: { evaluated: values.length, measuredAt: latestOf(states) } }
}

/** Média aritmética de um conjunto que o chamador já garantiu não vazio. */
const meanOf = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : round1(meanOf(values))
}

function hasAny(worker: AggregateWorkerInput, kinds: readonly ConditionKind[]): boolean {
  return worker.activeConditions.some((kind) => kinds.includes(kind))
}

export function projectAdminSummary(
  workers: readonly AggregateWorkerInput[],
  now: Date,
): AdminTelemetrySummary {
  const total = workers.length

  const heartRate = currentValuesOf(workers, (w) => w.heartRate)
  const wear = currentValuesOf(workers, (w) => w.wear)
  // Só leitura de até 24 h entra na média do painel; entre 24 e 72 h ela é
  // histórica e vive somente no mobile.
  const pressure = currentValuesOf(workers, (w) => w.bloodPressure)

  // Avaliável em sinais vitais é quem tem BPM atual. Quem não tem é "não
  // avaliado", nunca saudável: por isso ele conta no total e não no evaluated.
  const assessable = workers.filter((w) => isCurrent(w.heartRate))
  const withinLimits = assessable.filter((w) => !hasAny(w, URGENT_CONDITION_KINDS)).length

  const pressureAverage =
    pressure.values.length === 0
      ? null
      : {
          // mmHg é inteiro por contrato: uma média com casa decimal seria uma
          // pressão que nenhum aparelho mede.
          systolic: Math.round(meanOf(pressure.values.map((p) => p.systolic))),
          diastolic: Math.round(meanOf(pressure.values.map((p) => p.diastolic))),
        }

  // Movimentos é soma do dia, e não média do agora, e por isso a regra "exclui
  // indisponíveis", que a Task 6 enuncia para MÉDIA, não se aplica aqui: quem
  // caminhou 4 mil passos hoje caminhou 4 mil passos, mesmo que a última
  // amostra tenha dez minutos. Descartá-la subestimaria o dia. Fica de fora só
  // quem não tem total algum, que é o caso em que não se sabe.
  const stepStates = workers.map((w) => w.steps)
  const stepTotals = stepStates.flatMap((state) => (state.value === null ? [] : [state.value]))
  const stepContributors: Contributors = {
    evaluated: stepTotals.length,
    measuredAt: latestOf(stepStates),
  }

  return {
    observedAt: now.toISOString(),
    vitalSigns: aggregate(
      withinLimits,
      'workers',
      { evaluated: assessable.length, measuredAt: latestOf(assessable.map((w) => w.heartRate)) },
      total,
      PANEL_CAPTIONS.vitalSigns,
    ),
    wearRate: aggregate(
      average(wear.values),
      METRICS.wear.unit,
      wear.contributors,
      total,
      PANEL_CAPTIONS.wearRate,
    ),
    heartRateAverage: aggregate(
      average(heartRate.values),
      METRICS.heartRate.unit,
      heartRate.contributors,
      total,
      PANEL_CAPTIONS.heartRate,
    ),
    bloodPressureAverage: aggregate(
      pressureAverage,
      METRICS.bloodPressure.unit,
      pressure.contributors,
      total,
      PANEL_CAPTIONS.bloodPressure,
    ),
    movements: aggregate(
      stepTotals.reduce((sum, v) => sum + v, 0),
      METRICS.steps.unit,
      stepContributors,
      total,
      PANEL_CAPTIONS.movements,
    ),
    // Funcionários únicos, não registros: a entrada é uma linha por
    // funcionário, então duas condições da mesma pessoa contam uma vez só.
    urgentAlerts: {
      workers: workers.filter((w) => hasAny(w, URGENT_CONDITION_KINDS)).length,
      caption: PANEL_CAPTIONS.urgentAlerts,
    },
  }
}
