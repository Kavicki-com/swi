import { useCallback, useEffect, useRef, useState } from 'react'
import {
  telemetryApi,
  type AdminTelemetrySummary,
  type AdminWorkersTelemetry,
} from '@/services/api/telemetry'
import { subscribeTelemetryEvents } from '@/services/telemetry/telemetrySocket'

/**
 * Espera depois do último aviso do socket antes de reler: vários relógios
 * reportando juntos viram uma releitura, não uma por evento.
 */
export const ADMIN_TELEMETRY_DEBOUNCE_MS = 1_000

/** Releitura de segurança, para o caso de o socket cair sem avisar. */
export const ADMIN_TELEMETRY_REFRESH_MS = 30_000

export type AdminTelemetryState = {
  /** Todos os funcionários da empresa; null carregando ou após falha. */
  workers: AdminWorkersTelemetry | null
  /** Resumo da empresa; null carregando ou após falha. */
  summary: AdminTelemetrySummary | null
  /** Ainda não houve nenhuma resposta. */
  loading: boolean
  /** A última tentativa falhou: a tela diz que a leitura está indisponível. */
  failed: boolean
}

// Estado da empresa para dashboard, monitoramento e mapas. Relê quando o
// socket avisa que algo mudou e, por segurança, em intervalo fixo. Uma falha
// limpa os dados em vez de mantê-los: manter faria o painel afirmar um estado
// que ninguém consegue mais confirmar.
export function useAdminTelemetry(): AdminTelemetryState & { refresh: () => void } {
  const [state, setState] = useState<AdminTelemetryState>({
    workers: null,
    summary: null,
    loading: true,
    failed: false,
  })
  const cancelled = useRef(false)

  const load = useCallback(() => {
    void Promise.all([telemetryApi.adminWorkers(), telemetryApi.adminSummary()]).then(
      ([workers, summary]) => {
        if (cancelled.current) return
        const ok = !workers.error && !summary.error && workers.data && summary.data
        setState(
          ok
            ? { workers: workers.data, summary: summary.data, loading: false, failed: false }
            : { workers: null, summary: null, loading: false, failed: true },
        )
      },
    )
  }, [])

  useEffect(() => {
    cancelled.current = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(debounce)
      debounce = setTimeout(load, ADMIN_TELEMETRY_DEBOUNCE_MS)
    }
    load()
    const unsubscribe = subscribeTelemetryEvents({ onSnapshot: schedule, onCondition: schedule })
    const timer = setInterval(load, ADMIN_TELEMETRY_REFRESH_MS)
    return () => {
      cancelled.current = true
      clearTimeout(debounce)
      clearInterval(timer)
      unsubscribe()
    }
  }, [load])

  return { ...state, refresh: load }
}
