// Percentil e mediana das faixas de calibração. Um lugar só para o Resumo
// diário e para o recálculo: os dois precisam concordar sobre o que é o p25
// de um dia, senão a faixa aprendida não bate com o dado guardado.
//
// Nearest-rank, sem interpolar: o corte é sempre um valor que a pessoa de fato
// registrou, e o mesmo conjunto dá o mesmo número em qualquer ordem.

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)))
  return sorted[rank - 1]
}

/** Mediana com média dos dois do meio, a mesma regra de `restingFromDailyMinima`. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
