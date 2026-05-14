import type { Alert, Employee } from '../types'
import { SEED_ALERTS, SEED_EMPLOYEES } from './seed'
import { ROSTER, type WorkerProfile } from './roster'
import { sleep } from './sleep'
import type { MockResponse } from './types'
import chatEzequiel from '@/assets/avatars/chat-ezequiel.png'
import chatRomulo from '@/assets/avatars/chat-romulo.png'
import chatJulio from '@/assets/avatars/chat-julio.png'
import chatJennifer from '@/assets/avatars/chat-jennifer.png'

// Worker photos cycled across activity participants and wear-alert rows.
// We use the chat-* PNGs (exported from Figma's inner ELLIPSE nodes — pure
// photo, no border ring) instead of worker-a/b/c which have a teal ring
// baked into the export and would double up with the Avatar's bordered prop.
const FIGMA_AVATARS: readonly string[] = [chatEzequiel, chatRomulo, chatJulio, chatJennifer]
const cycleAvatar = (idx: number): string =>
  FIGMA_AVATARS[idx % FIGMA_AVATARS.length] ?? chatEzequiel

// Helpers — pick roster workers by sector / id so dashboard activities and
// wear alerts reference the same people as /employees, /alerts and /monitoring.
const rosterBySector = (sector: string): ReadonlyArray<WorkerProfile> =>
  ROSTER.filter((p) => p.sector === sector)
const findRoster = (id: string): WorkerProfile => {
  const p = ROSTER.find((r) => r.id === id)
  if (!p) throw new Error(`Dashboard fixture references unknown roster id: ${id}`)
  return p
}

export type DashboardActivityStatus = 'em-curso' | 'concluida' | 'a-fazer'

/**
 * Activity risk level — drives the ProgressBar fill color independently of
 * status. Figma frame 4:2 mocks 5 cards under "Em Andamento" with mixed
 * progress colors (green/orange/red) reflecting urgency, not progress.
 */
export type DashboardActivityRisk = 'normal' | 'warning' | 'critical'

export type DashboardActivity = {
  id: string
  title: string
  sector: string
  status: DashboardActivityStatus
  risk?: DashboardActivityRisk
  participants: Array<{ uri?: string; alt?: string }>
  /**
   * Total participants when the team is larger than `participants` shows.
   * AvatarGroup renders the visible avatars plus a `+N` overflow chip when
   * this exceeds `maxVisible`. Falls back to `participants.length` when omitted.
   */
  totalParticipants?: number
  progress: number
  locationLabel?: string
}

// Wear tier groups workers into the filter tabs the dashboard shows
// (Excelentes / Desgastados / Alertas de Fadiga). Production would derive
// this from a sliding-window aggregate of vitals + fatigue. Demo uses it
// as a static field so each tier has predictable members.
export type DashboardWearTier = 'excelente' | 'desgastado' | 'alerta-fadiga'

export type DashboardWearAlert = {
  id: string
  employeeName: string
  sector: string
  progress: number
  bpm: number
  pressure: string
  tier: DashboardWearTier
  avatarUri?: string
}

export type DashboardMapMarker = {
  id: string
  name: string
  lat: number
  lng: number
  status: Employee['status']
  avatarUri: string
}

export type DashboardSummary = {
  employees: {
    total: number
    byStatus: Record<Employee['status'], number>
  }
  alerts: {
    openOrAcknowledged: number
    bySeverity: Record<Alert['severity'], number>
  }
  // S1.7 KPI row aggregates. Mocked counts; S2 sources from real biometrics + alert pipeline.
  kpis: {
    admins: number
    totalEmployees: number
    newReports: number
    activeCameras: number
    vitalSigns: number
    wearRate: number
    urgentAlerts: number
    commonAlerts: number
  }
  mapMarkers: DashboardMapMarker[]
  activities: DashboardActivity[]
  wearAlerts: DashboardWearAlert[]
  weather: Array<{
    at: string
    condition: 'sun' | 'rain' | 'storm'
    tempC: number
    label?: string
    isNow?: boolean
  }>
}

export const dashboardApi = {
  summary: async ({ orgId }: { orgId: string }): Promise<MockResponse<DashboardSummary>> => {
    await sleep(120)
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

    // Map markers: every employee with a known last_location, with a cycled avatar so
    // the map banner always renders deterministic visuals. S2 will source real coords.
    const mapMarkers: DashboardMapMarker[] = employees
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

    // Activities fixture — 8 ongoing ops across sectors. Participants are
    // pulled from the canonical ROSTER so the same Larissa/Ana Paula/Carlos
    // Henrique that appear in /employees, /alerts and /monitoring also lead
    // and join activities here. Avatars stay on the chat-* photos (no border
    // ring) — see FIGMA_AVATARS rationale above.
    const partsFor = (sector: string, take = 5): { uri?: string; alt?: string }[] =>
      rosterBySector(sector)
        .slice(0, take)
        .map((p, idx) => ({ uri: cycleAvatar(idx), alt: p.name }))
    const activities: DashboardActivity[] = [
      // 4 em-curso — visible on the default "Em Andamento" tab.
      {
        id: 'act_001',
        title: 'Reparo',
        sector: 'Setor Leste',
        status: 'em-curso',
        progress: 84,
        locationLabel: 'Setor Leste',
        // Figma card 1: 5 avatars visible + "+13" overflow chip = 18 total.
        participants: partsFor('Setor Leste'),
        totalParticipants: 18,
      },
      {
        id: 'act_002',
        title: 'Reparo',
        sector: 'Setor Oeste',
        status: 'em-curso',
        risk: 'critical',
        progress: 2,
        locationLabel: 'Setor Oeste',
        // Sector includes Carlos Henrique (vitalsStatus critical) → card
        // surfaces the risk so the operator sees the link between activity
        // progress and worker condition.
        participants: partsFor('Setor Oeste'),
      },
      {
        id: 'act_003',
        title: 'Alocação de maquinário',
        sector: 'Setor Leste',
        status: 'em-curso',
        risk: 'warning',
        progress: 60,
        locationLabel: 'Setor Leste',
        participants: partsFor('Setor Leste'),
      },
      {
        id: 'act_004',
        title: 'Manutenção preventiva',
        sector: 'Setor Norte',
        status: 'em-curso',
        risk: 'critical',
        progress: 22,
        locationLabel: 'Setor Norte',
        // Sector includes Marcos Vinícius (vitalsStatus critical).
        participants: partsFor('Setor Norte'),
        totalParticipants: 12,
      },
      // 2 concluídas — populate the "Concluídas" filter tab.
      {
        id: 'act_005',
        title: 'Inspeção semanal',
        sector: 'Setor Sul',
        status: 'concluida',
        progress: 100,
        locationLabel: 'Setor Sul',
        participants: partsFor('Setor Sul'),
      },
      {
        id: 'act_006',
        title: 'Auditoria de segurança',
        sector: 'Setor Sul',
        status: 'concluida',
        progress: 100,
        locationLabel: 'Setor Sul',
        participants: partsFor('Setor Sul'),
      },
      // 2 a-fazer — populate the "A Fazer" filter tab.
      {
        id: 'act_007',
        title: 'Sondagem geológica',
        sector: 'Setor Oeste',
        status: 'a-fazer',
        progress: 0,
        locationLabel: 'Setor Oeste',
        participants: partsFor('Setor Oeste'),
      },
      {
        id: 'act_008',
        title: 'Treinamento NR-22',
        sector: 'Setor Leste',
        status: 'a-fazer',
        progress: 0,
        locationLabel: 'Setor Leste',
        participants: partsFor('Setor Leste'),
        totalParticipants: 18,
      },
    ]

    const now = Date.now()
    // S1.7 weather: 4 entries matching Figma frame 4:2 weather-section.
    // The AGORA marker floats over item 2 (isNow). Last item is wider per Figma
    // (528px vs 280px) — that's expressed via intensitySegments in Dashboard.tsx.
    const weather: DashboardSummary['weather'] = [
      {
        at: new Date(now - 4 * 3600_000).toISOString(),
        condition: 'rain',
        tempC: 22,
        label: 'CHUVAS\nMODERADAS',
      },
      {
        at: new Date(now - 2 * 3600_000).toISOString(),
        condition: 'sun',
        tempC: 26,
        label: 'SOL\nINTENSO',
        isNow: true,
      },
      {
        at: new Date(now + 2 * 3600_000).toISOString(),
        condition: 'rain',
        tempC: 23,
        label: 'CHUVAS\nMODERADAS',
      },
      {
        at: new Date(now + 4 * 3600_000).toISOString(),
        condition: 'storm',
        tempC: 21,
        label: 'PARCIALMENTE\nNUBLADO',
      },
    ]

    const urgentAlerts = bySeverity.critical + bySeverity.warning
    const commonAlerts = bySeverity.info
    // Mocked aggregates matching Figma frame 4:2 (S1.7 dashboard fidelity).
    // S2 will replace with real device telemetry + reports/cameras inventory.
    const admins = 8
    const totalEmployees = 1205
    const newReports = 4
    const activeCameras = 564
    const vitalSigns = 512
    const wearRate = 512

    // Wear alerts — 8 roster members distributed across the 3 tier tabs the
    // dashboard renders. The bpm/pressure shown represent the wear-tracker
    // aggregate, distinct from the worker's instantaneous vitals snapshot.
    // Tier mapping is explicit (not derived from progress) so the demo
    // remains deterministic even when the values are tuned later.
    const wearMembers: Array<{
      rosterId: string
      progress: number
      bpm: number
      pressure: string
      tier: DashboardWearTier
    }> = [
      // 2 alerta-fadiga — workers at risk (high progress, critical vitals)
      { rosterId: 'emp-04', progress: 91, bpm: 138, pressure: '16/10', tier: 'alerta-fadiga' }, // Carlos Henrique — critical
      { rosterId: 'emp-10', progress: 88, bpm: 142, pressure: '17/11', tier: 'alerta-fadiga' }, // Marcos Vinícius — critical
      // 3 desgastado — under load but still operational (warning vitals)
      { rosterId: 'emp-02', progress: 74, bpm: 112, pressure: '14/9', tier: 'desgastado' }, // Ana Paula Gomes — warning
      { rosterId: 'emp-06', progress: 68, bpm: 108, pressure: '13/9', tier: 'desgastado' }, // Pedro Martins Lima — warning
      { rosterId: 'emp-08', progress: 62, bpm: 102, pressure: '13/8', tier: 'desgastado' }, // Rafael Oliveira — high effort
      // 3 excelente — low fatigue, baseline vitals (good workers)
      { rosterId: 'emp-01', progress: 28, bpm: 92, pressure: '12/8', tier: 'excelente' }, // Larissa Sales
      { rosterId: 'emp-09', progress: 22, bpm: 88, pressure: '12/8', tier: 'excelente' }, // Juliana Costa
      { rosterId: 'emp-12', progress: 18, bpm: 86, pressure: '11/7', tier: 'excelente' }, // Karen Oliveira
    ]
    const wearAlerts: DashboardWearAlert[] = wearMembers.map((w, idx) => {
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

    return {
      data: {
        employees: { total: employees.length, byStatus },
        alerts: { openOrAcknowledged: openOrAck.length, bySeverity },
        kpis: {
          admins,
          totalEmployees,
          newReports,
          activeCameras,
          vitalSigns,
          wearRate,
          urgentAlerts,
          commonAlerts,
        },
        mapMarkers,
        activities,
        wearAlerts,
        weather,
      },
      error: null,
    }
  },
}
