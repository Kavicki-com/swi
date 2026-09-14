import type { AssessmentProfile } from './assessment-profile'

export interface FormulaState {
  strainDose: number
  effortEma: number | null
  lastHeartRate: { bpm: number; atMs: number } | null
  lastSampleAtMs: number | null
}

export interface FormulaSample {
  atMs: number
  heartRateBpm: number | null
  /** Picos de movimento desde a amostra anterior. */
  motionCount: number | null
}

export type BaselineUnavailableReason = 'no_resting_baseline' | 'no_birth_date'
export type UnavailableReason = BaselineUnavailableReason | 'no_heart_rate'

export type Baseline =
  | { kind: 'available'; restingBpm: number; maxBpm: number }
  | { kind: 'unavailable'; reason: BaselineUnavailableReason }

export interface FormulaInput {
  profile: AssessmentProfile
  previous: FormulaState | null
  baseline: Baseline
  /** Em ordem crescente de atMs, todas dentro da janela. */
  samples: readonly FormulaSample[]
  window: { startMs: number; endMs: number }
  /**
   * Percentual de desgaste em que o alerta abre. Vem do perfil de alertas,
   * por parâmetro: a fórmula não conhece o perfil de alertas, e o número
   * gravado em inputs diz contra o que os minutos foram calculados.
   */
  wearAlertPercent: number
}

export interface FormulaResult {
  effortPercent: number | null
  wearPercent: number | null
  /** Minutos até o desgaste cruzar wearAlertPercent. Nulo: não se aproxima. */
  fatigueEtaMin: number | null
  nextState: FormulaState
  unavailableReason: UnavailableReason | null
  motionAvailable: boolean
  reusedHeartRate: boolean
}

export const INITIAL_STATE: FormulaState = Object.freeze({
  strainDose: 0,
  effortEma: null,
  lastHeartRate: null,
  lastSampleAtMs: null,
})

const MINUTE_MS = 60_000

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Alfa da média móvel para um intervalo real, a partir do alfa por 15 s. */
function alphaFor(dtMs: number, alphaPer15s: number): number {
  if (dtMs <= 0) return alphaPer15s
  return 1 - (1 - alphaPer15s) ** (dtMs / 15_000)
}

function decayed(dose: number, elapsedMs: number, decayMinutes: number): number {
  if (elapsedMs <= 0) return dose
  return dose * Math.exp(-(elapsedMs / MINUTE_MS) / decayMinutes)
}

function wearOf(dose: number, doseScale: number): number {
  return Math.round(100 * (1 - Math.exp(-dose / doseScale)))
}

/**
 * Minutos até o desgaste cruzar o limiar do alerta, mantida a intensidade
 * recente. É a forma fechada da própria dinâmica da dose: com intensidade
 * constante I, a dose obedece dD/dt = I^e - D/tau (por minuto) e tende a
 * D_ss = tau * I^e; a solução é D(t) = D_ss + (D0 - D_ss) e^(-t/tau), e o
 * instante em que ela cruza a dose alvo D* é t = tau ln((D_ss - D0)/(D_ss - D*)).
 *
 * A dose alvo é a MENOR dose cuja porcentagem arredonda para o limiar, e não
 * a dose do limiar exato: a condição abre pelo percentual arredondado, e o
 * número nunca pode dizer "faltam dois minutos" com a condição já aberta.
 *
 * Nulo quando não há intensidade recente, quando a intensidade não sustenta a
 * dose até o alvo (D_ss <= D*: a projeção nunca chega, e a tela diz "não se
 * aproxima") ou quando a chegada está além do horizonte do perfil. Zero quando
 * a dose já passou do alvo: a chegada é agora.
 */
export function fatigueEtaMinutes(
  state: Pick<FormulaState, 'strainDose' | 'effortEma'>,
  profile: AssessmentProfile,
  wearAlertPercent: number,
): number | null {
  if (state.effortEma === null) return null
  const targetDose = -profile.doseScale * Math.log(1 - (wearAlertPercent - 0.5) / 100)
  if (state.strainDose >= targetDose) return 0
  const intensity = clamp(state.effortEma, 0, profile.intensityCeiling)
  const steadyDose = profile.decayMinutes * intensity ** profile.doseExponent
  if (steadyDose <= targetDose) return null
  const minutes =
    profile.decayMinutes * Math.log((steadyDose - state.strainDose) / (steadyDose - targetDose))
  if (minutes > profile.fatigueEtaHorizonMinutes) return null
  return Math.round(minutes)
}

/**
 * Uma janela de avaliação. Pura: tudo que precisa vem do input, e o próximo
 * estado sai no resultado. A cadeia por sessão é quem liga uma janela à outra.
 *
 * O decaimento da dose usa sempre o tempo real decorrido; o acréscimo só conta
 * intervalos de até gapMaxMs. Lacuna nunca vira esforço, pela mesma regra que
 * o resumidor usa para tempo coberto.
 */
export function assessWindow(input: FormulaInput): FormulaResult {
  const { profile, baseline, samples, window } = input
  const state = input.previous ?? INITIAL_STATE
  let cursorMs = state.lastSampleAtMs ?? window.startMs
  let dose = state.strainDose
  let ema = state.effortEma
  let lastHeartRate = state.lastHeartRate
  let motionAvailable = false
  let reusedHeartRate = false
  let heartRateSeen = false

  for (const s of samples) {
    const dtMs = Math.max(0, s.atMs - cursorMs)
    dose = decayed(dose, dtMs, profile.decayMinutes)

    let bpm = s.heartRateBpm
    if (bpm === null) {
      if (lastHeartRate !== null && s.atMs - lastHeartRate.atMs <= profile.heartRateReuseMs) {
        bpm = lastHeartRate.bpm
        reusedHeartRate = true
      }
    } else {
      lastHeartRate = { bpm, atMs: s.atMs }
    }

    if (bpm !== null && baseline.kind === 'available') {
      heartRateSeen = true
      const reserve = Math.max(1, baseline.maxBpm - baseline.restingBpm)
      const hrr = clamp((bpm - baseline.restingBpm) / reserve, 0, profile.intensityCeiling)

      let intensity = hrr
      if (s.motionCount !== null && dtMs > 0) {
        const peaksPerMinute = s.motionCount / (dtMs / MINUTE_MS)
        const motionIndex = clamp(peaksPerMinute / profile.peaksPerMinuteScale, 0, profile.intensityCeiling)
        intensity = clamp(profile.hrrWeight * hrr + profile.motionWeight * motionIndex, 0, profile.intensityCeiling)
        motionAvailable = true
      }

      const alpha = alphaFor(dtMs, profile.emaAlphaPer15s)
      ema = ema === null ? intensity : ema + alpha * (intensity - ema)

      if (dtMs <= profile.gapMaxMs) {
        dose += Math.max(0, intensity) ** profile.doseExponent * (dtMs / MINUTE_MS)
      }
    }

    cursorMs = s.atMs
  }

  dose = decayed(dose, window.endMs - cursorMs, profile.decayMinutes)

  const nextState: FormulaState = {
    strainDose: dose,
    effortEma: ema,
    lastHeartRate,
    lastSampleAtMs: Math.max(cursorMs, window.endMs),
  }

  if (baseline.kind === 'unavailable') {
    return {
      effortPercent: null,
      wearPercent: null,
      fatigueEtaMin: null,
      nextState,
      unavailableReason: baseline.reason,
      motionAvailable: false,
      reusedHeartRate: false,
    }
  }

  return {
    effortPercent: heartRateSeen && ema !== null ? Math.round(100 * clamp(ema, 0, 1)) : null,
    wearPercent: wearOf(dose, profile.doseScale),
    // Acompanha o esforço: sem BPM na janela não há intensidade recente que
    // valha uma projeção, mesmo que a média móvel antiga ainda exista.
    fatigueEtaMin: heartRateSeen ? fatigueEtaMinutes(nextState, profile, input.wearAlertPercent) : null,
    nextState,
    unavailableReason: heartRateSeen ? null : 'no_heart_rate',
    motionAvailable,
    reusedHeartRate,
  }
}
