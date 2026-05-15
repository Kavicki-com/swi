// src/services/mockApi/monitoring.ts
// Mock data for /monitoring/* screens:
//   - kpis(): the 7 big-number cards across the top of both screens.
//   - alertUsers(): worker rows with optional expanded alert details
//     (Figma 69:14731 /monitoring/alerts). Derives from the canonical
//     ROSTER so cross-page navigation lands on the same /employees/:id.
//   - goodConditionsStats(): the second row of 4 stat cards exclusive to the
//     /monitoring/good-conditions screen (Figma 77:16587).
import { sleep } from './sleep'
import type { MockResponse } from './types'
import type { IconName } from '@kavicki/swi-design-system'
import { ROSTER } from './roster'

// One KPI card — Figma 69:14747 row of 7 BigNumbersCards.
export type MonitoringKpi = {
  id: string
  icon: IconName
  value: string
  label: string
}

// Single per-user alert detail — Figma 77:16204/16209/16214.
// `tone` colors the icon; the title/description text is always content.dark.
export type MonitoringAlertDetail = {
  id: string
  icon: IconName
  title: string
  description: string
  tone?: 'error' | 'warning' | 'info'
}

// Second-row stat cards on /monitoring/good-conditions (Figma 77:16587).
// 4 cards: two donut-chart cards + a heart-rate status card + an alerts
// summary card. Kept loose so the page can render each card with its own
// composition without forcing a single schema.
export type MonitoringGoodConditionsStats = {
  vitals: { value: number; label: string; progress: number }
  fatigueRate: { value: string; label: string; progress: number }
  heartrate: { value: number; unit: string; label: string }
  urgentAlerts: { value: number; label: string }
}

// Row in the alert users list — Figma 69:14774 (expanded) and 69:14775..14777
// (collapsed). When `alerts` is empty the row renders as a collapsed card.
export type MonitoringUserAlert = {
  id: string
  name: string
  age: number
  bloodType: string
  role: string
  specialization: string
  avatarUri: string
  active: boolean
  alerts: ReadonlyArray<MonitoringAlertDetail>
}

const KPIS_SEED: ReadonlyArray<MonitoringKpi> = [
  { id: 'admins', icon: 'account_circle_filled', value: '8', label: 'Administradores' },
  { id: 'workers', icon: 'person_apron_filled', value: '1205', label: 'Funcionários' },
  { id: 'reports', icon: 'report_filled', value: '4', label: 'Novos relatórios' },
  { id: 'cameras', icon: 'video_camera_filled', value: '564', label: 'Câmeras ativas' },
  { id: 'fatigue', icon: 'bell_filled', value: '4', label: 'Alertas de fadiga' },
  { id: 'pressure', icon: 'favorite_filled', value: '11/7', label: 'Pressão arterial média' },
  { id: 'movements', icon: 'directions_walk', value: '22350', label: 'Movimentos realizados' },
]

// Which roster members appear in the monitoring screen + their alert details.
// Workers with vitalsStatus 'critical' get an expanded multi-alert row; the
// 'warning' workers get a single-alert row; 'good' workers appear as
// collapsed rows so the operator can still browse the full shift roster.
const MONITORING_ROWS: ReadonlyArray<{
  rosterId: string
  alerts: ReadonlyArray<MonitoringAlertDetail>
}> = [
  {
    rosterId: 'emp-04', // Carlos Henrique Silva — critical
    alerts: [
      {
        id: 'a-04-01',
        icon: 'heart_filled',
        title: 'Taquicardia detectada',
        description: 'Batimentos cardíacos 12% acima do recomendado',
        tone: 'error',
      },
      {
        id: 'a-04-02',
        icon: 'av_timer',
        title: 'Possível queda detectada',
        description: 'Acelerômetro registrou impacto brusco há 5 min',
        tone: 'error',
      },
      {
        id: 'a-04-03',
        icon: 'cognition',
        title: 'Fadiga excessiva',
        description: 'Carga operacional acima do recomendado para o funcionário',
        tone: 'warning',
      },
    ],
  },
  {
    rosterId: 'emp-10', // Marcos Vinícius — critical
    alerts: [
      {
        id: 'a-10-01',
        icon: 'heart_filled',
        title: 'Frequência cardíaca crítica',
        description: '142 bpm em repouso — limite recomendado: 100 bpm',
        tone: 'error',
      },
      {
        id: 'a-10-02',
        icon: 'cognition',
        title: 'Fadiga acumulada',
        description: '224 min até fadiga total — operação contínua há 6h',
        tone: 'error',
      },
    ],
  },
  {
    rosterId: 'emp-02', // Ana Paula Gomes — warning
    alerts: [
      {
        id: 'a-02-01',
        icon: 'heart_filled',
        title: 'Pressão arterial elevada',
        description: 'Queda de pressão para 5% acima do normal para a funcionária',
        tone: 'warning',
      },
    ],
  },
  {
    rosterId: 'emp-06', // Pedro Martins Lima — warning
    alerts: [
      {
        id: 'a-06-01',
        icon: 'av_timer',
        title: 'Tensão arterial elevada',
        description: 'Pressão 13/9 — sustentada nas últimas 2 horas',
        tone: 'warning',
      },
    ],
  },
  { rosterId: 'emp-01', alerts: [] }, // Larissa Sales — good
  { rosterId: 'emp-03', alerts: [] }, // Lúcia Fernandes — good
  { rosterId: 'emp-05', alerts: [] }, // Mariana de Souza — good
  { rosterId: 'emp-07', alerts: [] }, // Amanda Costa Pereira — good
  { rosterId: 'emp-08', alerts: [] }, // Rafael Oliveira — good
  { rosterId: 'emp-12', alerts: [] }, // Karen Oliveira — good
]

const ALERT_USERS_SEED: ReadonlyArray<MonitoringUserAlert> = MONITORING_ROWS.map((row) => {
  const p = ROSTER.find((r) => r.id === row.rosterId)
  if (!p) {
    throw new Error(`MONITORING_ROWS references unknown roster id: ${row.rosterId}`)
  }
  return {
    id: p.id,
    name: p.name,
    age: p.age,
    bloodType: p.bloodType,
    role: p.role,
    specialization: p.specialization,
    avatarUri: p.avatarUri,
    active: p.isOnline,
    alerts: row.alerts,
  }
})

// Good-conditions row-2 seed — Figma 77:16587 values verbatim.
const GOOD_CONDITIONS_STATS_SEED: MonitoringGoodConditionsStats = {
  vitals: { value: 512, label: 'Funcionários', progress: 100 },
  fatigueRate: { value: '20%', label: 'Desgaste baixo', progress: 20 },
  heartrate: { value: 80, unit: 'bbm', label: 'Médio normal' },
  urgentAlerts: { value: 4, label: 'Necessitam notificação' },
}

export const monitoringApi = {
  async kpis(): Promise<MockResponse<ReadonlyArray<MonitoringKpi>>> {
    await sleep(60)
    return { data: KPIS_SEED, error: null }
  },
  async alertUsers(): Promise<MockResponse<ReadonlyArray<MonitoringUserAlert>>> {
    await sleep(80)
    return { data: ALERT_USERS_SEED, error: null }
  },
  async goodConditionsStats(): Promise<MockResponse<MonitoringGoodConditionsStats>> {
    await sleep(60)
    return { data: GOOD_CONDITIONS_STATS_SEED, error: null }
  },
}
