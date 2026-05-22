// src/services/mockApi/adminVitals.ts
// Mock vitals + persona snapshot for the logged-in admin, consumed by the
// header user-details menu (QA cliente §1.1). Name comes from useAuth; this
// hook layers the role/sector/heart-rate/mpm/fatigue/temperature/battery
// fields the menu renders. Static values pinned to the client reference
// (FRONT-END -SWI.pdf §1.1 + dashboard.html mockup) so the demo feels live
// without wiring real smartband telemetry.

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

const VITALS: AdminVitals = {
  role: 'Engenheiro hidráulico',
  sector: 'Setor Norte n-002',
  heartRate: 72,
  status: 'perfeitas condições',
  mpm: 23,
  mpmPercent: 23,
  fatigueHours: 3,
  fatigueMinutes: 13,
  fatiguePercent: 68,
  temperature: 36.5,
  temperatureLabel: 'excelente',
  temperaturePercent: 72,
  battery: 78,
  batteryPercent: 78,
}

export function useAdminVitals(): AdminVitals {
  return VITALS
}
