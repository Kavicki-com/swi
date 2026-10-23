// Textos dos níveis e das permissões. A matriz em si é do backend
// (swi-backend/src/auth/permissions.ts) e chega pelo GET /auth/me; aqui só
// mora como cada item aparece na tela.
import type { PanelLevel } from '@/services/types'

export type LevelOption = { value: PanelLevel; label: string; description: string }

export const LEVEL_OPTIONS: readonly LevelOption[] = [
  {
    value: 'ADMIN',
    label: 'Administrador',
    description:
      'Acesso completo: gerencia funcionários, administradores e as configurações da empresa.',
  },
  {
    value: 'SUPERVISOR',
    label: 'Supervisor',
    description:
      'Monitora, trata alertas e opera ordens de serviço, evacuação, resgate, relatórios e chat. Não gerencia usuários nem as configurações da empresa.',
  },
]

/** Rótulo do papel vindo do backend. Ausente vale Administrador. */
export function levelLabel(role: string | undefined): string {
  return LEVEL_OPTIONS.find((o) => o.value === role)?.label ?? 'Administrador'
}

const PERMISSION_LABELS: Record<string, string> = {
  'monitoring.read': 'Acompanhar o monitoramento e a transmissão ao vivo',
  'monitoring.pause': 'Pausar os alertas de um funcionário',
  'alerts.operate': 'Tratar alertas e pedir pausa',
  'workOrders.operate': 'Operar ordens de serviço',
  'chat.use': 'Usar o chat',
  'cameras.read': 'Ver as câmeras',
  'cameras.manage': 'Cadastrar câmeras',
  'evacuation.operate': 'Acionar e encerrar evacuação',
  'rescue.operate': 'Operar resgates',
  'rescue.readAll': 'Ver todos os resgates da empresa',
  'weather.read': 'Consultar o clima da obra',
  'positions.read': 'Ver posições e mapa de calor',
  'users.read': 'Consultar funcionários e administradores',
  'users.manage': 'Gerenciar funcionários e administradores',
  'devices.manage': 'Parear e revogar aparelhos',
  'company.manage': 'Alterar as configurações da empresa',
  'reports.read': 'Ler relatórios',
  'reports.edit': 'Editar relatórios de outras pessoas',
  'reports.delete': 'Excluir relatórios de outras pessoas',
}

/** Texto da permissão; uma chave nova no backend aparece crua em vez de sumir. */
export function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? permission
}
