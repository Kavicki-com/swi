// Canonical sidebar navigation.
// Order, labels and icons match the dashboard sidebar and the MapsGeneral
// compact side-menu. Pages that need badge overlays (e.g. "+9" unread
// counts on /reports and /alerts in the map view) apply them via
// `withBadges`.
import type { IconName } from '@kavicki/swi-design-system'
import type { PanelLevel } from '@/services/types'

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
  // chat. O ícone é `assignment_filled` (clipboard preenchido, do DS 0.1.117):
  // a sidebar inteira usa a variante preenchida.
  { value: '/tasks', label: 'Tarefas', icon: 'assignment_filled' },
  // Câmeras logo abaixo de Tarefas: cadastro dos pontos de câmera da obra.
  { value: '/cameras', label: 'Câmeras', icon: 'video_camera_filled' },
]

// Gestão de usuários e de administradores: só o Administrador vê. A rota em si
// é barrada pelo AdminOnly; aqui o item só some do menu.
const ADMIN_ONLY_ITEMS = new Set(['/admins', '/employees'])

/** Menu do nível. Ausente vale Administrador (sessão de demonstração). */
export function navItemsFor(level: PanelLevel = 'ADMIN'): NavItem[] {
  return level === 'ADMIN'
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => !ADMIN_ONLY_ITEMS.has(item.value))
}

// Contagem REAL → texto do badge. `undefined` (zero/negativo/NaN) some com o
// badge: um número inventado num console de emergência é pior que nenhum.
export function formatBadgeCount(count: number): string | undefined {
  if (!Number.isFinite(count) || count <= 0) return undefined
  return count > 9 ? '+9' : String(count)
}

export function withBadges(
  overrides: Record<string, string | undefined>,
  level: PanelLevel = 'ADMIN',
): NavItem[] {
  return navItemsFor(level).map((item) => {
    const badge = overrides[item.value]
    return badge ? { ...item, badge } : { ...item }
  })
}
