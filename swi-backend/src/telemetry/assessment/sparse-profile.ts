import { EXPERIMENTAL_PROFILE } from './assessment-profile'

// Perfil da fórmula esparsa, a da pulseira lida pelo Health Connect. Separado
// do perfil do relógio porque a entrada é outra: leituras espaçadas de minutos,
// em lote, sem contagem de movimento, recalculadas do começo do dia a cada
// sincronização. Os coeficientes de dose e de média móvel são os mesmos do
// relógio de propósito: o desgaste da pulseira tem de ser comparável ao dele.
//
// Mesma regra do perfil do relógio: mudar número sem mudar versão é proibido.

// sparse-2: mesmos coeficientes da sparse-1; a régua passa a ser a da
// calibração individual, e o repouso provisório grava de onde veio.
export const SPARSE_FORMULA_VERSION = 'swi-fatigue-sparse-2'

/** Prefixo comum a todas as versões da esparsa, para as linhas antigas seguirem reconhecidas. */
export const SPARSE_FORMULA_PREFIX = 'swi-fatigue-sparse-'

export interface SparseProfile {
  readonly version: string
  readonly intensityCeiling: number
  readonly emaAlphaPer15s: number
  readonly decayMinutes: number
  readonly doseExponent: number
  readonly doseScale: number
  readonly restingDays: number
  /**
   * Intervalo máximo entre leituras que ainda acrescenta dose. Dez minutos e
   * não os dois do relógio: a pulseira grava batimento a cada poucos minutos
   * fora de treino, e com dois minutos ela nunca acumularia desgaste.
   */
  readonly gapMaxMs: number
}

export const SPARSE_PROFILE: SparseProfile = Object.freeze({
  version: SPARSE_FORMULA_VERSION,
  intensityCeiling: EXPERIMENTAL_PROFILE.intensityCeiling,
  emaAlphaPer15s: EXPERIMENTAL_PROFILE.emaAlphaPer15s,
  decayMinutes: EXPERIMENTAL_PROFILE.decayMinutes,
  doseExponent: EXPERIMENTAL_PROFILE.doseExponent,
  doseScale: EXPERIMENTAL_PROFILE.doseScale,
  restingDays: EXPERIMENTAL_PROFILE.restingDays,
  gapMaxMs: 10 * 60_000,
})

export const isSparseFormula = (version: string): boolean => version.startsWith(SPARSE_FORMULA_PREFIX)
