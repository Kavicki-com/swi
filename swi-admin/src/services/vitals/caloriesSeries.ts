// Série de gasto calórico do backend traduzida para os pontos do gráfico do
// detalhe. Balde sem medição entre duas medições vira ponto nulo, e o
// LineCaloriesChart do DS interrompe a linha ali: zero aqui é medição de zero,
// nunca ausência.
import type { SeriesPeriod, WorkerSeries } from '@/services/api/telemetry'

export type CaloriesPoint = { time: string; kcal: number | null }

/** Opção do seletor da tela para o período que o backend entende. */
export const PERIOD_FROM_OPTION: Readonly<Record<'today' | 'week' | 'month', SeriesPeriod>> = {
  today: 'day',
  week: 'week',
  month: 'month',
}

// O dia monitorado é o de Brasília no backend; o rótulo segue o mesmo fuso
// para a hora e a data baterem com o balde.
const ZONE = 'America/Sao_Paulo'

const label = (iso: string, bucket: WorkerSeries['bucket']) =>
  bucket === 'hour'
    ? new Date(iso).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: ZONE,
      })
    : new Date(iso).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: ZONE,
      })

export function caloriesPointsFrom(series: WorkerSeries): CaloriesPoint[] {
  const measured = (p: WorkerSeries['points'][number]) => p.activeEnergyKcal !== null
  const first = series.points.findIndex(measured)
  if (first === -1) return []
  // Só o intervalo entre a primeira e a última medição entra: antes e depois
  // não há curva a interromper, e o gráfico abriria com um vazio.
  const last = series.points.length - 1 - [...series.points].reverse().findIndex(measured)
  return series.points.slice(first, last + 1).map((p) => ({
    time: label(p.start, series.bucket),
    kcal: p.activeEnergyKcal === null ? null : Math.round(p.activeEnergyKcal),
  }))
}
