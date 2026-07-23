// VITAIS — MOCK até a smartband (Passo 5 deixou não-vitais real).
//
// O fan-out do dashboard (api/dashboard.ts) sobrepõe estes valores mock sobre os
// dados reais. Tudo aqui depende de biometria/telemetria que só existe com o
// hardware (smartband, câmeras) ou é decorativo (avatares) — segue derivado de
// SEED/ROSTER até o hardware existir. Os agregados legados employees/alerts vêm
// junto porque saem da mesma fonte SEED org-filtrada.
import type { Alert, Employee } from '../types'
import { SEED_ALERTS, SEED_EMPLOYEES } from '../mockApi/seed'
import { ROSTER, type WorkerProfile } from '../mockApi/roster'
import type { DashboardMapMarker, DashboardWearAlert, DashboardWearTier } from './dashboard'
import chatEzequiel from '@/assets/avatars/chat-ezequiel.png'
import chatRomulo from '@/assets/avatars/chat-romulo.png'
import chatJulio from '@/assets/avatars/chat-julio.png'
import chatJennifer from '@/assets/avatars/chat-jennifer.png'

// Worker photos cycled across wear-alert rows and map markers. We use the chat-*
// PNGs (exported from Figma's inner ELLIPSE nodes — pure photo, no border ring)
// instead of worker-a/b/c which have a teal ring baked into the export.
const FIGMA_AVATARS: readonly string[] = [chatEzequiel, chatRomulo, chatJulio, chatJennifer]
const cycleAvatar = (idx: number): string =>
  FIGMA_AVATARS[idx % FIGMA_AVATARS.length] ?? chatEzequiel

// Pick roster workers by id so wear alerts reference the same people as
// /employees, /alerts and /monitoring.
const findRoster = (id: string): WorkerProfile => {
  const p = ROSTER.find((r) => r.id === id)
  if (!p) throw new Error(`Dashboard fixture references unknown roster id: ${id}`)
  return p
}

// KPIs vitais fixos — telemetria de device/câmeras que só existe com o hardware.
// urgentAlerts/commonAlerts NÃO entram aqui: derivam dos alertas SEED org-filtrados
// (ver buildLegacyAggregates) porque variam por org.
export const MOCK_VITAL_KPIS = {
  activeCameras: 564,
  vitalSigns: 512,
  wearRate: 512,
} as const

// Map markers: todo employee com last_location conhecido, com avatar ciclado pra
// o banner do mapa sempre renderizar visuais deterministas. Org-filtrado.
// Consumido pelo Dashboard (MapBanner), MapsGeneral e AlertsList.
export function buildMockMapMarkers(orgId: string): DashboardMapMarker[] {
  return SEED_EMPLOYEES.filter((e) => e.org_id === orgId)
    .filter(
      (e): e is Employee & { last_location: NonNullable<Employee['last_location']> } =>
        e.last_location !== null,
    )
    .map((e, idx) => ({
      id: e.id,
      name: e.full_name,
      lat: e.last_location.lat,
      lng: e.last_location.lng,
      status: e.status,
      avatarUri: cycleAvatar(idx),
    }))
}

// Wear alerts — 8 roster members distribuídos nas 3 abas de tier (Excelentes /
// Desgastados / Alertas de Fadiga). Produção derivaria de um agregado móvel de
// vitais + fadiga; a demo usa valores fixos pra cada tier ter membros previsíveis.
// bpm/pressure representam o agregado do wear-tracker, distinto do snapshot
// instantâneo do worker. Estático (não org-scoped) — igual ao mock antigo.
const WEAR_MEMBERS: ReadonlyArray<{
  rosterId: string
  progress: number
  bpm: number
  pressure: string
  tier: DashboardWearTier
}> = [
  // 2 alerta-fadiga — workers em risco (alto progresso, vitais críticos)
  { rosterId: 'emp-04', progress: 91, bpm: 138, pressure: '16/10', tier: 'alerta-fadiga' }, // Carlos Henrique — critical
  { rosterId: 'emp-10', progress: 88, bpm: 142, pressure: '17/11', tier: 'alerta-fadiga' }, // Marcos Vinícius — critical
  // 3 desgastado — sob carga mas operacional (vitais warning)
  { rosterId: 'emp-02', progress: 74, bpm: 112, pressure: '14/9', tier: 'desgastado' }, // Ana Paula Gomes — warning
  { rosterId: 'emp-06', progress: 68, bpm: 108, pressure: '13/9', tier: 'desgastado' }, // Pedro Martins Lima — warning
  { rosterId: 'emp-08', progress: 62, bpm: 102, pressure: '13/8', tier: 'desgastado' }, // Rafael Oliveira — alto esforço
  // 3 excelente — baixa fadiga, vitais baseline
  { rosterId: 'emp-01', progress: 28, bpm: 92, pressure: '12/8', tier: 'excelente' }, // Larissa Sales
  { rosterId: 'emp-09', progress: 22, bpm: 88, pressure: '12/8', tier: 'excelente' }, // Juliana Costa
  { rosterId: 'emp-12', progress: 18, bpm: 86, pressure: '11/7', tier: 'excelente' }, // Karen Oliveira
]

export const MOCK_WEAR_ALERTS: DashboardWearAlert[] = WEAR_MEMBERS.map((w, idx) => {
  const p = findRoster(w.rosterId)
  return {
    id: `wear_${String(idx + 1).padStart(3, '0')}`,
    employeeName: p.name,
    sector: p.sector,
    progress: w.progress,
    bpm: w.bpm,
    pressure: w.pressure,
    tier: w.tier,
    avatarUri: cycleAvatar(idx),
  }
})

// Agregados legados do topo do DashboardSummary. Não são lidos pela UI hoje
// (Dashboard lê kpis/mapMarkers/activities/wearAlerts/weather; Maps/Alerts leem
// mapMarkers), mas fazem parte do shape e alimentam urgentAlerts/commonAlerts.
// SEED-derivados e org-filtrados — preservam a lógica exata do mock antigo.
export function buildLegacyAggregates(orgId: string): {
  employees: { total: number; byStatus: Record<Employee['status'], number> }
  alerts: { openOrAcknowledged: number; bySeverity: Record<Alert['severity'], number> }
} {
  const employees = SEED_EMPLOYEES.filter((e) => e.org_id === orgId)
  const alerts = SEED_ALERTS.filter((a) => a.org_id === orgId)

  const byStatus: Record<Employee['status'], number> = { good: 0, alert: 0, low: 0, offline: 0 }
  employees.forEach((e) => {
    byStatus[e.status] += 1
  })

  const bySeverity: Record<Alert['severity'], number> = { info: 0, warning: 0, critical: 0 }
  const openOrAck = alerts.filter((a) => a.state === 'open' || a.state === 'acknowledged')
  openOrAck.forEach((a) => {
    bySeverity[a.severity] += 1
  })

  return {
    employees: { total: employees.length, byStatus },
    alerts: { openOrAcknowledged: openOrAck.length, bySeverity },
  }
}
