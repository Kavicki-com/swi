import { monitoredDayOf } from '../domain/metric-state'

// Linha de base da avaliação: repouso e máxima por idade. A máxima vem do
// perfil, e sem data de nascimento a avaliação sai indisponível (ADR-0009). O
// repouso medido é a mediana dos dias fechados; enquanto não existe dia
// fechado, entra um repouso provisório (abaixo), marcado como tal na linha e
// no painel, para esforço e desgaste existirem desde o primeiro uso.

/** Mediana dos mínimos diários de BPM dos dias fechados. Nulo sem dia nenhum. */
export function restingFromDailyMinima(dailyMinima: readonly number[]): number | null {
  if (dailyMinima.length === 0) return null
  const sorted = [...dailyMinima].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Teto do repouso provisório: repouso típico de adulto. Quem já mostrou um
 * piso menor, no dia aberto ou na própria sessão, fica com o piso; quem só
 * mostrou batimento acima disso fica com o teto, porque um mínimo alto de
 * poucos minutos de uso diz mais sobre a atividade do que sobre o repouso.
 */
export const PROVISIONAL_RESTING_DEFAULT_BPM = 70

/**
 * Chão do repouso provisório, o mesmo do alerta de batimento baixo: abaixo
 * disso é leitura espúria, não repouso, e um único 20 bpm faria o esforço de
 * todo o dia sair inflado.
 */
export const PROVISIONAL_RESTING_FLOOR_BPM = 40

export type RestingSource = 'measured' | 'provisional'
export type ProvisionalRestingFrom = 'open_day' | 'session' | 'default'

export type RestingBaseline =
  | { restingBpm: number; source: 'measured'; days: number }
  | { restingBpm: number; source: 'provisional'; days: 0; from: ProvisionalRestingFrom }

/**
 * O repouso da linha de base. Medido quando há dia fechado com batimento;
 * provisório enquanto não há, pelo menor batimento plausível já visto (Resumo
 * provisório do dia aberto ou a própria sessão), limitado ao teto padrão.
 */
export function restingBaseline(input: {
  /** Mínimos diários dos dias já fechados, da mesma origem. */
  closedMinima: readonly number[]
  /** Mínimos dos Resumos provisórios, dos dias ainda abertos. */
  openMinima: readonly number[]
  /** Menor batimento da própria sessão de monitoramento, se houver. */
  sessionMinBpm: number | null
}): RestingBaseline {
  const measured = restingFromDailyMinima(input.closedMinima)
  if (measured !== null) return { restingBpm: measured, source: 'measured', days: input.closedMinima.length }

  const plausible = (bpm: number | null): bpm is number => bpm !== null && bpm >= PROVISIONAL_RESTING_FLOOR_BPM
  const openMin = input.openMinima.filter(plausible).reduce<number | null>((m, b) => (m === null || b < m ? b : m), null)
  const sessionMin = plausible(input.sessionMinBpm) ? input.sessionMinBpm : null

  let restingBpm = PROVISIONAL_RESTING_DEFAULT_BPM
  let from: ProvisionalRestingFrom = 'default'
  if (openMin !== null && openMin < restingBpm) {
    restingBpm = openMin
    from = 'open_day'
  }
  if (sessionMin !== null && sessionMin < restingBpm) {
    restingBpm = sessionMin
    from = 'session'
  }
  return { restingBpm, source: 'provisional', days: 0, from }
}

/** Anos completos entre a data de nascimento e o dia monitorado de `at`. */
export function ageInYearsAt(birthDate: Date, at: Date): number {
  const today = monitoredDayOf(at)
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear()
  const beforeBirthday =
    today.getUTCMonth() < birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() < birthDate.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}

/** Tanaka, Monahan e Seals (2001). Estimativa respaldada, não medição. */
export function maxHeartRateForAge(ageYears: number): number {
  return 208 - 0.7 * ageYears
}
