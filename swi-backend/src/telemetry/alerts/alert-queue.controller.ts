import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator'
import { JwtAuthGuard } from '../../auth/jwt-auth.guard'
import { Roles } from '../../auth/roles.decorator'
import { RolesGuard } from '../../auth/roles.guard'
import { AlertQueueService } from './alert-queue.service'
import { AlertQueueQueryDto, AlertTriageDto } from './dto/alert-queue.dto'

// Fila de alertas do painel. Só administrador, e o escopo de empresa é do
// serviço: o id do alerta vem da URL, e quem triou vem do token, nunca do corpo.
@Controller('telemetry/v1/admin/alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AlertQueueController {
  constructor(private readonly alerts: AlertQueueService) {}

  @Get()
  list(@CurrentUser() admin: JwtUser, @Query() query: AlertQueueQueryDto) {
    return this.alerts.list(admin, query)
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  acknowledge(@CurrentUser() admin: JwtUser, @Param('id') id: string) {
    return this.alerts.acknowledge(admin, id)
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() admin: JwtUser, @Param('id') id: string, @Body() body: AlertTriageDto) {
    return this.alerts.resolve(admin, id, body.note)
  }
}
