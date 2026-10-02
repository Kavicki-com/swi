import { useEffect, useState } from 'react'
import { telemetryDevicesApi } from '@/services/api/telemetryDevices'
import type { WorkerTelemetry } from '@/services/api/telemetry'
import { useWorkerTelemetry } from './useWorkerTelemetry'

export type PairedDeviceState = 'loading' | 'none' | 'paired'

export type PairedTelemetryState = {
  device: PairedDeviceState
  telemetry: WorkerTelemetry | null
  /** A consulta do aparelho ou da leitura falhou. */
  failed: boolean
}

// Estado do aparelho de uma pessoa e, se ela tiver um pareado, a leitura dela.
// Responde à pergunta que importa antes de qualquer vital: há de onde vir o
// dado? Vale para funcionário e para admin, sem precisar saber o papel.
export function usePairedTelemetry(userId: string | undefined): PairedTelemetryState {
  const [device, setDevice] = useState<PairedDeviceState>('loading')
  const [deviceFailed, setDeviceFailed] = useState(false)

  useEffect(() => {
    setDevice('loading')
    setDeviceFailed(false)
    if (!userId) return
    let cancelled = false
    telemetryDevicesApi.stateOf(userId).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) {
        setDeviceFailed(true)
        return
      }
      setDevice(data.device ? 'paired' : 'none')
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Só lê telemetria de quem tem aparelho: sem ele não há o que buscar.
  const { telemetry, failed } = useWorkerTelemetry(device === 'paired' ? userId : undefined)
  return { device, telemetry, failed: deviceFailed || failed }
}
