// Canonical sidebar navigation.
// Order, labels and icons match Figma frame 4:2 (Dashboard sidebar) and
// 32:2488 (MapsGeneral compact side-menu). Pages that need badge overlays
// (e.g. "+9" unread counts on /reports and /alerts in the map view per
// Figma nodes 165:21150 / 165:21152) apply them via `withBadges`.
import type { IconName } from '@kavicki/swi-design-system'

export type NavItem = {
  value: string
  label: string
  icon: IconName
  badge?: string
}

export const NAV_ITEMS: NavItem[] = [
  { value: '/', label: 'Home', icon: 'home_filled' },
  { value: '/admins', label: 'Administradores', icon: 'admin_filled' },
  { value: '/employees', label: 'Funcionários', icon: 'worker_filled' },
  { value: '/monitoring/alerts', label: 'Monitoramento', icon: 'monitor_filled' },
  { value: '/reports', label: 'Relatórios', icon: 'reports_filled' },
  { value: '/alerts', label: 'Alertas', icon: 'bell_filled' },
  { value: '/user/settings', label: 'Configurações', icon: 'settings_filled' },
  // Tarefas é o ÚLTIMO item, depois de Configurações e logo acima da seção de
  // chat (Figma 1606-11583 @1366px). `assignment_filled` entrou no DS 0.1.117
  // (clipboard preenchido, export Figma) — decisão do designer 2026-07-24,
  // encerrando a exceção de outline na sidebar.
  { value: '/tasks', label: 'Tarefas', icon: 'assignment_filled' },
]

// Contagem REAL → texto do badge. `undefined` (zero/negativo/NaN) some com o
// badge: um número inventado num console de emergência é pior que nenhum
// (era daí que vinha o "+9" fixo do QA 2026-07-24).
export function formatBadgeCount(count: number): string | undefined {
  if (!Number.isFinite(count) || count <= 0) return undefined
  return count > 9 ? '+9' : String(count)
}

export function withBadges(overrides: Record<string, string | undefined>): NavItem[] {
  return NAV_ITEMS.map((item) => {
    const badge = overrides[item.value]
    return badge ? { ...item, badge } : { ...item }
  })
}
