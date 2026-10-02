// Contratos de view do /monitoring/*: consumidos pelas telas via a fachada
// @/services/monitoring e produzidos por api/monitoring.ts a partir do diretório
// real da org, da telemetria e da fila de alertas. Módulo neutro de propósito:
// o caminho de produção não importa nada do namespace de simulação.
import type { IconName } from '@kavicki/swi-design-system'

// One KPI card: row of 7 BigNumbersCards.
export type MonitoringKpi = {
  id: string
  icon: IconName
  value: string
  label: string
}

/**
 * Em que aba a pessoa cai. Vem das condições abertas e dos alertas ainda não
 * triados, nunca de um palpite: sem leitura atual ninguém é "excelente".
 */
export type MonitoringTier = 'excelente' | 'desgastado' | 'alerta-fadiga' | 'sem-leitura'

/** Estado de triagem de um alerta da fila, com o que a tela pode fazer com ele. */
export type MonitoringAlertTriage = {
  alertId: string
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED'
  /** "Reconhecido por Ana às 14:20"; null enquanto ninguém triou. */
  triageLine: string | null
  canAcknowledge: boolean
  canResolve: boolean
}

// Single per-user alert detail.
// `tone` colors the icon; the title/description text is always content.dark.
export type MonitoringAlertDetail = {
  id: string
  icon: IconName
  title: string
  description: string
  tone?: 'error' | 'warning' | 'info'
  /** Linhas complementares: abertura, leitura normalizada, origem. */
  notes?: ReadonlyArray<string>
  /** Presente quando o alerta veio da fila e pode ser triado. */
  triage?: MonitoringAlertTriage
}

/** Um donut da faixa de boas condições, já com o texto pronto. */
export type MonitoringDonut = {
  value: string
  label: string
  caption: string
  /** 0-100. */
  progress: number
}

/** Os 4 donuts de /monitoring/good-conditions, calculados da telemetria. */
export type MonitoringGoodConditionsView = {
  vitals: MonitoringDonut
  fatigueRate: MonitoringDonut
  heartrate: MonitoringDonut
  urgentAlerts: MonitoringDonut
}

// Formato do simulador de mockApi/, que não participa do caminho de produção.
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
   * Aba da pessoa. Existe pra régua "Excelentes / Desgastados / Alertas de
   * Fadiga" poder filtrar de verdade. Opcional porque o seed mock não traz
   * telemetria.
   */
  tier?: MonitoringTier
  alerts: ReadonlyArray<MonitoringAlertDetail>
}
