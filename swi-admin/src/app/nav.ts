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
]

export function withBadges(overrides: Record<string, string>): NavItem[] {
  return NAV_ITEMS.map((item) =>
    overrides[item.value] ? { ...item, badge: overrides[item.value] } : { ...item },
  )
}
