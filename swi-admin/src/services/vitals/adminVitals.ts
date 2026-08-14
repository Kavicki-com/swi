// Vitais e persona do admin logado, para o menu fullscreen do header.
//
// BPM, status e fadiga NÃO são estáticos: saem do MESMO gerador determinístico
// que alimenta o widget do header (useMyVitals com simulatedVitalsFor). O menu
// abre por cima do header, e os dois mostrando bpm diferente para o mesmo admin
// seria uma contradição visível na mesma tela. Mesma pessoa, mesmo número, em
// toda superfície.
//
// mpm, temperatura, bateria, cargo e setor ficam pinados na referência do
// cliente (FRONT-END -SWI.pdf §1.1): nenhuma outra tela exibe esses campos,
// então não há número pra contradizer — e não há telemetria real até a
// smartband existir.
import { useAuth } from '@/hooks/useAuth'
import { simulatedVitalsFor } from './simulatedVitals'

export type AdminVitals = {
  role: string
  sector: string
  heartRate: number
  status: string
  mpm: number
  mpmPercent: number
  fatigueHours: number
  fatigueMinutes: number
  fatiguePercent: number
  temperature: number
  temperatureLabel: string
  temperaturePercent: number
  battery: number
  batteryPercent: number
}

const REFERENCIA = {
  role: 'Engenheiro hidráulico',
  sector: 'Setor Norte n-002',
  mpm: 23,
  mpmPercent: 23,
  temperature: 36.5,
  temperatureLabel: 'excelente',
  temperaturePercent: 72,
  battery: 78,
  batteryPercent: 78,
}

export function useAdminVitals(): AdminVitals {
  const { user } = useAuth()
  const v = simulatedVitalsFor(user?.id ?? 'anon', Date.now())
  return {
    ...REFERENCIA,
    heartRate: v.bpm,
    status: v.statusLabel,
    fatigueHours: Math.floor(v.fatigueMinutes / 60),
    fatigueMinutes: v.fatigueMinutes % 60,
    fatiguePercent: v.fatiguePct,
  }
}
