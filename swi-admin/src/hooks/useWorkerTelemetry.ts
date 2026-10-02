import { useEffect, useState } from 'react'
import { telemetryApi, type WorkerTelemetry } from '@/services/api/telemetry'
import { subscribeTelemetryEvents } from '@/services/telemetry/telemetrySocket'

/** Releitura de segurança, para o caso de o socket cair sem avisar. */
export const TELEMETRY_REFRESH_MS = 15_000

export type WorkerTelemetryState = {
  /** null enquanto carrega ou quando a última leitura falhou. */
  telemetry: WorkerTelemetry | null
  /** A última tentativa falhou: a tela diz que a leitura está indisponível. */
  failed: boolean
}

// Estado atual de um funcionário, relido quando o socket avisa e em intervalo
// fixo de segurança. Uma falha limpa a leitura anterior em vez de mantê-la:
// manter faria a tela afirmar "Monitorando agora" com um dado que ninguém
// consegue mais confirmar.
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
    // O socket avisa que algo mudou e a leitura vem pela API; aviso de outro
    // funcionário não interessa a esta tela.
    const onChange = (ev: { workerId: string }) => {
      if (ev.workerId === workerId) load()
    }
    const unsubscribe = subscribeTelemetryEvents({ onSnapshot: onChange, onCondition: onChange })
    const timer = setInterval(load, TELEMETRY_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      unsubscribe()
    }
  }, [workerId])

  return state
}
