import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, tap } from 'rxjs'
import { AUDIT_CAPTURE, auditMetadataOf, responseKeysOf, type AuditableRequest } from './audit-request'

// A metade da trilha que precisa da resposta: quando a rota cria a pessoa ou
// o recurso (cadastro, exame, resgate, convite de pareamento), o id só existe
// depois do handler. Este interceptor copia só esses ids para a requisição, e
// o AuditGuard os grava no fim. O resto da resposta não sai daqui.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = auditMetadataOf(this.reflector, context)
    const keys = meta === undefined ? [] : responseKeysOf(meta)
    if (keys.length === 0) return next.handle()

    const req = context.switchToHttp().getRequest<AuditableRequest>()
    return next.handle().pipe(
      tap((value: unknown) => {
        const capture = req[AUDIT_CAPTURE]
        if (capture === undefined || value === null || typeof value !== 'object') return
        for (const key of keys) {
          const id = (value as Record<string, unknown>)[key]
          if (typeof id === 'string') capture[key] = id
        }
      }),
    )
  }
}
