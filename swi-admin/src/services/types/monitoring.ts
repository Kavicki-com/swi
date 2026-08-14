// Contratos de view do /monitoring/*: consumidos pelas telas via a fachada
// @/services/monitoring e produzidos por api/monitoring.ts (diretório real com
// vitais simulados rotulados) e pela simulação de mockApi/. Módulo neutro de
// propósito: o caminho de produção não importa nada do namespace de simulação.
import type { IconName } from '@kavicki/swi-design-system'
import type { SimulatedTier } from '@/services/vitals/simulatedVitals'

// One KPI card: row of 7 BigNumbersCards.
export type MonitoringKpi = {
  id: string
  icon: IconName
  value: string
  label: string
}

// Single per-user alert detail.
// `tone` colors the icon; the title/description text is always content.dark.
export type MonitoringAlertDetail = {
  id: string
  icon: IconName
  title: string
  description: string
  tone?: 'error' | 'warning' | 'info'
}

// Second-row stat cards on /monitoring/good-conditions.
// 4 cards: two donut-chart cards + a heart-rate status card + an alerts
// summary card. Kept loose so the page can render each card with its own
// composition without forcing a single schema.
export type MonitoringGoodConditionsStats = {
  vitals: { value: number; label: string; progress: number }
  fatigueRate: { value: string; label: string; progress: number }
  heartrate: { value: number; unit: string; label: string }
  urgentAlerts: { value: number; label: string }
}

// Row in the alert users list, expanded or collapsed. When `alerts` is
// empty the row renders as a collapsed card.
export type MonitoringUserAlert = {
  id: string
  name: string
  age: number
  bloodType: string
  role: string
  specialization: string
  avatarUri: string
  active: boolean
  /**
   * Tier de vitais da pessoa. Existe pra régua "Excelentes / Desgastados /
   * Alertas de Fadiga" poder filtrar de verdade. Sem ele as três abas listam a
   * população inteira enquanto o badge anuncia outro número.
   * Opcional porque o seed mock não simula vitais.
   */
  tier?: SimulatedTier
  alerts: ReadonlyArray<MonitoringAlertDetail>
}
