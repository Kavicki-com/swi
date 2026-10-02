// Vitais e cadastro do admin logado, para o menu fullscreen do header.
//
// Nada aqui é inventado: cargo e setor vêm do cadastro do próprio admin, e os
// vitais só aparecem quando ele tem aparelho pareado. Hoje só funcionário
// pareia, então na prática o menu diz "Sem aparelho"; se um admin parear, a
// mesma leitura do detalhe do funcionário passa a valer aqui.
import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { usePairedTelemetry, type PairedDeviceState } from '@/hooks/usePairedTelemetry'
import { adminsApi } from '@/services/api/users'
import type { WorkerTelemetry } from '@/services/api/telemetry'
import { NO_VALUE, vitalsViewFrom } from './vitalsView'

export type AdminMenuVitals = {
  role: string | null
  sector: string | null
  heartRate: string
  /** O traçado de batimento só anima com leitura atual. */
  showPulse: boolean
  status: string
  mpm: string
  mpmPercent: number
  fatigue: string
  fatiguePercent: number
  temperature: string
  temperaturePercent: number
  battery: string
  batteryPercent: number
}

type DeviceState = PairedDeviceState

export function adminMenuVitalsFrom(input: {
  profile: { role: string; sector: string } | null
  device: DeviceState
  telemetry: WorkerTelemetry | null
  failed: boolean
}): AdminMenuVitals {
  const { profile, device, telemetry, failed } = input
  const view = vitalsViewFrom(device === 'paired' ? telemetry : null, {
    noDevice: device !== 'paired',
    failed,
  })
  const m = device === 'paired' && telemetry ? telemetry.metrics : null
  const mpm = m?.movementPerMinute.value ?? null
  const battery = m?.battery.value ?? null
  const temperature = m?.bodyTemperature.value ?? null
  return {
    role: profile?.role ?? null,
    sector: profile?.sector ?? null,
    heartRate: view.heartRate ?? NO_VALUE,
    showPulse: view.heartRate !== null && m?.heartRate.quality === 'CURRENT',
    status: view.status,
    mpm: mpm === null ? NO_VALUE : `${Math.round(mpm)} mpm`,
    mpmPercent: mpm === null ? 0 : Math.min(100, Math.max(0, mpm)),
    fatigue: view.fatigueEta.label,
    fatiguePercent: view.wearPct ?? 0,
    temperature: temperature === null ? NO_VALUE : `${temperature.toFixed(1).replace('.', ',')}°C`,
    // Temperatura não tem escala de 0 a 100 que faça sentido: a barra fica vazia.
    temperaturePercent: 0,
    battery: battery === null ? NO_VALUE : `${Math.round(battery)}%`,
    batteryPercent: battery === null ? 0 : Math.min(100, Math.max(0, battery)),
  }
}

// `enabled` deixa a busca para quando o menu abre: ele fica montado no layout
// o tempo todo, e buscar cadastro e aparelho em toda página seria desperdício.
export function useAdminVitals(enabled = true): AdminMenuVitals {
  const { user } = useAuth()
  const userId = enabled ? user?.id : undefined
  const [profile, setProfile] = useState<{ role: string; sector: string } | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    adminsApi.get(userId).then(({ data }) => {
      if (!cancelled && data) setProfile({ role: data.role, sector: data.specialization })
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const { device, telemetry, failed } = usePairedTelemetry(userId)
  return adminMenuVitalsFrom({ profile, device, telemetry, failed })
}
