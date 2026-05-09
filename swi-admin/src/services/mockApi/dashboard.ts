import type { Alert, Employee } from '../types'
import { SEED_ALERTS, SEED_EMPLOYEES } from './seed'
import { sleep } from './sleep'
import type { MockResponse } from './types'
import workerA from '@/assets/avatars/worker-a.png'
import workerB from '@/assets/avatars/worker-b.png'
import workerC from '@/assets/avatars/worker-c.png'

// Real worker photos exported from Figma frame 4:2 (S1.7 dashboard fidelity).
// Cycled across activity participants and wear-alert rows since the frame
// only exposes 3 unique avatar circles.
const FIGMA_AVATARS: readonly string[] = [workerA, workerB, workerC]
const cycleAvatar = (idx: number): string =>
  FIGMA_AVATARS[idx % FIGMA_AVATARS.length] ?? workerA

export type DashboardActivityStatus = 'em-curso' | 'concluida' | 'a-fazer'

export type DashboardActivity = {
  id: string
  title: string
  sector: string
  status: DashboardActivityStatus
  participants: Array<{ uri?: string; alt?: string }>
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

    // S1.7 activities fixture — Figma shows Reparo / Aluguel maquinário etc.
    // Mix of statuses so the chip filter has visible effects on default load.
    const activities: DashboardActivity[] = [
      {
        id: 'act_001',
        title: 'Reparo',
        sector: 'Setor Leste',
        status: 'em-curso',
        progress: 60,
        locationLabel: 'Setor Leste',
        participants: [
          { uri: cycleAvatar(0), alt: 'Carlos' },
          { uri: cycleAvatar(1), alt: 'Diego' },
          { uri: cycleAvatar(2), alt: 'Eva' },
          { uri: cycleAvatar(3), alt: 'Felipe' },
        ],
      },
      {
        id: 'act_002',
        title: 'Reparo',
        sector: 'Setor Leste',
        status: 'em-curso',
        progress: 35,
        locationLabel: 'Setor Leste',
        participants: [
          { uri: cycleAvatar(4), alt: 'Gabriela' },
          { uri: cycleAvatar(5), alt: 'Henrique' },
          { uri: cycleAvatar(6), alt: 'Isabela' },
        ],
      },
      {
        id: 'act_003',
        title: 'Aluguel maquinário',
        sector: 'Setor Leste',
        status: 'a-fazer',
        progress: 0,
        locationLabel: 'Setor Leste',
        participants: [
          { uri: cycleAvatar(7), alt: 'Joao' },
          { uri: cycleAvatar(8), alt: 'Karen' },
        ],
      },
      {
        id: 'act_004',
        title: 'Reparo',
        sector: 'Setor Leste',
        status: 'concluida',
        progress: 100,
        locationLabel: 'Setor Leste',
        participants: [
          { uri: cycleAvatar(9), alt: 'Lucas' },
          { uri: cycleAvatar(10), alt: 'Mariana' },
        ],
      },
      {
        id: 'act_005',
        title: 'Reparo',
        sector: 'Setor Leste',
        status: 'em-curso',
        progress: 80,
        locationLabel: 'Setor Leste',
        participants: [
          { uri: cycleAvatar(11), alt: 'Nicolas' },
          { uri: cycleAvatar(12), alt: 'Olívia' },
        ],
      },
    ]

    const now = Date.now()
    // S1.7 weather expanded to 6 entries — Figma vocabulary in label.
    // The AGORA marker is the third entry (isNow). WeatherTimeline auto-
    // derives intensity segments from the condition sequence.
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
      },
      {
        at: new Date(now).toISOString(),
        condition: 'sun',
        tempC: 25,
        label: 'AGORA',
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
      {
        at: new Date(now + 6 * 3600_000).toISOString(),
        condition: 'sun',
        tempC: 24,
        label: 'SOL',
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
        activities,
        wearAlerts,
        weather,
      },
      error: null,
    }
  },
}
