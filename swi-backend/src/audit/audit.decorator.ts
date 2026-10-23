import { SetMetadata } from '@nestjs/common'
import type { AuditAction } from '@prisma/client'

// @Audit marca a rota que deixa linha na trilha e diz de onde vem a pessoa de
// quem são os dados. Quem grava é o AuditGuard, depois da resposta; a rota não
// muda em nada.

/** Recursos cujo dono o AuditService sabe achar com um `select`, dentro da empresa de quem pede. */
export type AuditResolvableResource = 'session' | 'alert' | 'rescue' | 'device'

/** Recursos que só aparecem na trilha como tipo e id, sem resolver dono. */
export type AuditResourceType = AuditResolvableResource | 'enrollment' | 'exam' | 'band' | 'safety'

/**
 * De onde vem a pessoa:
 * - `param`: o parâmetro do caminho já é o id dela (`:id`, `:workerId`, `:injuredId`);
 * - `body`: o campo do corpo é o id dela (só o id é lido, o corpo não vai à trilha);
 * - `response`: a rota cria a pessoa, e o id sai da resposta;
 * - `resource` + `param`: o parâmetro é o id de um recurso, e o dono é resolvido.
 */
export type AuditSubject =
  | { param: string }
  | { body: string }
  | { response: string }
  | { resource: AuditResolvableResource; param: string }

/** Recurso registrado ao lado da pessoa, quando o sujeito não é ele. */
export type AuditResource = { type: AuditResourceType } & ({ param: string } | { response: string })

export interface AuditOptions {
  subject: AuditSubject
  resource?: AuditResource
}

export interface AuditMetadata extends AuditOptions {
  action: AuditAction
}

export const AUDIT_KEY = 'audit'

export const Audit = (action: AuditAction, options: AuditOptions) =>
  SetMetadata<string, AuditMetadata>(AUDIT_KEY, { action, ...options })
