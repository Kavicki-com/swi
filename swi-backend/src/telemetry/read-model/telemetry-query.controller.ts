import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { CurrentUser, CurrentUserId, type JwtUser } from '../../auth/current-user.decorator'
import { JwtAuthGuard } from '../../auth/jwt-auth.guard'
import { Roles } from '../../auth/roles.decorator'
import { RolesGuard } from '../../auth/roles.guard'
import { SessionHistoryQueryDto } from './dto/session-history.dto'
import { TelemetryQueryService } from './telemetry-query.service'

// Leitura do read model. Rotas de pessoa, e não de aparelho: quem lê é o
// funcionário no app ou o administrador no painel, então o guard é o JWT, e não
// a credencial de pareamento que a ingestão usa.
//
// Este é o único caminho por onde valor de saúde sai do backend. O socket da
// ingestão anuncia apenas identificadores justamente porque o controle de
// acesso mora aqui, num lugar só.
@Controller('telemetry/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TelemetryQueryController {
  constructor(private readonly query: TelemetryQueryService) {}

  /**
   * O estado do próprio funcionário. Sem @Roles de propósito: o RolesGuard
   * libera a rota que não declara papel, e o id vem do token, nunca da URL.
   */
  @Get('me/current')
  me(@CurrentUserId() workerId: string) {
    return this.query.currentForWorker(workerId)
  }

  /** Estado de um funcionário no painel, dentro da empresa do administrador. */
  @Roles('ADMIN')
  @Get('workers/:id/current')
  worker(@CurrentUser() admin: JwtUser, @Param('id') workerId: string) {
    return this.query.currentForAdmin(admin, workerId)
  }

  @Roles('ADMIN')
  @Get('admin/summary')
  summary(@CurrentUser() admin: JwtUser) {
    return this.query.adminSummary(admin)
  }

  /**
   * Trilha de auditoria. Sem @Roles porque o dono da sessão também a audita; o
   * serviço é que confere se quem pede é o funcionário dela ou administrador da
   * mesma empresa, e recusa igual nos dois casos em que não é.
   */
  @Get('sessions/:id/history')
  history(
    @CurrentUser() user: JwtUser,
    @Param('id') sessionId: string,
    @Query() query: SessionHistoryQueryDto,
  ) {
    return this.query.sessionHistory(user, sessionId, query)
  }
}
