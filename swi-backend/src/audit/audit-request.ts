import type { ExecutionContext } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'
import type { Reflector } from '@nestjs/core'
import type { JwtUser } from '../auth/current-user.decorator'
import { AUDIT_KEY, type AuditMetadata } from './audit.decorator'

// O pedaço da requisição que a trilha usa, comum ao AuditGuard e ao
// AuditInterceptor. Tipos estruturais em vez dos do Express: o que importa é
// o que se lê, e o teste monta a requisição sem servidor.

/** Onde o AuditInterceptor guarda os ids da resposta para o AuditGuard gravar. */
export const AUDIT_CAPTURE = Symbol('auditCapture')

export interface AuditableRequest {
  user?: JwtUser
  method: string
  params?: Record<string, string | undefined>
  body?: unknown
  ip?: string
  headers: Record<string, string | string[] | undefined>
  [AUDIT_CAPTURE]?: Record<string, string>
}

export interface AuditableResponse {
  statusCode: number
  once(event: 'finish', listener: () => void): unknown
}

export function auditMetadataOf(reflector: Reflector, context: ExecutionContext): AuditMetadata | undefined {
  if (context.getType() !== 'http') return undefined
  return reflector.get<AuditMetadata | undefined>(AUDIT_KEY, context.getHandler())
}

/** Campos da resposta que a rota pediu para guardar. */
export function responseKeysOf(meta: AuditMetadata): string[] {
  const keys: string[] = []
  if ('response' in meta.subject) keys.push(meta.subject.response)
  if (meta.resource && 'response' in meta.resource) keys.push(meta.resource.response)
  return keys
}

// O Nest aceita lista de caminhos na rota; nenhuma rota auditada usa, e a
// primeira basta para nomear a linha.
function segments(path: unknown): string[] {
  const first: unknown = Array.isArray(path) ? path[0] : path
  return typeof first === 'string' ? first.split('/').filter((s) => s.length > 0) : []
}

/**
 * A rota como declarada no controller (`/users/:id`), montada da metadata do
 * Nest. Nunca a URL da requisição: ela traz os ids, e o id já tem coluna própria.
 */
export function routeOf(context: ExecutionContext): string {
  const controllerPath = Reflect.getMetadata(PATH_METADATA, context.getClass()) as unknown
  const handlerPath = Reflect.getMetadata(PATH_METADATA, context.getHandler()) as unknown
  return `/${[...segments(controllerPath), ...segments(handlerPath)].join('/')}`
}
