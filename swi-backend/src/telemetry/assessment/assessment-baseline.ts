import { monitoredDayOf } from '../domain/metric-state'

// Linha de base da avaliação: repouso observado e máxima por idade. Os dois
// vêm do próprio funcionário (Resumo do dia e perfil), nunca de constante.
// Sem um deles a avaliação sai indisponível, pela ADR-0009.

/** Mediana dos mínimos diários de BPM dos dias fechados. Nulo sem dia nenhum. */
export function restingFromDailyMinima(dailyMinima: readonly number[]): number | null {
  if (dailyMinima.length === 0) return null
  const sorted = [...dailyMinima].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
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
