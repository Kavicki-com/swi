import { useCallback, useMemo } from 'react'
import type { DashboardMapMarker } from '@/services/api/dashboard'
import { withHealthStatus } from '@/services/api/positions'
import type { AdminWorkerEntry } from '@/services/api/telemetry'
import { useAdminTelemetry } from './useAdminTelemetry'
import { useLivePositions } from './useLivePositions'

export type LiveMapMarkers = {
  /** Pinos com posição real e cor do estado real; null enquanto carrega. */
  markers: DashboardMapMarker[] | null
  /** A leitura completa de um funcionário, para cartões sobre o mapa. */
  entryFor: (workerId: string) => AdminWorkerEntry | undefined
  /** A telemetria falhou: os pinos ficam neutros até a próxima leitura. */
  telemetryFailed: boolean
}

// Posição e saúde chegam por caminhos diferentes: a posição pelo heartbeat, a
// saúde pela telemetria. Este hook junta os dois sem mexer em coordenada
// nenhuma; quem não tem leitura aparece neutro.
export function useLiveMapMarkers(): LiveMapMarkers {
  const positions = useLivePositions()
  const { workers, failed } = useAdminTelemetry()

  const markers = useMemo(
    () => (positions === null ? null : withHealthStatus(positions, workers)),
    [positions, workers],
  )
  const byId = useMemo(
    () => new Map((workers?.workers ?? []).map((e) => [e.worker.id, e])),
    [workers],
  )
  const entryFor = useCallback((workerId: string) => byId.get(workerId), [byId])

  return { markers, entryFor, telemetryFailed: failed }
}
