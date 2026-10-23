import type { AuditAction } from '@prisma/client'

// O que cada ação da trilha é. Leitura é deduplicada em 5 minutos e não é
// registrada quando a pessoa lê os próprios dados; escrita é registrada toda
// vez. O rótulo é o que a consulta devolve para gente ler.

export type AuditActionKind = 'read' | 'write'

/** Exaustiva por construção: ação nova no enum não compila sem tipo e rótulo. */
export const AUDIT_ACTIONS: Readonly<Record<AuditAction, { kind: AuditActionKind; label: string }>> = {
  HEALTH_CURRENT_READ: { kind: 'read', label: 'Leu o estado atual de saúde' },
  HEALTH_SERIES_READ: { kind: 'read', label: 'Leu a série de medições' },
  CALIBRATION_READ: { kind: 'read', label: 'Leu a calibração' },
  CALIBRATION_HISTORY_READ: { kind: 'read', label: 'Leu o histórico da calibração' },
  CONDITIONS_READ: { kind: 'read', label: 'Leu o histórico de condições' },
  SESSION_HISTORY_READ: { kind: 'read', label: 'Leu o histórico de uma sessão de monitoramento' },
  USER_DETAIL_READ: { kind: 'read', label: 'Leu o cadastro e os exames' },
  DEVICE_READ: { kind: 'read', label: 'Leu o estado do aparelho' },
  USER_CREATED: { kind: 'write', label: 'Cadastrou o usuário' },
  USER_UPDATED: { kind: 'write', label: 'Alterou o cadastro' },
  USER_APPROVED: { kind: 'write', label: 'Aprovou o cadastro' },
  USER_REJECTED: { kind: 'write', label: 'Recusou o cadastro' },
  USER_DELETED: { kind: 'write', label: 'Excluiu o usuário' },
  EXAM_ADDED: { kind: 'write', label: 'Anexou um exame' },
  EXAM_REMOVED: { kind: 'write', label: 'Removeu um exame' },
  BANDS_CHANGED: { kind: 'write', label: 'Alterou uma faixa da calibração' },
  SAFETY_CHANGED: { kind: 'write', label: 'Alterou uma trava de segurança' },
  MONITORING_PAUSED: { kind: 'write', label: 'Pausou os alertas' },
  MONITORING_RESUMED: { kind: 'write', label: 'Retomou os alertas' },
  PAUSE_REQUESTED: { kind: 'write', label: 'Pediu uma pausa ao funcionário' },
  ALERT_ACKNOWLEDGED: { kind: 'write', label: 'Reconheceu um alerta' },
  ALERT_RESOLVED: { kind: 'write', label: 'Resolveu um alerta' },
  DEVICE_ENROLLED: { kind: 'write', label: 'Convidou o pareamento de um aparelho' },
  DEVICE_REVOKED: { kind: 'write', label: 'Revogou um aparelho' },
  RESCUE_STARTED: { kind: 'write', label: 'Despachou um resgate' },
  RESCUE_ARRIVED: { kind: 'write', label: 'Registrou a chegada do resgate' },
  RESCUE_ENDED: { kind: 'write', label: 'Encerrou um resgate' },
}

export const isReadAction = (action: AuditAction): boolean => AUDIT_ACTIONS[action].kind === 'read'

export const auditActionLabel = (action: AuditAction): string => AUDIT_ACTIONS[action].label
