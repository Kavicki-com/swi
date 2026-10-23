import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describeError } from '../common/describe-error'
import {
  AUDIT_CAPTURE,
  auditMetadataOf,
  routeOf,
  type AuditableRequest,
  type AuditableResponse,
} from './audit-request'
import { AuditService } from './audit.service'

// Guard global que nunca barra nada: só arma a gravação da trilha para quando
// a resposta terminar.
//
// É guard, e não interceptor, porque a tentativa recusada também conta. O
// RolesGuard e o JwtAuthGuard ficam no controller, e o Nest roda os guards
// globais antes deles; um interceptor só existe depois de todos os guards
// passarem, e o funcionário que tenta ler o estado de saúde de outro (403 do
// RolesGuard) sumiria da trilha. Daqui, o `finish` da resposta pega o status
// real de qualquer desfecho: sucesso, 403, 404 do serviço ou 400 da validação.
//
// Quem agiu sai de `req.user`, que o JwtAuthGuard preenche depois deste guard
// e antes do fim da resposta. Sem token válido (401) não há a quem atribuir, e
// nada é gravado.
@Injectable()
export class AuditGuard implements CanActivate {
  private readonly logger = new Logger(AuditGuard.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = auditMetadataOf(this.reflector, context)
    if (meta === undefined) return true

    const http = context.switchToHttp()
    const req = http.getRequest<AuditableRequest>()
    const res = http.getResponse<AuditableResponse>()
    const route = routeOf(context)
    req[AUDIT_CAPTURE] = {}

    res.once('finish', () => {
      // O listener roda fora do ciclo da requisição: um erro aqui sem captura
      // derrubaria o processo inteiro, não só a linha da trilha.
      try {
        const actor = req.user
        if (actor === undefined) return
        const userAgent = req.headers['user-agent']
        void this.audit.recordRequest({
          meta,
          actor,
          params: req.params ?? {},
          body: req.body,
          captured: req[AUDIT_CAPTURE] ?? {},
          method: req.method,
          route,
          status: res.statusCode,
          ip: req.ip ?? null,
          userAgent: typeof userAgent === 'string' ? userAgent : null,
        })
      } catch (error) {
        this.logger.warn(`Linha da trilha não gravada (${meta.action} em ${route}): ${describeError(error)}`)
      }
    })
    return true
  }
}
