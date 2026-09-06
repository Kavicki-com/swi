import { FRESHNESS } from '../domain/metric-state'

// Perfil da fórmula: o conjunto versionado de coeficientes com que uma
// avaliação foi calculada. Os números da pesquisa de 2026-08-28 são parâmetros
// SWI, não constantes fisiológicas; ficam aqui para a calibração (Task 10b)
// mexer num lugar só. Toda avaliação grava o perfil inteiro em inputs.
//
// A versão é literal e fixada por teste: mudar coeficiente sem mudar versão é
// proibido, porque a cadeia por sessão compara versão para saber se o estado
// anterior ainda vale.

export const FORMULA_VERSION = 'swi-fatigue-experimental-1'

export interface AssessmentProfile {
  readonly version: string
  /** Pesos da combinação: reserva de frequência cardíaca e movimento. */
  readonly hrrWeight: number
  readonly motionWeight: number
  /** Picos por minuto que valem índice de movimento 1,0. */
  readonly peaksPerMinuteScale: number
  /** Teto de HRR, índice de movimento e intensidade. */
  readonly intensityCeiling: number
  /** Alfa da média móvel do esforço, definido para amostra a cada 15 s. */
  readonly emaAlphaPer15s: number
  /** Constante de tempo do decaimento da dose de desgaste. */
  readonly decayMinutes: number
  /** Expoente da intensidade na dose: penaliza intensidade alta mais que moderada. */
  readonly doseExponent: number
  /** Escala do mapeamento dose para percentual. */
  readonly doseScale: number
  /** Dias fechados olhados para o repouso observado. */
  readonly restingDays: number
  /** Intervalo máximo entre amostras que ainda acrescenta dose. */
  readonly gapMaxMs: number
  /** Idade máxima de um BPM para ser reaproveitado numa janela sem leitura. */
  readonly heartRateReuseMs: number
  /** Quanto a primeira janela de uma cadeia olha para trás. */
  readonly chainLookbackMs: number
}

export const EXPERIMENTAL_PROFILE: AssessmentProfile = Object.freeze({
  version: FORMULA_VERSION,
  hrrWeight: 0.75,
  motionWeight: 0.25,
  peaksPerMinuteScale: 90,
  intensityCeiling: 1.2,
  emaAlphaPer15s: 0.35,
  decayMinutes: 180,
  doseExponent: 1.6,
  doseScale: 120,
  restingDays: 14,
  // Os três abaixo referenciam o domínio de propósito: lacuna e reaproveitamento
  // são a mesma fronteira que separa "atual", "desatualizado" e "indisponível".
  gapMaxMs: FRESHNESS.VITAL.staleMs,
  heartRateReuseMs: FRESHNESS.VITAL.currentMs,
  chainLookbackMs: FRESHNESS.VITAL.staleMs,
})
