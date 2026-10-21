import type { TelemetryConditionKind } from '@prisma/client'

import type { AlertProfile } from './alert-profile'
import type { PressureSafety, SafetyBand } from './safety-limits'

// Motor de condições: decide abrir, manter ou recuperar a partir de amostras,
// limites e um instante. Puro de propósito, como a fórmula: "now" entra por
// parâmetro, nada aqui lê banco nem relógio. Quem lê e grava é o serviço.

/**
 * De onde veio a régua. `PERSONALIZED` e `FLOOR` são do perfil v2 (DEMO) e da
 * trava de batimento; `BAND` é o corte de fadiga da calibração da pessoa;
 * `SAFETY_DEFAULT` e `SAFETY_CUSTOM` são as travas do perfil calibrado, sem e
 * com o valor gravado pelo admin.
 */
export type ThresholdRule = 'PERSONALIZED' | 'FLOOR' | 'BAND' | 'SAFETY_DEFAULT' | 'SAFETY_CUSTOM'
export type SafetySource = Extract<ThresholdRule, 'SAFETY_DEFAULT' | 'SAFETY_CUSTOM'>

/** Limite em vigor e de onde ele veio. `value` na unidade da condição. */
export interface Threshold {
  readonly value: number
  readonly rule: ThresholdRule
}

export interface HeartRateLimits {
  high: Threshold
  low: Threshold
}

export interface HeartRateBaseline {
  /** Máxima por idade. Nula sem data de nascimento. */
  maxBpm: number | null
  /** Repouso observado. Nulo sem 14 dias de Resumo do dia. */
  restingBpm: number | null
}

/**
 * Cada regra cai no piso pela sua própria falta: cadastro completo sem
 * histórico tem BPM alto personalizado e BPM baixo no piso. O piso é rede de
 * segurança para quem não tem dado; para BPM baixo ele também segura um
 * repouso observado absurdo, nos dois sentidos.
 */
export function heartRateLimits(profile: AlertProfile, baseline: HeartRateBaseline): HeartRateLimits {
  const high: Threshold =
    baseline.maxBpm === null
      ? { value: profile.heartRateHigh.floorBpm, rule: 'FLOOR' }
      : { value: Math.round(baseline.maxBpm * profile.heartRateHigh.maxFraction), rule: 'PERSONALIZED' }

  // Arredondado como o limite alto: a mediana de um número par de dias fechados
  // é a média dos dois centrais, então repouso observado de 62,5 é possível, e
  // sem isto a casa decimal iria para a coluna da condição e para a tela.
  const personalizedLow =
    baseline.restingBpm === null ? null : Math.round(baseline.restingBpm - profile.heartRateLow.belowRestingBpm)
  // O limite baixo personalizado só vale estritamente abaixo do alto. Sem esta
  // conferência, um repouso observado poluído (190, digamos) daria limite baixo
  // 175 contra limite alto 165, e um único 170 bpm satisfaria os dois
  // predicados ao mesmo tempo: abriria BPM alto e BPM baixo juntos, e a fila
  // receberia dois alertas que se contradizem sobre o mesmo funcionário.
  // Repouso que alcança a máxima por idade é dado poluído, não fisiologia, e
  // dado poluído não personaliza nada: cai no piso, como quem não tem dado.
  const crossesHigh = personalizedLow !== null && personalizedLow >= high.value
  const low: Threshold =
    personalizedLow === null || personalizedLow < profile.heartRateLow.floorBpm || crossesHigh
      ? { value: profile.heartRateLow.floorBpm, rule: 'FLOOR' }
      : { value: personalizedLow, rule: 'PERSONALIZED' }

  return { high, low }
}

export interface EngineSample {
  atMs: number
  heartRateBpm: number | null
  batteryPercent: number | null
}

export interface Decision {
  kind: TelemetryConditionKind
  action: 'OPEN' | 'RECOVER'
  observedValue: number | null
  threshold: Threshold | null
}

type HeartRateKind = 'HEART_RATE_HIGH' | 'HEART_RATE_LOW'

/** Leitura genérica: a mesma máquina serve ao batimento, ao desgaste e à oxigenação. */
export interface Point {
  atMs: number
  value: number
}

/** Persistência exigida: janela, trecho mínimo coberto e vão máximo entre leituras. */
export interface Persistence {
  readonly windowMs: number
  readonly minSpanMs: number
  readonly maxGapMs: number
}

export const heartRatePoints = (samples: readonly EngineSample[]): Point[] =>
  samples.flatMap((s) => (s.heartRateBpm === null ? [] : [{ atMs: s.atMs, value: s.heartRateBpm }]))

/**
 * "Contínuo" tem três exigências, e nenhuma delas sozinha basta:
 *
 * 1. Toda amostra de BPM da janela satisfaz o predicado. Uma leitura do outro
 *    lado zera a evidência, então a persistência efetiva é a janela inteira.
 * 2. O trecho entre a primeira e a última cobre o mínimo. É a mesma noção de
 *    cobertura que o projetor usa para a taxa de energia: número sem
 *    denominador é número inventado.
 * 3. Nenhum vão entre amostras consecutivas passa do teto. Sem esta, duas
 *    amostras nas pontas da janela cumpririam a segunda exigência sem haver
 *    dado nenhum entre elas, e duas amostras a 45 s de distância não provam
 *    45 s de nada, pela mesma razão que duas a 5 s não provam um minuto.
 *
 * A fronteira de baixo é fechada, como a do projetor: sem isso, uma amostra
 * por janela caía fora na cadência de 5 s, e o trecho medido era 55 s onde o
 * perfil dizia 60 s.
 */
function sustained(
  points: readonly Point[],
  nowMs: number,
  persistence: Persistence,
  holds: (value: number) => boolean,
): number[] | null {
  const windowStart = nowMs - persistence.windowMs
  const inWindow = points.filter((p) => p.atMs >= windowStart && p.atMs <= nowMs).sort((a, b) => a.atMs - b.atMs)
  if (inWindow.length === 0) return null
  const spanMs = inWindow[inWindow.length - 1].atMs - inWindow[0].atMs
  if (spanMs < persistence.minSpanMs) return null
  for (let i = 1; i < inWindow.length; i++) {
    if (inWindow[i].atMs - inWindow[i - 1].atMs > persistence.maxGapMs) return null
  }
  const values = inWindow.map((p) => p.value)
  return values.every(holds) ? values : null
}

export function decideHeartRate(
  kind: HeartRateKind,
  samples: readonly EngineSample[],
  threshold: Threshold,
  active: boolean,
  profile: AlertProfile,
  nowMs: number,
  /** Recuperação da trava do admin. Sem ela, a banda do perfil a partir do limite. */
  recoverAt?: number,
): Decision | null {
  const high = kind === 'HEART_RATE_HIGH'
  const band = high ? profile.heartRateHigh.hysteresisBpm : profile.heartRateLow.hysteresisBpm
  const points = heartRatePoints(samples)

  if (!active) {
    const values = sustained(points, nowMs, profile.persistence, (bpm) =>
      high ? bpm >= threshold.value : bpm <= threshold.value,
    )
    if (values === null) return null
    return { kind, action: 'OPEN', observedValue: high ? Math.max(...values) : Math.min(...values), threshold }
  }

  // Recupera pela banda, não pelo mesmo limite: quem oscila em torno dele
  // abriria e fecharia a cada leitura.
  const recoverLine = recoverAt ?? (high ? threshold.value - band : threshold.value + band)
  const values = sustained(points, nowMs, profile.persistence, (bpm) => (high ? bpm < recoverLine : bpm > recoverLine))
  if (values === null) return null
  return { kind, action: 'RECOVER', observedValue: high ? Math.max(...values) : Math.min(...values), threshold }
}

/**
 * Bateria chega a cada cinco minutos e cai de forma monótona: uma leitura
 * basta para abrir. A banda de dez pontos é o que evita abre e fecha por
 * leitura imprecisa, e a recuperação durante o turno existe: carregador no
 * almoço é real.
 */
export function decideBattery(percent: number | null, active: boolean, profile: AlertProfile): Decision | null {
  if (percent === null) return null
  const threshold: Threshold = { value: profile.batteryLow.openAtPercent, rule: 'FLOOR' }
  if (!active && percent <= profile.batteryLow.openAtPercent) {
    return { kind: 'DEVICE_BATTERY_LOW', action: 'OPEN', observedValue: percent, threshold }
  }
  if (active && percent > profile.batteryLow.recoverAbovePercent) {
    return { kind: 'DEVICE_BATTERY_LOW', action: 'RECOVER', observedValue: percent, threshold }
  }
  return null
}

/**
 * Desgaste é leitura da última avaliação, e a persistência já está dentro
 * dela: a dose é a integral da intensidade com decaimento de 180 min, e um
 * pico isolado não a leva a 80%. Por isso uma leitura basta, como a bateria.
 * A banda de dez pontos evita abre e fecha em torno do limiar, e é o
 * decaimento que recupera sozinho depois de uma pausa. A regra é sempre FLOOR:
 * o limiar é o mesmo para todo mundo, e a personalização já aconteceu dentro
 * da fórmula, pelo repouso observado e pela máxima por idade.
 */
export function decideWear(wearPercent: number | null, active: boolean, profile: AlertProfile): Decision | null {
  if (wearPercent === null) return null
  const threshold: Threshold = { value: profile.wearHigh.openAtPercent, rule: 'FLOOR' }
  if (!active && wearPercent >= profile.wearHigh.openAtPercent) {
    return { kind: 'WEAR_HIGH', action: 'OPEN', observedValue: wearPercent, threshold }
  }
  if (active && wearPercent < profile.wearHigh.recoverBelowPercent) {
    return { kind: 'WEAR_HIGH', action: 'RECOVER', observedValue: wearPercent, threshold }
  }
  return null
}

/**
 * Trava de desgaste do perfil calibrado: a mesma leitura única de `decideWear`,
 * com a abertura e a recuperação da trava (padrão 90 e 80, ou as do admin) e o
 * rastro de trava no lugar do piso.
 */
export function decideWearSafety(
  wearPercent: number | null,
  values: SafetyBand,
  active: boolean,
  rule: SafetySource,
): Decision | null {
  if (wearPercent === null) return null
  const threshold: Threshold = { value: values.openAt, rule }
  if (!active && wearPercent >= values.openAt) {
    return { kind: 'WEAR_HIGH', action: 'OPEN', observedValue: wearPercent, threshold }
  }
  if (active && wearPercent < values.closeAt) {
    return { kind: 'WEAR_HIGH', action: 'RECOVER', observedValue: wearPercent, threshold }
  }
  return null
}

export interface BloodPressureReading {
  systolic: number
  diastolic: number
}

/**
 * Pressão é medida à mão e raramente: uma medição abre, e só medição nova
 * recupera. A banda é pequena porque a série já é esparsa; sem ela, 139 e 141
 * alternados abririam e fechariam a cada dia. O valor observado é o que
 * cruzou, sistólica primeiro, e a régua acompanha o valor observado: a coluna
 * thresholdValue existe para a auditoria ler o número que abriu sem ter que
 * recuperá-lo pela versão do perfil. A regra é sempre FLOOR porque pressão não
 * se personaliza por idade nem por histórico: 140 por 90 vale para todos.
 */
export function decideBloodPressure(
  reading: BloodPressureReading | null,
  active: boolean,
  profile: AlertProfile,
): Decision | null {
  return decidePressureLimit('BLOOD_PRESSURE_REVIEW', reading, profile.bloodPressureReview, active, 'FLOOR')
}

/**
 * A regra de pressão por limites fixos, comum à revisão do perfil v2 e à trava
 * do calibrado: abre com sistólica ou diastólica no limite, recupera com as
 * duas abaixo da recuperação.
 */
function decidePressureLimit(
  kind: TelemetryConditionKind,
  reading: BloodPressureReading | null,
  p: PressureSafety,
  active: boolean,
  rule: ThresholdRule,
): Decision | null {
  if (reading === null) return null
  const systolicRule: Threshold = { value: p.systolicAt, rule }
  if (!active) {
    if (reading.systolic >= p.systolicAt) {
      return { kind, action: 'OPEN', observedValue: reading.systolic, threshold: systolicRule }
    }
    if (reading.diastolic >= p.diastolicAt) {
      return { kind, action: 'OPEN', observedValue: reading.diastolic, threshold: { value: p.diastolicAt, rule } }
    }
    return null
  }
  if (reading.systolic < p.systolicRecoverBelow && reading.diastolic < p.diastolicRecoverBelow) {
    // A recuperação carrega a régua da sistólica porque é a sistólica que ela
    // reporta como valor observado. O serviço não regrava régua ao recuperar,
    // então isto é coerência do motor, não coluna nova.
    return { kind, action: 'RECOVER', observedValue: reading.systolic, threshold: systolicRule }
  }
  return null
}

/** Trava de pressão alta do perfil calibrado: o padrão do perfil ou o valor do admin. */
export function decidePressureCrisis(
  reading: BloodPressureReading | null,
  values: PressureSafety,
  active: boolean,
  rule: SafetySource,
): Decision | null {
  return decidePressureLimit('BLOOD_PRESSURE_HIGH', reading, values, active, rule)
}

/**
 * Atenção de pressão: uma medição basta, como na revisão, porque a pressão é
 * medida à mão e raramente. Abre com sistólica ou diastólica na faixa de
 * fadiga da pessoa (sistólica primeiro, como na revisão) e fecha quando as
 * duas saem. Sem corte de uma das duas, decide só a outra; sem nenhum, nada.
 */
export function decideBandPressure(
  reading: BloodPressureReading | null,
  cuts: { systolic: number | null; diastolic: number | null },
  active: boolean,
): Decision | null {
  if (reading === null || (cuts.systolic === null && cuts.diastolic === null)) return null
  const kind = 'BLOOD_PRESSURE_FATIGUE'
  const systolicIn = cuts.systolic !== null && reading.systolic >= cuts.systolic
  const diastolicIn = cuts.diastolic !== null && reading.diastolic >= cuts.diastolic

  if (!active) {
    if (systolicIn) {
      return { kind, action: 'OPEN', observedValue: reading.systolic, threshold: band(cuts.systolic as number) }
    }
    if (diastolicIn) {
      return { kind, action: 'OPEN', observedValue: reading.diastolic, threshold: band(cuts.diastolic as number) }
    }
    return null
  }
  if (systolicIn || diastolicIn) return null
  // Como na revisão, a recuperação reporta a sistólica quando ela tem corte.
  return cuts.systolic !== null
    ? { kind, action: 'RECOVER', observedValue: reading.systolic, threshold: band(cuts.systolic) }
    : { kind, action: 'RECOVER', observedValue: reading.diastolic, threshold: band(cuts.diastolic as number) }
}

const band = (cut: number): Threshold => ({ value: cut, rule: 'BAND' })

export type BandDirection = 'HIGHER_IS_WORSE' | 'LOWER_IS_WORSE'

/**
 * Na faixa de fadiga. Quando mais é pior, o corte já é fadiga (a faixa começa
 * "a partir do" percentil); quando menos é pior, a fadiga fica estritamente
 * abaixo dele.
 */
const inFatigue = (value: number, cut: number, direction: BandDirection) =>
  direction === 'HIGHER_IS_WORSE' ? value >= cut : value < cut

/**
 * Atenção contínua no relógio: abre com a janela inteira na faixa de fadiga,
 * pela mesma máquina de persistência do batimento (com a janela de 10 min do
 * perfil calibrado); fecha na primeira leitura de volta, sem banda, porque a
 * persistência de 10 min para reabrir já impede o abre e fecha.
 */
export function decideAttention(
  kind: TelemetryConditionKind,
  points: readonly Point[],
  cut: number,
  direction: BandDirection,
  active: boolean,
  persistence: Persistence,
  nowMs: number,
): Decision | null {
  if (active) {
    const latest = latestOf(points, nowMs)
    if (latest === null || inFatigue(latest.value, cut, direction)) return null
    return { kind, action: 'RECOVER', observedValue: latest.value, threshold: band(cut) }
  }
  const values = sustained(points, nowMs, persistence, (v) => inFatigue(v, cut, direction))
  if (values === null) return null
  return { kind, action: 'OPEN', observedValue: values[values.length - 1], threshold: band(cut) }
}

function latestOf(points: readonly Point[], nowMs: number): Point | null {
  let latest: Point | null = null
  for (const p of points) {
    if (p.atMs <= nowMs && (latest === null || p.atMs > latest.atMs)) latest = p
  }
  return latest
}

/**
 * Atenção de oxigenação: a leitura é pontual e espaçada, então a persistência
 * é de duas leituras seguidas na faixa com `minApartMs` ou mais entre elas.
 * Fecha com a última fora da faixa.
 */
export function decideOxygenAttention(
  latest: Point | null,
  previous: Point | null,
  cut: number,
  active: boolean,
  minApartMs: number,
): Decision | null {
  if (latest === null) return null
  const kind = 'OXYGEN_FATIGUE'
  if (active) {
    if (inFatigue(latest.value, cut, 'LOWER_IS_WORSE')) return null
    return { kind, action: 'RECOVER', observedValue: latest.value, threshold: band(cut) }
  }
  if (previous === null || latest.atMs - previous.atMs < minApartMs) return null
  if (!inFatigue(latest.value, cut, 'LOWER_IS_WORSE') || !inFatigue(previous.value, cut, 'LOWER_IS_WORSE')) return null
  return { kind, action: 'OPEN', observedValue: latest.value, threshold: band(cut) }
}

/** Trava de oxigenação baixa: uma leitura abaixo da abertura abre; acima da recuperação fecha. */
export function decideOxygenLow(
  percent: number | null,
  values: SafetyBand,
  active: boolean,
  rule: SafetySource,
): Decision | null {
  if (percent === null) return null
  const threshold: Threshold = { value: values.openAt, rule }
  if (!active && percent < values.openAt) {
    return { kind: 'OXYGEN_LOW', action: 'OPEN', observedValue: percent, threshold }
  }
  if (active && percent > values.closeAt) {
    return { kind: 'OXYGEN_LOW', action: 'RECOVER', observedValue: percent, threshold }
  }
  return null
}

/** Episódio de um lote (pulseira) percorrido em ordem. */
export interface Episode {
  /** Nulo: a condição já estava aberta antes do lote. */
  openedAtMs: number | null
  /** Nulo: segue ativa na última leitura do lote. */
  recoveredAtMs: number | null
  /** A leitura que abriu; no episódio que já vinha aberto, a que recuperou. */
  observedValue: number
}

/**
 * A pulseira chega em lote, com leituras espaçadas de minutos, e o lote é
 * percorrido em ordem. Fora de episódio, uma sequência de pontos que abrem,
 * sem vão maior que `maxGapMs`, abre quando cobre `holdMs` (com `holdMs` zero,
 * no primeiro ponto, como as travas); dentro, o primeiro ponto que recupera
 * fecha, e reabrir exige a sequência inteira de novo.
 *
 * Os pontos até `sinceMs` (inclusive) já foram avaliados pelo lote anterior:
 * só semeiam a sequência, e o estado em `sinceMs` é `activeAtStart`, que é o
 * que o lote anterior deixou gravado. Assim um segundo lote do mesmo dia não
 * reabre nem refecha o que o primeiro registrou. Episódio que já vinha aberto
 * e segue aberto não é devolvido: não há nada a gravar.
 */
export function episodesOf(
  points: readonly Point[],
  opens: (v: number) => boolean,
  recovers: (v: number) => boolean,
  holdMs: number,
  maxGapMs: number,
  activeAtStart: boolean,
  sinceMs: number,
): Episode[] {
  const sorted = [...points].sort((a, b) => a.atMs - b.atMs)
  const episodes: Episode[] = []
  let current: Episode | null = activeAtStart ? { openedAtMs: null, recoveredAtMs: null, observedValue: Number.NaN } : null
  let runStart: number | null = null
  let previousAt: number | null = null

  for (const p of sorted) {
    const gapBroken = previousAt !== null && p.atMs - previousAt > maxGapMs
    previousAt = p.atMs

    if (current !== null && p.atMs > sinceMs) {
      if (!recovers(p.value)) continue
      current.recoveredAtMs = p.atMs
      // O aberto neste lote já está na lista desde a abertura.
      if (current.openedAtMs === null) episodes.push({ ...current, observedValue: p.value })
      current = null
      runStart = null
      continue
    }
    if (current !== null) continue

    if (!opens(p.value)) {
      runStart = null
      continue
    }
    if (runStart === null || gapBroken) runStart = p.atMs
    if (p.atMs > sinceMs && p.atMs - runStart >= holdMs) {
      current = { openedAtMs: p.atMs, recoveredAtMs: null, observedValue: p.value }
      episodes.push(current)
      runStart = null
    }
  }
  return episodes
}
