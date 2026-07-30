// src/services/mockApi/adminVitals.ts
// Vitais + persona do admin logado pro menu fullscreen do header (QA cliente
// §1.1, portado do demo em 2026-07-28).
//
// BPM, status e fadiga NÃO são estáticos: saem do MESMO gerador determinístico
// que alimenta o widget do header (useMyVitals → simulatedVitalsFor). O menu
// abre por cima do header — os dois mostrando bpm diferente pro mesmo admin
// seria exatamente a classe de contradição que o QA de volume 2026-07-26
// eliminou. Mesma pessoa, mesmo número, em toda superfície.
//
// mpm, temperatura, bateria, cargo e setor ficam pinados na referência do
// cliente (FRONT-END -SWI.pdf §1.1): nenhuma outra tela exibe esses campos,
// então não há número pra contradizer — e não há telemetria real até a
// smartband existir.
import { useAuth } from '@/hooks/useAuth'
import { simulatedVitalsFor } from '@/services/vitals/simulatedVitals'

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
