import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Can } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { AuditService } from './audit.service'
import { AuditEventsQueryDto } from './dto/audit-events.dto'

// Consulta da trilha de auditoria pelo painel. A empresa vem sempre do token,
// nunca da query. Sem @Audit de propósito: ler a trilha não gera linha nela,
// ou cada consulta acrescentaria o que a próxima teria de ler.
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Linhas da trilha, 50 por página (até 100), da mais nova à mais antiga. */
  @Can('audit.read')
  @Get('events')
  list(@CurrentUser() caller: JwtUser, @Query() query: AuditEventsQueryDto) {
    return this.audit.list(caller, query)
  }
}
