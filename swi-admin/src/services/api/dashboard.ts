// Fachada-cliente do dashboard. summary() faz fan-out sobre endpoints já reais
// (admins/funcionários/relatórios/tarefas/clima) e SOBREPÕE os vitais mock
// (dashboardMockVitals) — preservando o shape DashboardSummary que a UI já
// consome. Nenhuma seção real derruba as outras: cada chamada é isolada e
// degrada só a sua fatia (KPIs→0, activities→[], weather→[]); os vitais estão
// sempre presentes. Este é o lar canônico dos tipos do dashboard (antes moravam
// em mockApi/dashboard.ts, hoje morto) — mesmo movimento que o Passo 4 fez com
// Reports.
import type { Alert, Employee } from '../types'
import type { MockResponse } from '@/services/mockApi/types'
import { adminsApi, employeesApi } from './users'
import { reportsApi } from './reports'
import { workOrdersApi, type WorkOrderRow, type WorkOrderStatus } from './workOrders'
import { weatherApi } from './weather'
import {
  buildLegacyAggregates,
  buildMockMapMarkers,
  MOCK_VITAL_KPIS,
  MOCK_WEAR_ALERTS,
} from './dashboardMockVitals'

export type DashboardActivityStatus = 'em-curso' | 'concluida' | 'a-fazer'

/**
 * Activity risk level — drives the ProgressBar fill color independently of
 * status. Figma frame 4:2 mocks cards with mixed progress colors (green/orange/
 * red) reflecting urgency, not progress. Vitals-derived → omitido no fan-out
 * real (sem smartband não há sinal de risco), a barra cai na cor default.
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

// Slot da tira de clima (Figma frame 4:2 weather-section). api/weather.ts produz
// este shape a partir do snapshot do backend.
export type WeatherSlot = {
  at: string
  condition: 'sun' | 'rain' | 'storm'
  tempC: number
  label?: string
  isNow?: boolean
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
  // KPI row. admins/totalEmployees/newReports são REAIS (fan-out); o resto é
  // vital/telemetria e fica mock até a smartband.
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
  weather: WeatherSlot[]
}

// Status do PAI da tarefa → status da atividade do dashboard.
const WO_STATUS_TO_ACTIVITY: Record<WorkOrderStatus, DashboardActivityStatus> = {
  pending: 'a-fazer',
  in_progress: 'em-curso',
  done: 'concluida',
}

// WorkOrderRow → DashboardActivity. Avatares são decorativos e vêm do backend
// (posição vazia '' → { uri: undefined }); `risk` é omitido (vitals-derived).
function toActivity(row: WorkOrderRow): DashboardActivity {
  return {
    id: row.id,
    title: row.title,
    sector: row.sector,
    locationLabel: row.sector,
    status: WO_STATUS_TO_ACTIVITY[row.status],
    progress: row.progressPct,
    participants: row.responsibleAvatars.map((uri) => ({ uri: uri || undefined })),
    totalParticipants: row.responsibleCount,
  }
}

// workOrdersApi.list() é RAW (lança ApiError). Isola aqui pra falha de tarefas
// não derrubar o dashboard inteiro — degrada só as atividades pra [].
async function fetchActivities(): Promise<DashboardActivity[]> {
  try {
    const rows = await workOrdersApi.list()
    return rows.map(toActivity)
  } catch {
    return []
  }
}

export const dashboardApi = {
  summary: async ({ orgId }: { orgId: string }): Promise<MockResponse<DashboardSummary>> => {
    // Cada fachada envelope nunca rejeita; workOrders é isolado no helper. Um
    // erro degrada só a própria seção — o summary nunca propaga erro total.
    const [admins, employees, reports, activities, weather] = await Promise.all([
      adminsApi.list(),
      employeesApi.list(),
      reportsApi.list(),
      fetchActivities(),
      weatherApi.get(),
    ])

    const { employees: employeesAgg, alerts: alertsAgg } = buildLegacyAggregates(orgId)

    const newReports = (reports.data ?? []).filter((r) => r.status === 'pending').length
    const urgentAlerts = alertsAgg.bySeverity.critical + alertsAgg.bySeverity.warning
    const commonAlerts = alertsAgg.bySeverity.info

    return {
      data: {
        employees: employeesAgg,
        alerts: alertsAgg,
        kpis: {
          admins: admins.data?.length ?? 0,
          totalEmployees: employees.data?.length ?? 0,
          newReports,
          ...MOCK_VITAL_KPIS,
          urgentAlerts,
          commonAlerts,
        },
        mapMarkers: buildMockMapMarkers(orgId),
        activities,
        wearAlerts: MOCK_WEAR_ALERTS,
        weather: weather.data ?? [],
      },
      error: null,
    }
  },
}
