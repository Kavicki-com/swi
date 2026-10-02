// Série de gasto calórico do backend traduzida para os pontos do gráfico do
// detalhe. O LineCaloriesChart do DS só aceita número por ponto, então balde
// sem medição fica fora da curva em vez de entrar como zero: zero aqui é
// medição de zero, nunca ausência.
import type { SeriesPeriod, WorkerSeries } from '@/services/api/telemetry'

export type CaloriesPoint = { time: string; kcal: number }

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
  return series.points
    .filter((p) => p.activeEnergyKcal !== null)
    .map((p) => ({
      time: label(p.start, series.bucket),
      kcal: Math.round(p.activeEnergyKcal as number),
    }))
}
