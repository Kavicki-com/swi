// src/services/mockApi/monitoring.ts
// Mock data for /monitoring/* screens:
//   - kpis(): the 7 big-number cards across the top of both screens.
//   - alertUsers(): the 4 worker rows with optional expanded alert details
//     (Figma 69:14731 /monitoring/alerts).
//   - goodConditionsStats(): the second row of 4 stat cards exclusive to the
//     /monitoring/good-conditions screen (Figma 77:16587).
import { sleep } from './sleep'
import type { MockResponse } from './types'
import type { IconName } from '@kavicki/swi-design-system'
import workerA from '@/assets/avatars/worker-a.png'
import workerB from '@/assets/avatars/worker-b.png'
import workerC from '@/assets/avatars/worker-c.png'

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
  { id: 'admins', icon: 'account_circle_filled', value: '3', label: 'Administradores' },
  { id: 'workers', icon: 'person_apron_filled', value: '1205', label: 'Funcionários' },
  { id: 'reports', icon: 'report_filled', value: '4', label: 'Novos relatórios' },
  { id: 'cameras', icon: 'video_camera_filled', value: '564', label: 'Câmeras ativas' },
  { id: 'fatigue', icon: 'bell_filled', value: '4', label: 'Alertas de fadiga' },
  { id: 'pressure', icon: 'favorite_filled', value: '11/7', label: 'Pressão arterial média' },
  { id: 'movements', icon: 'directions_walk', value: '22350', label: 'Movimentos realizados' },
]

const ALERT_USERS_SEED: ReadonlyArray<MonitoringUserAlert> = [
  {
    id: 'mon-01',
    name: 'Eliseu Siqueira Jordão',
    age: 32,
    bloodType: 'O+',
    role: 'Administradora de Sistema',
    specialization: 'Engenheira Civil',
    avatarUri: workerA,
    active: true,
    alerts: [
      {
        id: 'a-01',
        icon: 'heart_filled',
        title: 'Taquicardia detectada',
        description: 'Batimentos cardíacos 8% acima do recomendado',
      },
      {
        id: 'a-02',
        icon: 'av_timer',
        title: 'Pressão sanguínea abaixo do normal',
        description: 'Queda de pressão para 5% abaixo do normal para o funcionário',
      },
      {
        id: 'a-03',
        icon: 'cognition',
        title: 'Fadica excessiva',
        description: 'Carga operacional acima do recomendado para o funcionário',
      },
    ],
  },
  {
    id: 'mon-02',
    name: 'Maria Bethânia',
    age: 67,
    bloodType: 'AB+',
    role: 'Operador de Equipamento',
    specialization: 'Analista Ambiental',
    avatarUri: workerB,
    active: true,
    alerts: [],
  },
  {
    id: 'mon-03',
    name: 'Roberto Cabrini',
    age: 58,
    bloodType: 'O+',
    role: 'Técnico de Segurança',
    specialization: 'Geólogo Sênior',
    avatarUri: workerC,
    active: true,
    alerts: [],
  },
  {
    id: 'mon-04',
    name: 'Ricardo Silva',
    age: 45,
    bloodType: 'O-',
    role: 'Coordenador de Mina',
    specialization: 'Engenheiro de Explosivos',
    avatarUri: workerA,
    active: true,
    alerts: [],
  },
]

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
