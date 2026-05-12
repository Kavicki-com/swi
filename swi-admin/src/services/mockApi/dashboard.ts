import type { Alert, Employee } from '../types'
import { SEED_ALERTS, SEED_EMPLOYEES } from './seed'
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

export type DashboardWearAlert = {
  id: string
  employeeName: string
  sector: string
  progress: number
  bpm: number
  pressure: string
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

    // S1.7 activities fixture — Figma shows Reparo / Aluguel maquinário etc.
    // Mix of statuses so the chip filter has visible effects on default load.
    // S1.7 activities fixture — matches Figma frame 4:2 dashboard (5 cards, all
    // em-curso, varied sectors and titles per Figma's mock).
    const activities: DashboardActivity[] = [
      {
        id: 'act_001',
        title: 'Reparo',
        sector: 'Setor Leste',
        status: 'em-curso',
        progress: 84,
        locationLabel: 'Setor Leste',
        // Figma card 1: 5 avatars visible + "+13" overflow chip = 18 total.
        participants: [
          { uri: cycleAvatar(0), alt: 'Carlos' },
          { uri: cycleAvatar(1), alt: 'Diego' },
          { uri: cycleAvatar(2), alt: 'Eva' },
          { uri: cycleAvatar(3), alt: 'Felipe' },
          { uri: cycleAvatar(4), alt: 'Gabriela' },
        ],
        totalParticipants: 18,
      },
      {
        id: 'act_002',
        title: 'Reparo',
        sector: 'Setor Oeste',
        status: 'em-curso',
        progress: 2,
        locationLabel: 'Setor Oeste',
        participants: [
          { uri: cycleAvatar(5), alt: 'Henrique' },
          { uri: cycleAvatar(6), alt: 'Isabela' },
          { uri: cycleAvatar(7), alt: 'Joao' },
        ],
      },
      {
        id: 'act_003',
        title: 'Alocação de maquinário',
        sector: 'Setor Leste',
        status: 'em-curso',
        risk: 'warning',
        progress: 84,
        locationLabel: 'Setor Leste',
        participants: [
          { uri: cycleAvatar(8), alt: 'Karen' },
          { uri: cycleAvatar(9), alt: 'Lucas' },
          { uri: cycleAvatar(10), alt: 'Mariana' },
        ],
      },
      {
        id: 'act_004',
        title: 'Reparo',
        sector: 'Setor Sul',
        status: 'em-curso',
        risk: 'critical',
        progress: 84,
        locationLabel: 'Setor Sul',
        participants: [
          { uri: cycleAvatar(11), alt: 'Nicolas' },
          { uri: cycleAvatar(12), alt: 'Olívia' },
          { uri: cycleAvatar(13), alt: 'Paulo' },
        ],
      },
      {
        id: 'act_005',
        title: 'Reparo',
        sector: 'Setor Leste',
        status: 'em-curso',
        progress: 84,
        locationLabel: 'Setor Leste',
        // Figma card 5: 5 avatars visible + "+13" overflow chip = 18 total.
        participants: [
          { uri: cycleAvatar(14), alt: 'Quésia' },
          { uri: cycleAvatar(15), alt: 'Rafael' },
          { uri: cycleAvatar(16), alt: 'Sofia' },
          { uri: cycleAvatar(17), alt: 'Thiago' },
          { uri: cycleAvatar(18), alt: 'Úrsula' },
        ],
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
    const admins = 3
    const totalEmployees = 1205
    const newReports = 4
    const activeCameras = 564
    const vitalSigns = 512
    const wearRate = 512

    // S1.7 wear alerts fixture — Figma shows Ezequiel Almeida etc on the right column.
    const wearAlerts: DashboardWearAlert[] = [
      {
        id: 'wear_001',
        employeeName: 'Ezequiel Almeida',
        sector: 'Setor Leste',
        progress: 78,
        bpm: 112,
        pressure: '14/9',
        avatarUri: cycleAvatar(0),
      },
      {
        id: 'wear_002',
        employeeName: 'Mariana Costa',
        sector: 'Setor Leste',
        progress: 65,
        bpm: 104,
        pressure: '13/8',
        avatarUri: cycleAvatar(1),
      },
      {
        id: 'wear_003',
        employeeName: 'Rafael Souza',
        sector: 'Setor Norte',
        progress: 82,
        bpm: 118,
        pressure: '15/9',
        avatarUri: cycleAvatar(2),
      },
      {
        id: 'wear_004',
        employeeName: 'Tatiana Lima',
        sector: 'Setor Sul',
        progress: 71,
        bpm: 108,
        pressure: '13/8',
        avatarUri: cycleAvatar(3),
      },
    ]

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
