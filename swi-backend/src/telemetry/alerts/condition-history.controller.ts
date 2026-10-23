import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Audit } from '../../audit/audit.decorator'
import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator'
import { JwtAuthGuard } from '../../auth/jwt-auth.guard'
import { Can } from '../../auth/roles.decorator'
import { RolesGuard } from '../../auth/roles.guard'
import { ConditionHistoryService } from './condition-history.service'
import { ConditionHistoryQueryDto } from './dto/condition-history.dto'

// Histórico de condições no perfil do funcionário. O escopo de empresa é do
// serviço: o funcionário vem da URL, e quem pede vem do token.
@ApiTags('telemetry/conditions')
@ApiBearerAuth()
@Controller('telemetry/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConditionHistoryController {
  constructor(private readonly history: ConditionHistoryService) {}

  /** Condições abertas e fechadas, com o motivo do fechamento, 50 por página, da mais nova à mais antiga. */
  @Can('monitoring.read')
  @Audit('CONDITIONS_READ', { subject: { param: 'id' } })
  @Get('workers/:id/conditions')
  list(@CurrentUser() caller: JwtUser, @Param('id') workerId: string, @Query() query: ConditionHistoryQueryDto) {
    return this.history.list(caller, workerId, query.cursor)
  }
}
