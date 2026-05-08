import type { Alert, Employee } from '../types'
import { SEED_ALERTS, SEED_EMPLOYEES } from './seed'
import { sleep } from './sleep'
import type { MockResponse } from './types'

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
  recentActivities: Array<{ id: string; label: string; at: string }>
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

    const recentActivities = [...alerts]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 5)
      .map((a) => ({ id: a.id, label: a.message, at: a.created_at }))

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
        recentActivities,
        weather,
      },
      error: null,
    }
  },
}
