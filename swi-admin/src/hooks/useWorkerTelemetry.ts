import { useEffect, useState } from 'react'
import { telemetryApi, type WorkerTelemetry } from '@/services/api/telemetry'

/** Intervalo de releitura enquanto o painel não recebe o aviso por socket. */
export const TELEMETRY_REFRESH_MS = 15_000

export type WorkerTelemetryState = {
  /** null enquanto carrega ou quando a última leitura falhou. */
  telemetry: WorkerTelemetry | null
  /** A última tentativa falhou: a tela diz que a leitura está indisponível. */
  failed: boolean
}

// Estado atual de um funcionário, relido em intervalo fixo. Uma falha limpa a
// leitura anterior em vez de mantê-la: manter faria a tela afirmar "Monitorando
// agora" com um dado que ninguém consegue mais confirmar.
export function useWorkerTelemetry(workerId: string | undefined): WorkerTelemetryState {
  const [state, setState] = useState<WorkerTelemetryState>({ telemetry: null, failed: false })

  useEffect(() => {
    if (!workerId) return
    let cancelled = false
    const load = () => {
      telemetryApi.workerCurrent(workerId).then(({ data, error }) => {
        if (cancelled) return
        setState(
          error || !data ? { telemetry: null, failed: true } : { telemetry: data, failed: false },
        )
      })
    }
    load()
    const timer = setInterval(load, TELEMETRY_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [workerId])

  return state
}
