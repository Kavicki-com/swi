import { useEffect, useState } from 'react'
import { telemetryApi, type SeriesPeriod } from '@/services/api/telemetry'
import { caloriesPointsFrom, type CaloriesPoint } from '@/services/vitals/caloriesSeries'

export type WorkerSeriesState = {
  points: CaloriesPoint[]
  loading: boolean
  /** A leitura falhou: a tela diz que está indisponível, não que não há dado. */
  failed: boolean
  /** Sem funcionário com aparelho (administrador): não há série a buscar. */
  noDevice: boolean
}

// Gasto calórico do período escolhido. Sem funcionário a página não busca
// nada: administrador não pareia aparelho, e uma curva ali seria inventada.
export function useWorkerSeries(
  workerId: string | undefined,
  period: SeriesPeriod,
): WorkerSeriesState {
  const [state, setState] = useState<WorkerSeriesState>(() =>
    workerId
      ? { points: [], loading: true, failed: false, noDevice: false }
      : { points: [], loading: false, failed: false, noDevice: true },
  )

  useEffect(() => {
    if (!workerId) {
      setState({ points: [], loading: false, failed: false, noDevice: true })
      return
    }
    let cancelled = false
    setState({ points: [], loading: true, failed: false, noDevice: false })
    telemetryApi.workerSeries(workerId, period).then(({ data, error }) => {
      if (cancelled) return
      setState(
        error || !data
          ? { points: [], loading: false, failed: true, noDevice: false }
          : { points: caloriesPointsFrom(data), loading: false, failed: false, noDevice: false },
      )
    })
    return () => {
      cancelled = true
    }
  }, [workerId, period])

  return state
}
