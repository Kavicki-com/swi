import { useAuth } from '@/hooks/useAuth'
import { usePairedTelemetry, type PairedDeviceState } from '@/hooks/usePairedTelemetry'
import type { WorkerTelemetry } from '@/services/api/telemetry'
import { vitalsViewFrom } from '@/services/vitals/vitalsView'

export type MyVitals = { bpm: number | null; pressure: string | null; progress: number | null }

/**
 * Vitais do widget do cabeçalho a partir do aparelho e da leitura do usuário
 * logado. Sem aparelho pareado tudo é ausência (null), e o HeaderUserInfo do
 * DS mostra o marcador de sem leitura em vez de um número que ninguém mediu.
 */
export function myVitalsFrom(device: PairedDeviceState, telemetry: WorkerTelemetry | null): MyVitals {
  const view = vitalsViewFrom(device === 'paired' ? telemetry : null)
  return {
    bpm: view.heartRate === null ? null : Number(view.heartRate),
    pressure: view.pressure,
    progress: view.wearPct,
  }
}

/**
 * Vitais do usuário LOGADO pro widget do header. Admin não pareia aparelho,
 * então na prática o widget mostra a ausência; se um admin parear, vale a
 * mesma leitura do detalhe do funcionário.
 */
export function useMyVitals(): MyVitals {
  const { user } = useAuth()
  const { device, telemetry } = usePairedTelemetry(user?.id)
  return myVitalsFrom(device, telemetry)
}
