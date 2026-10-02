// O que o MonitoringLayout entrega às sub-rotas pelo Outlet. Assim a aba de
// boas condições usa o mesmo resumo que o layout já lê, em vez de abrir uma
// segunda leitura da empresa.
import { useOutletContext } from 'react-router-dom'
import type { AdminTelemetrySummary } from '@/services/api/telemetry'

export type MonitoringOutletContext = {
  summary: AdminTelemetrySummary | null
  failed: boolean
}

/** Fora do layout (teste isolado, por exemplo) não há resumo, e a aba mostra ausência. */
export function useMonitoringContext(): MonitoringOutletContext {
  return useOutletContext<MonitoringOutletContext | undefined>() ?? { summary: null, failed: false }
}
