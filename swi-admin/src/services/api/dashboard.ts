// Fachada-cliente do dashboard. summary() faz fan-out sobre endpoints reais
// (admins/funcionários/relatórios/tarefas/clima). Biometria não passa por
// aqui: a saúde da frota vem da telemetria, lida pela própria tela. Nenhuma
// seção derruba as outras: cada chamada é isolada e degrada só a sua fatia
// (KPIs→0, activities→[], weather→[]). Este é o lar canônico dos tipos do
// dashboard.
import type { Employee } from '../types'
import type { ServiceResponse } from '@/services/types'
import { adminsApi, employeesApi } from './users'
import { reportsApi } from './reports'
import { workOrdersApi, type WorkOrderRow, type WorkOrderStatus } from './workOrders'
import { weatherApi } from './weather'
import { countCameras } from './cameras'

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
  }
  // Os quatro quadros de cabeçalho. Os números de saúde (sinais vitais,
  // desgaste, alertas urgentes) vêm da telemetria, não daqui.
  kpis: {
    admins: number
    totalEmployees: number
    newReports: number
    /** Câmeras cadastradas; null quando a leitura falhou (a tela mostra "--"). */
    activeCameras: number | null
  }
  mapMarkers: DashboardMapMarker[]
  activities: DashboardActivity[]
  /** Foto de cada funcionário do diretório, para a lista de desgaste. */
  employeeAvatars: Record<string, string | undefined>
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
  summary: async (): Promise<ServiceResponse<DashboardSummary>> => {
    // Cada fachada envelope nunca rejeita; workOrders é isolado no helper. Um
    // erro degrada só a própria seção: o summary nunca propaga erro total.
    // Câmeras: o MESMO cadastro que o mapa desenha (GET /cameras). countCameras
    // nunca rejeita; falha vira null.
    const [admins, employees, reports, activities, weather, cameras] = await Promise.all([
      adminsApi.list(),
      employeesApi.list(),
      reportsApi.list(),
      fetchActivities(),
      weatherApi.get(),
      countCameras(),
    ])

    const workers = employees.data ?? []
    // Só a foto sai do diretório; nome e setor da lista de desgaste vêm da
    // telemetria. Avatar vazio vira ausência, nunca string vazia.
    const employeeAvatars: Record<string, string | undefined> = {}
    for (const w of workers) employeeAvatars[w.id] = w.avatarUri || undefined

    const newReports = (reports.data ?? []).filter((r) => r.status === 'pending').length

    return {
      data: {
        employees: { total: workers.length },
        kpis: {
          admins: admins.data?.length ?? 0,
          totalEmployees: workers.length,
          newReports,
          activeCameras: cameras,
        },
        // Posições agora são REAIS (GET /positions + WS): o Dashboard splica
        // useLivePositions() sobre o summary no render. Vazio aqui de propósito.
        mapMarkers: [],
        activities,
        employeeAvatars,
        weather: weather.data ?? [],
      },
      error: null,
    }
  },
}
