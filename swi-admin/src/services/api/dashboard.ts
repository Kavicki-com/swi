// Fachada-cliente do dashboard. summary() faz fan-out sobre endpoints reais
// (admins/funcionários/relatórios/tarefas/clima); desgaste/vitais derivam dos
// funcionários REAIS com vitais SIMULADOS plausíveis (simulatedVitalsFor,
// rotulados na UI) — Fase 3, fim do roster fake. Nenhuma seção real derruba as
// outras: cada chamada é isolada e degrada só a sua fatia (KPIs→0,
// activities→[], weather→[]). Este é o lar canônico dos tipos do dashboard.
import type { Alert, Employee } from '../types'
import type { MockResponse } from '@/services/mockApi/types'
import { adminsApi, employeesApi } from './users'
import { reportsApi } from './reports'
import { workOrdersApi, type WorkOrderRow, type WorkOrderStatus } from './workOrders'
import { weatherApi } from './weather'
import { simulatedVitalsFor, type SimulatedTier } from '@/services/vitals/simulatedVitals'
import { ACTIVE_CAMERAS } from '@/services/cameras'

export type DashboardActivityStatus = 'em-curso' | 'concluida' | 'a-fazer'

/**
 * Activity risk level — drives the ProgressBar fill color independently of
 * status. The reference frame mocks cards with mixed progress colors (green/orange/
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

// Slot da tira de clima (weather-section). api/weather.ts produz
// este shape a partir do snapshot do backend.
export type WeatherSlot = {
  at: string
  condition: 'sun' | 'rain' | 'storm' | 'cloudy'
  tempC: number
  label?: string
  isNow?: boolean
  isNight?: boolean // slot noturno (isDay=false no backend) → ilustração de lua
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

// Câmeras: MESMA frota que o mapa desenha (services/cameras). Era 564 fixo
// contra 12 pinos no mapa — número que não correspondia a nada.

const TIER_TO_STATUS: Record<SimulatedTier, 'good' | 'alert' | 'low'> = {
  excelente: 'good',
  desgastado: 'alert',
  'alerta-fadiga': 'low',
}

export const dashboardApi = {
  summary: async (): Promise<MockResponse<DashboardSummary>> => {
    // Cada fachada envelope nunca rejeita; workOrders é isolado no helper. Um
    // erro degrada só a própria seção — o summary nunca propaga erro total.
    const [admins, employees, reports, activities, weather] = await Promise.all([
      adminsApi.list(),
      employeesApi.list(),
      reportsApi.list(),
      fetchActivities(),
      weatherApi.get(),
    ])

    // Fase 3 (monitoramento honesto): desgaste/vitais derivam dos funcionários
    // REAIS da org com vitais SIMULADOS plausíveis (rotulados na UI) — nada de
    // roster fake com nomes que não existem no diretório.
    const now = Date.now()
    const workers = employees.data ?? []
    const withVitals = workers.map((w) => ({ w, v: simulatedVitalsFor(w.id, now) }))
    const tierCount: Record<SimulatedTier, number> = {
      excelente: 0,
      desgastado: 0,
      'alerta-fadiga': 0,
    }
    const byStatus = { good: 0, alert: 0, low: 0, offline: 0 }
    withVitals.forEach(({ v }) => {
      tierCount[v.tier] += 1
      byStatus[TIER_TO_STATUS[v.tier]] += 1
    })

    const wearAlerts = withVitals.map(({ w, v }) => ({
      id: w.id,
      employeeName: w.name,
      sector: w.sector ?? '',
      progress: v.fatiguePct,
      bpm: v.bpm,
      pressure: v.pressure,
      tier: v.tier,
      avatarUri: w.avatarUri || undefined,
    }))

    const newReports = (reports.data ?? []).filter((r) => r.status === 'pending').length
    const urgentAlerts = tierCount['alerta-fadiga']
    const commonAlerts = tierCount.desgastado

    return {
      data: {
        employees: { total: workers.length, byStatus },
        alerts: {
          openOrAcknowledged: urgentAlerts + commonAlerts,
          bySeverity: { info: 0, warning: commonAlerts, critical: urgentAlerts },
        },
        kpis: {
          admins: admins.data?.length ?? 0,
          totalEmployees: workers.length,
          newReports,
          activeCameras: ACTIVE_CAMERAS,
          vitalSigns: tierCount.excelente,
          wearRate: tierCount.desgastado,
          urgentAlerts,
          commonAlerts,
        },
        // Posições agora são REAIS (GET /positions + WS): o Dashboard splica
        // useLivePositions() sobre o summary no render. Vazio aqui de propósito.
        mapMarkers: [],
        activities,
        wearAlerts,
        weather: weather.data ?? [],
      },
      error: null,
    }
  },
}
