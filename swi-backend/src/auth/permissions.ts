// Matriz de acesso dos três níveis. É o ÚNICO lugar que decide quem faz o quê:
// os controllers declaram a permissão com @Can (roles.decorator) e os serviços
// que avisam "a equipe do painel" usam PANEL_ROLES. Mudar o que um nível pode
// é mudar esta tabela, e o route-access.spec mostra cada rota afetada.
//
// Administrador: tudo. Supervisor: monitora, trata alertas, opera ordens de
// serviço, evacuação, resgate, relatórios e chat, mas não cria, edita,
// desativa nem exclui usuários, não altera configurações da empresa e não
// cadastra câmeras. Funcionário: usa o app; no painel não entra.
import type { Role } from '@prisma/client'

/** Do mais alto ao mais baixo. A ordem é a que rolesFor devolve. */
export const ROLES = ['ADMIN', 'SUPERVISOR', 'WORKER'] as const satisfies readonly Role[]

/** Quem opera o painel e recebe os avisos dele (alertas, posições, evacuação). */
export const PANEL_ROLES = ['ADMIN', 'SUPERVISOR'] as const satisfies readonly Role[]

const PANEL = PANEL_ROLES
const ADMIN_ONLY = ['ADMIN'] as const
const EVERYONE = ROLES

export const PERMISSIONS = {
  /** Telemetria, sessões, estado do aparelho e transmissão ao vivo dos funcionários. */
  'monitoring.read': PANEL,
  /** Corrigir as faixas de calibração de um funcionário. */
  'monitoring.bands.manage': PANEL,
  /** Ajustar as travas de segurança de um funcionário. */
  'monitoring.safety.manage': ADMIN_ONLY,
  /** Pausar e retomar os alertas de um funcionário (férias, afastamento). */
  'monitoring.pause': PANEL,
  /** Fila de alertas (reconhecer e resolver) e pedido de pausa ao funcionário. */
  'alerts.operate': PANEL,
  'workOrders.operate': PANEL,
  'chat.use': EVERYONE,
  /** Ver câmeras com o endereço do player. */
  'cameras.read': PANEL,
  'cameras.manage': ADMIN_ONLY,
  'evacuation.operate': PANEL,
  'rescue.operate': PANEL,
  'weather.read': PANEL,
  'positions.read': PANEL,
  /** Diretório de funcionários e administradores, fila de aprovação e detalhe. */
  'users.read': PANEL,
  /** Cadastrar, aprovar, editar, desativar e excluir usuários; mudar o nível. */
  'users.manage': ADMIN_ONLY,
  /** Parear e revogar o aparelho de um funcionário. */
  'devices.manage': ADMIN_ONLY,
  /** Configurações da empresa; hoje, o local da obra que alimenta o clima. */
  'company.manage': ADMIN_ONLY,
  // As de relatório são impostas no módulo de relatórios: a leitura não exige
  // papel, e editar ou excluir relatório alheio exige o papel no serviço. O
  // autor sempre edita e exclui o próprio.
  'reports.read': PANEL,
  /** Editar relatório de outra pessoa da mesma empresa. */
  'reports.edit': PANEL,
  'reports.delete': ADMIN_ONLY,
} as const satisfies Record<string, readonly Role[]>

export type Permission = keyof typeof PERMISSIONS

/** Papéis que têm a permissão, do mais alto ao mais baixo. Cópia: mexer nela não muda a matriz. */
export function rolesFor(permission: Permission): Role[] {
  return [...PERMISSIONS[permission]]
}

export function can(role: string | null | undefined, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role ?? '')
}

/** O que o papel pode, na ordem da tabela. Papel desconhecido não pode nada. */
export function permissionsOf(role: string | null | undefined): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p))
}

export function isPanelRole(role: string | null | undefined): boolean {
  return (PANEL_ROLES as readonly string[]).includes(role ?? '')
}
