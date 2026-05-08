import type { Alert, Employee } from '../types'
import { SEED_ALERTS, SEED_EMPLOYEES } from './seed'
import { sleep } from './sleep'
import type { MockResponse } from './types'

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
    vitalSigns: number
    wearRate: number
    urgentAlerts: number
    commonAlerts: number
  }
  activities: DashboardActivity[]
  weather: Array<{ at: string; condition: 'sun' | 'rain' | 'storm'; tempC: number }>
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
          { uri: 'https://i.pravatar.cc/100?img=21', alt: 'Carlos' },
          { uri: 'https://i.pravatar.cc/100?img=22', alt: 'Diego' },
          { uri: 'https://i.pravatar.cc/100?img=23', alt: 'Eva' },
          { uri: 'https://i.pravatar.cc/100?img=24', alt: 'Felipe' },
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
          { uri: 'https://i.pravatar.cc/100?img=25', alt: 'Gabriela' },
          { uri: 'https://i.pravatar.cc/100?img=26', alt: 'Henrique' },
          { uri: 'https://i.pravatar.cc/100?img=27', alt: 'Isabela' },
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
          { uri: 'https://i.pravatar.cc/100?img=28', alt: 'Joao' },
          { uri: 'https://i.pravatar.cc/100?img=29', alt: 'Karen' },
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
          { uri: 'https://i.pravatar.cc/100?img=30', alt: 'Lucas' },
          { uri: 'https://i.pravatar.cc/100?img=31', alt: 'Mariana' },
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
          { uri: 'https://i.pravatar.cc/100?img=32', alt: 'Nicolas' },
          { uri: 'https://i.pravatar.cc/100?img=33', alt: 'Olívia' },
        ],
      },
    ]

    const now = Date.now()
    const weather: DashboardSummary['weather'] = [
      { at: new Date(now).toISOString(), condition: 'sun', tempC: 24 },
      { at: new Date(now + 2 * 3600_000).toISOString(), condition: 'rain', tempC: 22 },
      { at: new Date(now + 5 * 3600_000).toISOString(), condition: 'storm', tempC: 19 },
    ]

    const urgentAlerts = bySeverity.critical + bySeverity.warning
    const commonAlerts = bySeverity.info
    // Mocked aggregates. S2 will replace with real device telemetry.
    const vitalSigns = employees.length * 100 + 5
    const wearRate = 512

    return {
      data: {
        employees: { total: employees.length, byStatus },
        alerts: { openOrAcknowledged: openOrAck.length, bySeverity },
        kpis: { vitalSigns, wearRate, urgentAlerts, commonAlerts },
        activities,
        weather,
      },
      error: null,
    }
  },
}
