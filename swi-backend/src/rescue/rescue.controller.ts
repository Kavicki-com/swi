import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { RescueService } from './rescue.service'
import { CreateRescueDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Can } from '../auth/roles.decorator'
import { Audit } from '../audit/audit.decorator'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'

// Resgate a partir de Alertas. Qualquer usuário logado lê o histórico da própria
// empresa, mas só quem tem `rescue.readAll` vê todos: o funcionário vê os
// resgates em que é o ferido ou o socorrista. Despachar, registrar chegada e
// encerrar são da equipe do painel. A empresa sai sempre do token; o ferido vem
// no caminho e o socorrista no corpo.
@ApiTags('alerts')
@ApiBearerAuth()
@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class RescueController {
  constructor(private readonly rescues: RescueService) {}

  @Get('rescues')
  list(@CurrentUser() user: JwtUser) {
    return this.rescues.list(user.companyId, { userId: user.userId, role: user.role })
  }

  @UseGuards(RolesGuard) @Can('rescue.operate') @Post('rescues/:id/arrive') @HttpCode(200)
  @Audit('RESCUE_ARRIVED', { subject: { resource: 'rescue', param: 'id' } })
  arrive(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.rescues.arrive(user.companyId, id)
  }

  @UseGuards(RolesGuard) @Can('rescue.operate') @Post('rescues/:id/end') @HttpCode(200)
  @Audit('RESCUE_ENDED', { subject: { resource: 'rescue', param: 'id' } })
  end(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.rescues.end(user.companyId, id, user.userId)
  }

  @UseGuards(RolesGuard) @Can('rescue.operate') @Post(':injuredId/rescue')
  @Audit('RESCUE_STARTED', { subject: { param: 'injuredId' }, resource: { type: 'rescue', response: 'id' } })
  dispatch(@Param('injuredId') injuredId: string, @CurrentUser() user: JwtUser, @Body() dto: CreateRescueDto) {
    return this.rescues.dispatch(user.companyId, injuredId, dto.rescuerId, user.userId)
  }
}
